package com.nice.assistant;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.provider.CalendarContract;
import android.provider.ContactsContract;
import android.text.TextUtils;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.HashSet;
import java.util.Set;

/**
 * DeviceBridgePlugin
 * Consolidated Capacitor native plugin for Android system integrations:
 * - Calendar event creation via Intent.ACTION_INSERT
 * - Device contacts lookup via ContactsContract with Intent.ACTION_PICK fallback
 * - Battery & power status reporting via ACTION_BATTERY_CHANGED and PowerManager
 * - Clipboard read and write via ClipboardManager on main looper
 */
@CapacitorPlugin(name = "DeviceBridge",
    permissions = {
        @Permission(
            strings = { Manifest.permission.READ_CONTACTS },
            alias = "contacts"
        )
    }
)
public class DeviceBridgePlugin extends Plugin {

    private Long extractLong(PluginCall call, String key, Long defaultValue) {
        Object value = call.getData().opt(key);
        if (value instanceof Number) {
            return ((Number) value).longValue();
        } else if (value instanceof String) {
            try {
                return Long.parseLong(((String) value).trim());
            } catch (NumberFormatException ignored) {}
        }
        return defaultValue;
    }

    /**
     * Launch native calendar app to insert a new event.
     * Delegates event insertion to the system calendar handler without requiring WRITE_CALENDAR.
     */
    @PluginMethod
    public void createCalendarEvent(PluginCall call) {
        String title = call.getString("title", "");
        if (TextUtils.isEmpty(title)) {
            title = call.getString("eventName", "New Event");
        }
        String when = call.getString("when", "");
        String description = call.getString("description", "Created by Nice Assistant");
        String location = call.getString("location", "");

        long defaultStart = System.currentTimeMillis() + 3600_000L;
        Long startVal = extractLong(call, "startTime", defaultStart);
        long startMs = (startVal != null && startVal > 0L) ? startVal : defaultStart;

        Long endVal = extractLong(call, "endTime", startMs + 3600_000L);
        long endMs = (endVal != null && endVal > startMs) ? endVal : (startMs + 3600_000L);

        Intent intent = new Intent(Intent.ACTION_INSERT);
        intent.setData(CalendarContract.Events.CONTENT_URI);
        intent.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, startMs);
        intent.putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMs);

        if (!TextUtils.isEmpty(title)) {
            intent.putExtra(CalendarContract.Events.TITLE, title);
        }
        if (!TextUtils.isEmpty(description)) {
            intent.putExtra(CalendarContract.Events.DESCRIPTION, description);
        }
        if (!TextUtils.isEmpty(location)) {
            intent.putExtra(CalendarContract.Events.EVENT_LOCATION, location);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("success", true);
            result.put("message", "Calendar event opened");
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not launch calendar: " + e.getMessage(), e);
        }
    }

    /**
     * Search local device contacts by name or phone number.
     * If READ_CONTACTS is granted, queries ContactsContract directly.
     * If permission is missing or access fails, launches Intent.ACTION_PICK fallback.
     */
    @PluginMethod
    public void searchContacts(PluginCall call) {
        String query = call.getString("query", "");
        boolean permitted = ContextCompat.checkSelfPermission(
            getContext(),
            Manifest.permission.READ_CONTACTS
        ) == PackageManager.PERMISSION_GRANTED;

        if (!permitted) {
            launchContactPickerFallback(call);
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = new String[]{
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.TYPE,
            ContactsContract.CommonDataKinds.Phone.LABEL
        };

        String selection = null;
        String[] selectionArgs = null;
        if (!TextUtils.isEmpty(query.trim())) {
            selection = ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ? OR " +
                        ContactsContract.CommonDataKinds.Phone.NUMBER + " LIKE ?";
            String pattern = "%" + query.trim() + "%";
            selectionArgs = new String[]{ pattern, pattern };
        }

        try (Cursor cursor = resolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
        )) {
            JSArray contactsArray = new JSArray();
            Set<String> seen = new HashSet<>();

            if (cursor != null) {
                int nameCol = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                int numberCol = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                int typeCol = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.TYPE);
                int labelCol = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.LABEL);

                while (cursor.moveToNext() && contactsArray.length() < 50) {
                    String name = nameCol >= 0 ? cursor.getString(nameCol) : "";
                    String number = numberCol >= 0 ? cursor.getString(numberCol) : "";
                    int type = typeCol >= 0 ? cursor.getInt(typeCol) : ContactsContract.CommonDataKinds.Phone.TYPE_OTHER;
                    String label = labelCol >= 0 ? cursor.getString(labelCol) : "";

                    CharSequence typeLabel = ContactsContract.CommonDataKinds.Phone.getTypeLabel(
                        getContext().getResources(),
                        type,
                        label
                    );
                    String typeString = typeLabel != null ? typeLabel.toString() : "Mobile";

                    String dedupeKey = (name != null ? name.trim().toLowerCase() : "") + "|" +
                                       (number != null ? number.replaceAll("[^0-9+]", "") : "");
                    if (seen.contains(dedupeKey)) {
                        continue;
                    }
                    seen.add(dedupeKey);

                    JSObject item = new JSObject();
                    item.put("name", name != null ? name : "");
                    item.put("phone", number != null ? number : "");
                    item.put("type", typeString);
                    contactsArray.put(item);
                }
            }

            JSObject res = new JSObject();
            res.put("found", contactsArray.length() > 0);
            res.put("fallbackLaunched", false);
            res.put("permissionGranted", true);
            res.put("contacts", contactsArray);
            call.resolve(res);
        } catch (SecurityException se) {
            launchContactPickerFallback(call);
        } catch (Exception e) {
            call.reject("Error querying contacts: " + e.getMessage(), e);
        }
    }

    private void launchContactPickerFallback(PluginCall call) {
        try {
            Intent pickIntent = new Intent(Intent.ACTION_PICK, ContactsContract.Contacts.CONTENT_URI);
            pickIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(pickIntent);
        } catch (Exception ignored) {}

        JSObject res = new JSObject();
        res.put("found", false);
        res.put("fallbackLaunched", true);
        res.put("permissionGranted", false);
        res.put("contacts", new JSArray());
        call.resolve(res);
    }

    /**
     * Query battery percentage, charging state, plug type, and power saver mode.
     */
    @PluginMethod
    public void getBatteryInfo(PluginCall call) {
        try {
            IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = getContext().registerReceiver(null, filter);

            int rawLevel = -1;
            int scale = -1;
            int status = -1;
            int plugged = -1;

            if (batteryStatus != null) {
                rawLevel = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                plugged = batteryStatus.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1);
            }

            int level = -1;
            if (rawLevel >= 0 && scale > 0) {
                level = Math.round((rawLevel / (float) scale) * 100);
            }

            if (level < 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                BatteryManager bm = (BatteryManager) getContext().getSystemService(Context.BATTERY_SERVICE);
                if (bm != null) {
                    level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
                }
            }
            if (level < 0) {
                level = 100;
            }

            boolean isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                                 status == BatteryManager.BATTERY_STATUS_FULL;
            if (!isCharging && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                BatteryManager bm = (BatteryManager) getContext().getSystemService(Context.BATTERY_SERVICE);
                if (bm != null) {
                    isCharging = bm.isCharging();
                }
            }

            String plugType = "NONE";
            if (plugged == BatteryManager.BATTERY_PLUGGED_AC) {
                plugType = "AC";
            } else if (plugged == BatteryManager.BATTERY_PLUGGED_USB) {
                plugType = "USB";
            } else if (plugged == BatteryManager.BATTERY_PLUGGED_WIRELESS) {
                plugType = "WIRELESS";
            } else if (isCharging) {
                plugType = "AC";
            }

            boolean isPowerSaveMode = false;
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                isPowerSaveMode = pm.isPowerSaveMode();
            }

            JSObject result = new JSObject();
            result.put("level", level);
            result.put("isCharging", isCharging);
            result.put("plugType", plugType);
            result.put("isPowerSaveMode", isPowerSaveMode);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to retrieve battery info: " + e.getMessage(), e);
        }
    }

    /**
     * Read primary clipboard text safely on the UI / main looper thread.
     */
    @PluginMethod
    public void readClipboard(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard == null || !clipboard.hasPrimaryClip()) {
                    JSObject res = new JSObject();
                    res.put("text", "");
                    res.put("hasContent", false);
                    call.resolve(res);
                    return;
                }

                ClipData clip = clipboard.getPrimaryClip();
                if (clip != null && clip.getItemCount() > 0) {
                    ClipData.Item item = clip.getItemAt(0);
                    CharSequence text = item.coerceToText(getContext());
                    String content = text != null ? text.toString() : "";
                    JSObject res = new JSObject();
                    res.put("text", content);
                    res.put("hasContent", !TextUtils.isEmpty(content));
                    call.resolve(res);
                } else {
                    JSObject res = new JSObject();
                    res.put("text", "");
                    res.put("hasContent", false);
                    call.resolve(res);
                }
            } catch (Exception e) {
                // Catch security or focus exceptions gracefully
                JSObject res = new JSObject();
                res.put("text", "");
                res.put("hasContent", false);
                res.put("error", e.getMessage());
                call.resolve(res);
            }
        });
    }

    /**
     * Write text to primary clipboard on the UI / main looper thread.
     */
    @PluginMethod
    public void writeClipboard(PluginCall call) {
        String text = call.getString("text", "");
        getActivity().runOnUiThread(() -> {
            try {
                ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    ClipData clip = ClipData.newPlainText("Nice Assistant", text != null ? text : "");
                    clipboard.setPrimaryClip(clip);
                    JSObject res = new JSObject();
                    res.put("success", true);
                    call.resolve(res);
                } else {
                    call.reject("Clipboard service unavailable");
                }
            } catch (Exception e) {
                call.reject("Failed to write clipboard: " + e.getMessage(), e);
            }
        });
    }
}
