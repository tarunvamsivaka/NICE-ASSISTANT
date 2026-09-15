package com.nice.assistant;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.content.SharedPreferences;
import com.getcapacitor.BridgeActivity;

@SuppressWarnings({"deprecation"})
public class MainActivity extends BridgeActivity {
    private static final String PREFS_NAME = "nice_runtime_prefs";
    private static final String KEY_MANAGE_STORAGE_PROMPTED = "manage_storage_prompted";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FloatingPlugin.class);
        registerPlugin(NativeTtsPlugin.class);
        registerPlugin(AppCatalogPlugin.class);
        registerPlugin(DeviceBridgePlugin.class);
        super.onCreate(savedInstanceState);

        ensureStorageAccessPrompted();
    }

    /**
     * Keep one native source of truth for MANAGE_EXTERNAL_STORAGE onboarding.
     * Runtime microphone/camera/location prompts are requested on demand from web/native feature flows.
     */
    private void ensureStorageAccessPrompted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        if (Environment.isExternalStorageManager()) return;

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        boolean promptedBefore = prefs.getBoolean(KEY_MANAGE_STORAGE_PROMPTED, false);
        if (promptedBefore) return;

        prefs.edit().putBoolean(KEY_MANAGE_STORAGE_PROMPTED, true).apply();

        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
            Uri uri = Uri.fromParts("package", getPackageName(), null);
            intent.setData(uri);
            startActivity(intent);
        } catch (Exception e) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
            startActivity(intent);
        }
    }
}
