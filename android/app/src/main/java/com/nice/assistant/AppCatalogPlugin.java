package com.nice.assistant;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.text.TextUtils;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(name = "AppCatalog")
public class AppCatalogPlugin extends Plugin {

    private static final long CACHE_MS = 120_000L;
    private final Object cacheLock = new Object();
    private List<AppEntry> cachedApps = new ArrayList<>();
    private long cachedAt = 0L;

    private static class AppEntry {
        final String label;
        final String packageName;

        AppEntry(String label, String packageName) {
            this.label = label;
            this.packageName = packageName;
        }
    }

    private String normalize(String value) {
        String text = String.valueOf(value == null ? "" : value);
        text = Normalizer.normalize(text, Normalizer.Form.NFKD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.US)
                .replaceAll("[^a-z0-9]+", " ")
                .trim()
                .replaceAll("\\s+", " ");
        return text;
    }

    private int scoreMatch(String query, AppEntry entry) {
        String q = normalize(query);
        String label = normalize(entry.label);
        String pkg = normalize(entry.packageName);
        if (q.isEmpty()) return 0;
        if (q.equals(label) || q.equals(pkg)) return 1000;

        String qCompact = q.replace(" ", "");
        String labelCompact = label.replace(" ", "");
        String pkgCompact = pkg.replace(" ", "");
        if (qCompact.equals(labelCompact) || qCompact.equals(pkgCompact)) return 920;
        if (label.startsWith(q) || pkg.startsWith(q)) return 850 - Math.abs(label.length() - q.length());
        if (label.contains(q) || pkg.contains(q)) return 720 - Math.abs(label.length() - q.length());
        if (!qCompact.isEmpty() && (labelCompact.contains(qCompact) || pkgCompact.contains(qCompact))) {
            return 650 - Math.abs(labelCompact.length() - qCompact.length());
        }
        return 0;
    }

    private List<AppEntry> queryLaunchableApps() {
        PackageManager packageManager = getContext().getPackageManager();
        Intent launchIntent = new Intent(Intent.ACTION_MAIN, null);
        launchIntent.addCategory(Intent.CATEGORY_LAUNCHER);

        List<ResolveInfo> resolved = packageManager.queryIntentActivities(launchIntent, 0);
        Set<String> seen = new HashSet<>();
        List<AppEntry> apps = new ArrayList<>();
        final String ownPackage = getContext().getPackageName();

        for (ResolveInfo resolveInfo : resolved) {
            if (resolveInfo == null || resolveInfo.activityInfo == null) continue;
            String packageName = resolveInfo.activityInfo.packageName;
            if (TextUtils.isEmpty(packageName) || ownPackage.equals(packageName) || seen.contains(packageName)) {
                continue;
            }
            CharSequence labelValue = resolveInfo.loadLabel(packageManager);
            String label = labelValue == null ? packageName : labelValue.toString().trim();
            seen.add(packageName);
            apps.add(new AppEntry(label, packageName));
        }

        apps.sort(Comparator.comparing((AppEntry app) -> app.label, String.CASE_INSENSITIVE_ORDER));
        return apps;
    }

    private List<AppEntry> getCachedApps(boolean refresh) {
        long now = System.currentTimeMillis();
        synchronized (cacheLock) {
            if (!refresh && !cachedApps.isEmpty() && (now - cachedAt) < CACHE_MS) {
                return cachedApps;
            }
            cachedApps = queryLaunchableApps();
            cachedAt = now;
            return cachedApps;
        }
    }

    @PluginMethod
    public void listInstalledApps(PluginCall call) {
        boolean refresh = Boolean.TRUE.equals(call.getBoolean("refresh", false));
        List<AppEntry> apps = getCachedApps(refresh);

        JSArray array = new JSArray();
        for (AppEntry app : apps) {
            JSObject entry = new JSObject();
            entry.put("label", app.label);
            entry.put("packageName", app.packageName);
            array.put(entry);
        }

        JSObject result = new JSObject();
        result.put("count", apps.size());
        result.put("apps", array);
        call.resolve(result);
    }

    @PluginMethod
    public void launchPackage(PluginCall call) {
        String packageName = call.getString("packageName", "").trim();
        if (packageName.isEmpty()) {
            call.reject("packageName is required");
            return;
        }

        PackageManager packageManager = getContext().getPackageManager();
        Intent intent = packageManager.getLaunchIntentForPackage(packageName);
        if (intent == null) {
            call.reject("package_not_found");
            return;
        }

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        getContext().startActivity(intent);

        JSObject result = new JSObject();
        result.put("opened", true);
        result.put("packageName", packageName);
        call.resolve(result);
    }

    @PluginMethod
    public void launchApp(PluginCall call) {
        String query = call.getString("query", "").trim();
        if (query.isEmpty()) {
            call.reject("query is required");
            return;
        }

        List<AppEntry> apps = getCachedApps(false);
        AppEntry best = null;
        int bestScore = 0;
        for (AppEntry app : apps) {
            int score = scoreMatch(query, app);
            if (score > bestScore) {
                bestScore = score;
                best = app;
            }
        }

        if (best == null || bestScore < 620) {
            call.reject("app_not_found");
            return;
        }

        PackageManager packageManager = getContext().getPackageManager();
        Intent intent = packageManager.getLaunchIntentForPackage(best.packageName);
        if (intent == null) {
            call.reject("app_not_launchable");
            return;
        }

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        getContext().startActivity(intent);

        JSObject result = new JSObject();
        result.put("opened", true);
        result.put("label", best.label);
        result.put("packageName", best.packageName);
        result.put("score", bestScore);
        call.resolve(result);
    }
}
