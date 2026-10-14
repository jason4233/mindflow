package com.mindflow.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Arrays;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import org.junit.Test;

/**
 * JVM tests for the parts of MindflowSecureStoragePlugin that do not need a device:
 * argument validation and the AES-GCM envelope. A software AES-256 key stands in for the
 * Android Keystore key; the cipher code path (no caller IV, provider-generated IV) is the same.
 */
public class MindflowSecureStorageTest {

    private static SecretKey newKey() throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES");
        generator.init(256);
        return generator.generateKey();
    }

    private static String repeat(char c, int count) {
        char[] chars = new char[count];
        Arrays.fill(chars, c);
        return new String(chars);
    }

    @Test
    public void validatesKeys() {
        assertTrue(MindflowSecureStoragePlugin.isValidKey("mindflow.sync.mobile.token"));
        assertTrue(MindflowSecureStoragePlugin.isValidKey("A-z_0.9"));
        assertTrue(MindflowSecureStoragePlugin.isValidKey(repeat('k', 128)));
        assertFalse(MindflowSecureStoragePlugin.isValidKey(null));
        assertFalse(MindflowSecureStoragePlugin.isValidKey(""));
        assertFalse(MindflowSecureStoragePlugin.isValidKey(repeat('k', 129)));
        assertFalse(MindflowSecureStoragePlugin.isValidKey("a/b"));
        assertFalse(MindflowSecureStoragePlugin.isValidKey("a b"));
        assertFalse(MindflowSecureStoragePlugin.isValidKey("token\n"));
        assertFalse(MindflowSecureStoragePlugin.isValidKey("令牌"));
    }

    @Test
    public void limitsValuesTo16KiBOfUtf8() {
        assertTrue(MindflowSecureStoragePlugin.isValidValue(""));
        assertTrue(MindflowSecureStoragePlugin.isValidValue(repeat('x', MindflowSecureStoragePlugin.MAX_VALUE_BYTES)));
        assertFalse(MindflowSecureStoragePlugin.isValidValue(repeat('x', MindflowSecureStoragePlugin.MAX_VALUE_BYTES + 1)));
        // 3 bytes per CJK character in UTF-8: 5462 * 3 = 16386 bytes > 16384.
        assertFalse(MindflowSecureStoragePlugin.isValidValue(repeat('心', 5462)));
        assertFalse(MindflowSecureStoragePlugin.isValidValue(null));
    }

    @Test
    public void envelopeRoundTripsWithFreshTwelveByteIvs() throws Exception {
        SecretKey key = newKey();
        byte[] plaintext = "ghp_example-token-心智圖".getBytes(StandardCharsets.UTF_8);

        byte[] first = MindflowSecureStoragePlugin.seal(key, "mindflow.sync.mobile.token", plaintext);
        byte[] second = MindflowSecureStoragePlugin.seal(key, "mindflow.sync.mobile.token", plaintext);

        // iv (12) + ciphertext (same length as plaintext) + GCM tag (16)
        assertEquals(12 + plaintext.length + 16, first.length);
        assertNotEquals(Arrays.toString(Arrays.copyOf(first, 12)), Arrays.toString(Arrays.copyOf(second, 12)));
        assertArrayEquals(plaintext, MindflowSecureStoragePlugin.open(key, "mindflow.sync.mobile.token", first));
        assertArrayEquals(plaintext, MindflowSecureStoragePlugin.open(key, "mindflow.sync.mobile.token", second));
    }

    @Test
    public void envelopeRejectsTamperingWrongKeyNameAndWrongKey() throws Exception {
        SecretKey key = newKey();
        byte[] envelope = MindflowSecureStoragePlugin.seal(key, "a", "secret".getBytes(StandardCharsets.UTF_8));

        byte[] tampered = envelope.clone();
        tampered[tampered.length - 1] ^= 0x01;
        assertThrows(GeneralSecurityException.class, () -> MindflowSecureStoragePlugin.open(key, "a", tampered));
        // The key name is bound as associated data: a value cannot be moved to another key.
        assertThrows(GeneralSecurityException.class, () -> MindflowSecureStoragePlugin.open(key, "b", envelope));
        // A replaced Keystore key (e.g. after a restore onto a new phone) cannot open old values.
        SecretKey otherKey = newKey();
        assertThrows(GeneralSecurityException.class, () -> MindflowSecureStoragePlugin.open(otherKey, "a", envelope));
        assertThrows(GeneralSecurityException.class, () -> MindflowSecureStoragePlugin.open(key, "a", new byte[27]));
        assertThrows(GeneralSecurityException.class, () -> MindflowSecureStoragePlugin.open(key, "a", null));
    }
}
