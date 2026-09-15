package com.nice.assistant;

import android.speech.tts.TextToSpeech;
import android.text.TextUtils;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

@CapacitorPlugin(name = "NativeTts")
@SuppressWarnings({"deprecation"})
public class NativeTtsPlugin extends Plugin implements TextToSpeech.OnInitListener {

    private TextToSpeech textToSpeech;
    private volatile boolean ready = false;

    @Override
    public void load() {
        super.load();
        initEngine();
    }

    private synchronized void initEngine() {
        if (textToSpeech != null) return;
        textToSpeech = new TextToSpeech(getContext(), this);
    }

    @Override
    public void onInit(int status) {
        ready = status == TextToSpeech.SUCCESS;
        if (ready && textToSpeech != null) {
            textToSpeech.setLanguage(Locale.getDefault());
        }
    }

    private Locale parseLocale(String localeTag) {
        if (TextUtils.isEmpty(localeTag)) return Locale.getDefault();
        Locale parsed = Locale.forLanguageTag(localeTag);
        if (parsed != null && !TextUtils.isEmpty(parsed.getLanguage())) {
            return parsed;
        }
        if (localeTag.contains("-")) {
            String[] parts = localeTag.split("-", 2);
            return new Locale(parts[0], parts[1]);
        }
        return new Locale(localeTag);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ready", ready && textToSpeech != null);
        call.resolve(result);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (TextUtils.isEmpty(text)) {
            call.reject("text is required");
            return;
        }

        initEngine();
        if (!ready || textToSpeech == null) {
            call.reject("native_tts_not_ready");
            return;
        }

        Double rateValue = call.getDouble("rate", 1.0);
        Double pitchValue = call.getDouble("pitch", 1.0);
        float rate = Math.max(0.55f, Math.min(2.0f, rateValue != null ? rateValue.floatValue() : 1.0f));
        float pitch = Math.max(0.7f, Math.min(1.5f, pitchValue != null ? pitchValue.floatValue() : 1.0f));
        String localeTag = call.getString("locale", "en-US");

        textToSpeech.setSpeechRate(rate);
        textToSpeech.setPitch(pitch);
        int languageStatus = textToSpeech.setLanguage(parseLocale(localeTag));
        int speakStatus = textToSpeech.speak(
                text,
                TextToSpeech.QUEUE_FLUSH,
                null,
                "nice_tts_" + System.currentTimeMillis()
        );

        if (speakStatus == TextToSpeech.ERROR) {
            call.reject("native_tts_speak_error");
            return;
        }

        JSObject result = new JSObject();
        result.put("spoken", true);
        result.put("languageStatus", languageStatus);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (textToSpeech != null) {
            textToSpeech.stop();
        }
        call.resolve(new JSObject().put("stopped", true));
    }

    @Override
    protected void handleOnDestroy() {
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }
        ready = false;
        super.handleOnDestroy();
    }
}
