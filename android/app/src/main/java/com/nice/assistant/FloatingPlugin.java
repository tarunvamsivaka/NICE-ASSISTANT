package com.nice.assistant;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FloatingPlugin")
public class FloatingPlugin extends Plugin {

    @PluginMethod()
    public void startBubble(PluginCall call) {
        if (!ensureOverlayPermission(call)) return;

        startFloatingService(FloatingService.ACTION_SHOW_BUBBLE, 0L);

        Intent homeIntent = new Intent(Intent.ACTION_MAIN);
        homeIntent.addCategory(Intent.CATEGORY_HOME);
        homeIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(homeIntent);

        call.resolve(new JSObject().put("started", true));
    }

    @PluginMethod()
    public void startTimerBubble(PluginCall call) {
        if (!ensureOverlayPermission(call)) return;

        Long endTimeMs = call.getLong("endTimeMs");
        if (endTimeMs == null || endTimeMs <= 0L) {
            call.reject("endTimeMs is required and must be > 0");
            return;
        }

        startFloatingService(FloatingService.ACTION_START_TIMER, endTimeMs);
        call.resolve(new JSObject()
                .put("started", true)
                .put("timerEndMs", endTimeMs));
    }

    @PluginMethod()
    public void updateTimerBubble(PluginCall call) {
        if (!ensureOverlayPermission(call)) return;

        Long endTimeMs = call.getLong("endTimeMs");
        if (endTimeMs == null || endTimeMs <= 0L) {
            call.reject("endTimeMs is required and must be > 0");
            return;
        }

        startFloatingService(FloatingService.ACTION_UPDATE_TIMER, endTimeMs);
        call.resolve(new JSObject()
                .put("updated", true)
                .put("timerEndMs", endTimeMs));
    }

    @PluginMethod()
    public void stopTimerBubble(PluginCall call) {
        stopFloatingService();
        call.resolve(new JSObject().put("stopped", true));
    }

    @PluginMethod()
    public void stopBubble(PluginCall call) {
        stopFloatingService();
        call.resolve(new JSObject().put("stopped", true));
    }

    private void startFloatingService(String action, long endTimeMs) {
        Intent serviceIntent = new Intent(getContext(), FloatingService.class);
        serviceIntent.setAction(action);
        if (endTimeMs > 0L) {
            serviceIntent.putExtra(FloatingService.EXTRA_TIMER_END_MS, endTimeMs);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(serviceIntent);
        } else {
            getContext().startService(serviceIntent);
        }
    }

    private void stopFloatingService() {
        Intent intent = new Intent(getContext(), FloatingService.class);
        intent.setAction(FloatingService.ACTION_STOP_BUBBLE);
        getContext().stopService(intent);
    }

    private boolean ensureOverlayPermission(PluginCall call) {
        if (!Settings.canDrawOverlays(getContext())) {
            Intent intent = new Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.reject("Overlay permission required. Enable 'Display over other apps' and try again.");
            return false;
        }
        return true;
    }
}
