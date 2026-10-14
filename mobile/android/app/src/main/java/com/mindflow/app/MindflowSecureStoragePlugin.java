package com.mindflow.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.InvalidKeyException;
import java.security.Key;
import java.security.KeyStore;
import java.security.ProviderException;
import java.security.UnrecoverableKeyException;
import java.util.Arrays;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Small encrypted key/value store for secrets such as the GitHub sync token.
 *
 * <p>JS contract ({@code window.Capacitor.Plugins.MindflowSecureStorage}):
 * <pre>
 *   isAvailable()        -> { available: boolean }     never rejects
 *   get({ key })         -> { value: string | null }   missing, or undecryptable (entry is deleted) -> null
 *   set({ key, value })  -> {}                         value: string, at most 16 KiB as UTF-8
 *   remove({ key })      -> {}                         removing a missing key is not an error
 * </pre>
 * key: 1-128 characters of [A-Za-z0-9._-]. Rejections carry {@code error.code}
 * "INVALID_ARGUMENT" (bad key or value) or "UNAVAILABLE" (Android Keystore or storage unusable).
 *
 * <p>Storage: an AES-256-GCM key that exists only inside the Android Keystore (alias
 * {@value #KEY_ALIAS}, no user authentication) encrypts each value with a fresh random
 * 12-byte IV. base64(iv || ciphertext+tag) is kept in the private SharedPreferences file
 * "{@value #PREFS_NAME}", which is excluded from Auto Backup (res/xml/data_extraction_rules.xml,
 * res/xml/backup_rules.xml) because the Keystore key itself is never backed up or transferred.
 * The storage key name is bound as GCM associated data, so a ciphertext cannot be replayed
 * under a different key name. No third-party crypto library is involved.
 */
@CapacitorPlugin(name = "MindflowSecureStorage")
public class MindflowSecureStoragePlugin extends Plugin {

    static final String KEY_ALIAS = "mindflow_secure_storage_v1";
    static final String PREFS_NAME = "mindflow_secure";
    static final String CODE_INVALID_ARGUMENT = "INVALID_ARGUMENT";
    static final String CODE_UNAVAILABLE = "UNAVAILABLE";
    static final int MAX_VALUE_BYTES = 16 * 1024;

    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_LENGTH = 12;
    private static final int TAG_LENGTH_BITS = 128;
    private static final Pattern KEY_PATTERN = Pattern.compile("[A-Za-z0-9._-]{1,128}");
    private static final String PROBE_KEY = "mindflow.secure.probe";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        boolean available;
        try {
            // Round-trip a probe so "available" also covers devices whose Keystore can create
            // keys but fails to use them.
            SecretKey secretKey = loadKey(true);
            byte[] probe = PROBE_KEY.getBytes(StandardCharsets.UTF_8);
            available = Arrays.equals(probe, open(secretKey, PROBE_KEY, seal(secretKey, PROBE_KEY, probe)));
        } catch (Exception e) {
            Logger.error(getLogTag(), "Android Keystore is not usable", e);
            available = false;
        }
        JSObject result = new JSObject();
        result.put("available", available);
        call.resolve(result);
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (!isValidKey(key)) {
            rejectInvalidKey(call);
            return;
        }
        try {
            String stored = prefs().getString(key, null);
            if (stored == null) {
                resolveValue(call, null);
                return;
            }

            SecretKey secretKey;
            try {
                secretKey = loadKey(false);
            } catch (Exception e) {
                // The Keystore itself could not be opened: keep the entry, it may work next time.
                Logger.error(getLogTag(), "Android Keystore is not usable", e);
                call.reject("Android Keystore is not available", CODE_UNAVAILABLE);
                return;
            }

            String value = null;
            if (secretKey != null) {
                try {
                    byte[] plaintext = open(secretKey, key, Base64.decode(stored, Base64.NO_WRAP));
                    value = new String(plaintext, StandardCharsets.UTF_8);
                } catch (GeneralSecurityException | IllegalArgumentException e) {
                    // Wrong/replaced key (e.g. KeyPermanentlyInvalidatedException, AEADBadTagException)
                    // or corrupt data: this ciphertext can never be opened again.
                    value = null;
                }
            }
            if (value == null) {
                Logger.warn(getLogTag(), "Dropping an entry that can no longer be decrypted");
                // Best-effort cleanup; the caller gets null either way.
                prefs().edit().remove(key).apply();
            }
            resolveValue(call, value);
        } catch (RuntimeException e) {
            Logger.error(getLogTag(), "Secure storage read failed", e);
            call.reject("Secure storage is not available", CODE_UNAVAILABLE);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (!isValidKey(key)) {
            rejectInvalidKey(call);
            return;
        }
        if (!isValidValue(value)) {
            call.reject("value must be a string of at most " + MAX_VALUE_BYTES + " bytes (UTF-8)", CODE_INVALID_ARGUMENT);
            return;
        }
        try {
            String encoded = Base64.encodeToString(sealWithKeyRecovery(key, value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!prefs().edit().putString(key, encoded).commit()) {
                call.reject("Secure storage could not be written", CODE_UNAVAILABLE);
                return;
            }
            call.resolve(new JSObject()); // JS receives {} (resolve() alone would give undefined)
        } catch (Exception e) {
            Logger.error(getLogTag(), "Secure storage write failed", e);
            call.reject("Android Keystore is not available", CODE_UNAVAILABLE);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (!isValidKey(key)) {
            rejectInvalidKey(call);
            return;
        }
        try {
            if (!prefs().edit().remove(key).commit()) {
                call.reject("Secure storage could not be written", CODE_UNAVAILABLE);
                return;
            }
            call.resolve(new JSObject()); // JS receives {} (resolve() alone would give undefined)
        } catch (RuntimeException e) {
            Logger.error(getLogTag(), "Secure storage remove failed", e);
            call.reject("Secure storage is not available", CODE_UNAVAILABLE);
        }
    }

    // ---- validation (pure Java, covered by MindflowSecureStorageTest) ----------------------

    static boolean isValidKey(String key) {
        return key != null && KEY_PATTERN.matcher(key).matches();
    }

    static boolean isValidValue(String value) {
        return value != null && value.getBytes(StandardCharsets.UTF_8).length <= MAX_VALUE_BYTES;
    }

    // ---- envelope format: iv (12 bytes) || ciphertext || GCM tag (16 bytes) ----------------

    /** Encrypts {@code plaintext}; the cipher provider picks a fresh random 12-byte IV. */
    static byte[] seal(SecretKey secretKey, String storageKey, byte[] plaintext) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        // No IV is passed in: Android Keystore keys require randomized encryption and generate it.
        cipher.init(Cipher.ENCRYPT_MODE, secretKey);
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length != IV_LENGTH) {
            throw new GeneralSecurityException("Unexpected GCM IV length");
        }
        cipher.updateAAD(associatedData(storageKey));
        byte[] ciphertext = cipher.doFinal(plaintext);
        byte[] envelope = new byte[IV_LENGTH + ciphertext.length];
        System.arraycopy(iv, 0, envelope, 0, IV_LENGTH);
        System.arraycopy(ciphertext, 0, envelope, IV_LENGTH, ciphertext.length);
        return envelope;
    }

    /** Decrypts an envelope produced by {@link #seal}; throws if the key, name or data do not match. */
    static byte[] open(SecretKey secretKey, String storageKey, byte[] envelope) throws GeneralSecurityException {
        if (envelope == null || envelope.length < IV_LENGTH + TAG_LENGTH_BITS / 8) {
            throw new GeneralSecurityException("Envelope too short");
        }
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(TAG_LENGTH_BITS, envelope, 0, IV_LENGTH));
        cipher.updateAAD(associatedData(storageKey));
        return cipher.doFinal(envelope, IV_LENGTH, envelope.length - IV_LENGTH);
    }

    private static byte[] associatedData(String storageKey) {
        return ("mindflow_secure:" + storageKey).getBytes(StandardCharsets.UTF_8);
    }

    // ---- Android Keystore -----------------------------------------------------------------

    private byte[] sealWithKeyRecovery(String storageKey, byte[] plaintext) throws Exception {
        try {
            return seal(loadKey(true), storageKey, plaintext);
        } catch (InvalidKeyException | ProviderException e) {
            // e.g. KeyPermanentlyInvalidatedException, or "Keystore operation failed" for key
            // material the Keystore lost: replace the key once. Values sealed with the old key can
            // no longer be opened; get() drops them lazily and returns null.
            Logger.warn(getLogTag(), "Replacing an unusable Keystore key");
            deleteKey();
            return seal(loadKey(true), storageKey, plaintext);
        }
    }

    /** Returns the Keystore AES key, creating it when {@code createIfMissing}; null if absent. */
    private SecretKey loadKey(boolean createIfMissing) throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        Key existing;
        try {
            existing = keyStore.getKey(KEY_ALIAS, null);
        } catch (UnrecoverableKeyException e) {
            // The entry exists but its key material is gone (e.g. Keystore reset): start over.
            keyStore.deleteEntry(KEY_ALIAS);
            existing = null;
        }
        if (existing instanceof SecretKey) {
            return (SecretKey) existing;
        }
        if (!createIfMissing) {
            return null;
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(false)
                .build()
        );
        return generator.generateKey();
    }

    private void deleteKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        keyStore.deleteEntry(KEY_ALIAS);
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static void resolveValue(PluginCall call, String value) {
        JSObject result = new JSObject();
        // put(name, (String) null) would drop the key; JSObject.NULL keeps { value: null } (same as Preferences).
        result.put("value", value == null ? JSObject.NULL : value);
        call.resolve(result);
    }

    private static void rejectInvalidKey(PluginCall call) {
        call.reject("key must be 1-128 characters of [A-Za-z0-9._-]", CODE_INVALID_ARGUMENT);
    }
}
