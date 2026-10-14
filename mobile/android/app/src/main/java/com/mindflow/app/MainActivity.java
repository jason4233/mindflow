package com.mindflow.app;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // In-app plugins are not listed in capacitor.plugins.json; they must be registered
        // before super.onCreate() builds the bridge. Web code reaches it as
        // window.Capacitor.Plugins.MindflowSecureStorage.
        registerPlugin(MindflowSecureStoragePlugin.class);
        super.onCreate(savedInstanceState);
        // targetSdk 35+ forces edge-to-edge on Android 15+. Enabling it on every version (as the
        // Capacitor 9 template does) lets the SystemBars "native" insets handling behave the same on
        // Android 7-16: without viewport-fit=cover the WebView is padded inside the system bars and
        // keyboard, so the web layout is unchanged.
        EdgeToEdge.enable(this);
    }
}
