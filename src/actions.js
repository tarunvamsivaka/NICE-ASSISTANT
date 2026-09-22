/**
 * Nice — Real Actions Engine
 * Full device control: TTS, alarms, timers, stopwatch, notes, music,
 * apps, camera, calendar, flashlight, battery, vibration, clipboard,
 * wake lock, share, and more — all offline.
 */

import { registerPlugin } from '@capacitor/core';
import { isOfflineHardLocked, isOnlineAllowed } from './policy.js';

// ===== NATIVE FLOATING BUBBLE BRIDGE =====
let _floatingPluginPromise = null;
let _nativeTimerBubbleEnabled = false;
let _nativeTimerBubbleUnsupported = false;
let _nativeTtsPluginPromise = null;
let _nativeTtsUnsupported = false;
let _nativeTtsReady = false;
let _appCatalogPlugin = null;
let _appCatalogPluginInitAttempted = false;
let _appLauncher = null;

function emitBubbleState(state) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('nice:bubble-state', { detail: { state } }));
}
function isNativePlatform() {
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform) {
        return !!window.Capacitor.isNativePlatform();
    }
    if (typeof globalThis !== 'undefined' && globalThis.Capacitor?.isNativePlatform) {
        return !!globalThis.Capacitor.isNativePlatform();
    }
    return false;
}

let _deviceBridgePlugin = null;
let _deviceBridgePluginInitAttempted = false;

function getDeviceBridgePlugin() {
    const direct = (typeof window !== 'undefined' ? window?.Capacitor?.Plugins?.DeviceBridge : null)
        || (typeof globalThis !== 'undefined' ? globalThis?.Capacitor?.Plugins?.DeviceBridge : null);
    if (direct) return direct;

    if (!_deviceBridgePlugin && !_deviceBridgePluginInitAttempted && isNativePlatform()) {
        _deviceBridgePluginInitAttempted = true;
        try {
            _deviceBridgePlugin = registerPlugin('DeviceBridge');
        } catch {
            _deviceBridgePlugin = null;
        }
    }
    return _deviceBridgePlugin || direct || null;
}

function getAppLauncher() {
    if (_appLauncher) return _appLauncher;
    try {
        _appLauncher = registerPlugin('AppLauncher');
    } catch {
        _appLauncher = null;
    }
    return _appLauncher;
}

async function getFloatingPlugin() {
    if (_nativeTimerBubbleUnsupported || !isNativePlatform()) return null;
    if (!_floatingPluginPromise) {
        _floatingPluginPromise = Promise.resolve()
            .then(() => registerPlugin('FloatingPlugin'))
            .catch((err) => {
                console.warn('[Nice] FloatingPlugin unavailable:', err?.message || err);
                _nativeTimerBubbleUnsupported = true;
                return null;
            });
    }
    return _floatingPluginPromise;
}

async function getNativeTtsPlugin() {
    if (_nativeTtsUnsupported || !isNativePlatform()) return null;
    if (!_nativeTtsPluginPromise) {
        _nativeTtsPluginPromise = Promise.resolve()
            .then(() => registerPlugin('NativeTts'))
            .catch((err) => {
                console.warn('[Nice] NativeTts plugin unavailable:', err?.message || err);
                _nativeTtsUnsupported = true;
                return null;
            });
    }
    const plugin = await _nativeTtsPluginPromise;
    if (!plugin) return null;
    if (!_nativeTtsReady) {
        try {
            const state = await plugin.isAvailable();
            _nativeTtsReady = !!state?.ready;
        } catch {
            _nativeTtsReady = false;
        }
    }
    return _nativeTtsReady ? plugin : null;
}

async function stopNativeTts() {
    const plugin = await getNativeTtsPlugin();
    if (!plugin?.stop) return;
    try {
        await plugin.stop();
    } catch {
        // Non-fatal stop call.
    }
}

async function startNativeTimerBubble(endTimeMs) {
    if (!Number.isFinite(endTimeMs) || endTimeMs <= 0) return;
    const plugin = await getFloatingPlugin();
    if (!plugin?.startTimerBubble) return;
    try {
        await plugin.startTimerBubble({ endTimeMs });
        _nativeTimerBubbleEnabled = true;
        emitBubbleState('Timer active');
    } catch (err) {
        const message = String(err?.message || '').toLowerCase();
        if (message.includes('overlay permission')) {
            emitBubbleState('Permission required');
            console.warn('[Nice] Timer bubble requires overlay permission.');
        } else {
            console.warn('[Nice] Failed to start timer bubble:', err?.message || err);
        }
    }
}

async function updateNativeTimerBubble(endTimeMs) {
    if (!_nativeTimerBubbleEnabled || !Number.isFinite(endTimeMs) || endTimeMs <= 0) return;
    const plugin = await getFloatingPlugin();
    if (!plugin?.updateTimerBubble) return;
    try {
        await plugin.updateTimerBubble({ endTimeMs });
    } catch {
        // Keep timer UX alive in-app even if overlay updates fail.
    }
}

async function stopNativeTimerBubble() {
    if (!_nativeTimerBubbleEnabled) return;
    const plugin = await getFloatingPlugin();
    try {
        if (plugin?.stopTimerBubble) {
            await plugin.stopTimerBubble();
        } else if (plugin?.stopBubble) {
            await plugin.stopBubble();
        }
    } catch {
        // Ignore stop errors to avoid blocking timer cancellation.
    } finally {
        _nativeTimerBubbleEnabled = false;
        emitBubbleState('Inactive');
    }
}

// ===== TEXT-TO-SPEECH ENGINE =====
let ttsEnabled = true;
let ttsRate = 1.0;
let cachedVoice = null;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function loadTTSPreferences() {
    try {
        const rawEnabled = localStorage.getItem('nice_tts');
        if (rawEnabled === 'true') ttsEnabled = true;
        if (rawEnabled === 'false') ttsEnabled = false;

        const rawRate = Number(localStorage.getItem('nice_voice_speed'));
        if (Number.isFinite(rawRate)) ttsRate = clamp(rawRate, 0.5, 2.0);
    } catch {
        // localStorage may be unavailable in restricted contexts.
    }
}

function selectAndCacheVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;

    cachedVoice =
        voices.find(v => v.localService && v.lang && v.lang.startsWith('en')) ||
        voices.find(v => v.lang === 'en-US') ||
        voices.find(v => v.lang && v.lang.startsWith('en')) ||
        voices[0] || null;
}

loadTTSPreferences();

if ('speechSynthesis' in window) {
    selectAndCacheVoice();
    window.speechSynthesis.onvoiceschanged = () => {
        selectAndCacheVoice();
    };
}

export function setTTSEnabled(enabled) {
    ttsEnabled = !!enabled;
    try { localStorage.setItem('nice_tts', String(ttsEnabled)); } catch { }
    if (!ttsEnabled) {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        void stopNativeTts();
    }
    return ttsEnabled;
}

export function setTTSSpeed(rate) {
    const numericRate = clamp(Number(rate) || 1.0, 0.5, 2.0);
    ttsRate = numericRate;
    try { localStorage.setItem('nice_voice_speed', String(ttsRate)); } catch { }
    return ttsRate;
}

function speakWithWebTts(cleanText) {
    if (!('speechSynthesis' in window)) return;
    if (!cleanText) return;

    if (!cachedVoice) {
        selectAndCacheVoice();
    }

    const speakWithRetry = (attempt = 0) => {
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = ttsRate;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        utterance.lang = 'en-US';
        if (cachedVoice) utterance.voice = cachedVoice;

        utterance.onerror = (e) => {
            const errCode = String(e?.error || e?.message || 'unknown');
            if (attempt < 1) {
                setTimeout(() => speakWithRetry(attempt + 1), 220);
                return;
            }
            console.warn('[Nice] TTS native error:', errCode);
        };

        try {
            window.speechSynthesis.speak(utterance);
        } catch (err) {
            if (attempt < 1) {
                setTimeout(() => speakWithRetry(attempt + 1), 220);
                return;
            }
            console.warn('[Nice] TTS speak call failed:', err?.message || err);
        }
    };

    try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
    } catch {
        // Ignore platform-specific resume/cancel failures.
    }

    setTimeout(() => speakWithRetry(0), 60);
}

async function speakWithNativeTts(cleanText) {
    const plugin = await getNativeTtsPlugin();
    if (!plugin?.speak) return false;
    try {
        await plugin.speak({
            text: cleanText,
            rate: ttsRate,
            pitch: 1.0,
            locale: 'en-US',
        });
        return true;
    } catch (err) {
        const message = String(err?.message || err || '').toLowerCase();
        if (message.includes('not_ready') || message.includes('native_tts_not_ready')) {
            _nativeTtsReady = false;
        }
        console.warn('[Nice] Native TTS failed:', err?.message || err);
        return false;
    }
}

export function speak(text) {
    if (!ttsEnabled) return;

    const cleanText = String(text || '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleanText) return;

    if (isNativePlatform()) {
        void (async () => {
            const spokenNatively = await speakWithNativeTts(cleanText);
            if (!spokenNatively) {
                speakWithWebTts(cleanText);
            }
        })();
        return;
    }

    speakWithWebTts(cleanText);
}

export function toggleTTS() {
    return setTTSEnabled(!ttsEnabled);
}

export function isTTSEnabled() {
    return ttsEnabled;
}

export function getTTSSpeed() {
    return ttsRate;
}

// ===== REAL ALARM SYSTEM =====
const activeAlarms = [];
let alarmAudioCtx = null;

export function setRealAlarm(timeStr) {
    const delayMs = parseTimeToDelay(timeStr);

    if (delayMs === null) {
        return { success: false, message: `Couldn't parse time: "${timeStr}"` };
    }

    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    const alarmTime = new Date(Date.now() + delayMs);
    const formattedTime = alarmTime.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
    });

    const alarmId = setTimeout(() => triggerAlarm(formattedTime), delayMs);
    activeAlarms.push({ id: alarmId, time: formattedTime });

    const minutesAway = Math.round(delayMs / 60000);
    const timeLabel = minutesAway < 1 ? 'less than a minute' :
        minutesAway === 1 ? '1 minute' :
            minutesAway < 60 ? `${minutesAway} minutes` :
                `${Math.floor(minutesAway / 60)}h ${minutesAway % 60}m`;

    return {
        success: true,
        message: `Alarm set for **${formattedTime}** (${timeLabel} from now)`,
    };
}

export function cancelAllAlarms() {
    activeAlarms.forEach(a => clearTimeout(a.id));
    const count = activeAlarms.length;
    activeAlarms.length = 0;
    return count;
}

function parseTimeToDelay(timeStr) {
    const text = timeStr.toLowerCase().trim();

    const relativeMatch = text.match(/(?:in\s+)?(\d+)\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?)/i);
    if (relativeMatch) {
        const amount = parseInt(relativeMatch[1], 10);
        const unit = relativeMatch[2].toLowerCase();
        if (unit.startsWith('sec')) return amount * 1000;
        if (unit.startsWith('min')) return amount * 60 * 1000;
        if (unit.startsWith('hour') || unit.startsWith('hr')) return amount * 3600 * 1000;
    }

    const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        const period = timeMatch[3]?.toLowerCase();
        if (period === 'pm' && hours !== 12) hours += 12;
        if (period === 'am' && hours === 12) hours = 0;
        const now = new Date();
        const target = new Date();
        target.setHours(hours, minutes, 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        return target.getTime() - now.getTime();
    }

    return null;
}

function triggerAlarm(timeLabel) {
    playAlarmSound();
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('⏰ Nice Alarm', {
            body: `Alarm for ${timeLabel} is ringing!`,
            icon: '/logo.svg',
            tag: 'nice-alarm', requireInteraction: true,
        });
    }
    showToast(`⏰ Alarm! It's ${timeLabel}`, 'alarm', 10000);
    vibrateDevice([200, 100, 200, 100, 400]); // Vibrate pattern
}

function playAlarmSound() {
    try {
        if (!alarmAudioCtx) alarmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = alarmAudioCtx;
        if (ctx.state === 'suspended') ctx.resume();

        const notes = [523.25, 659.25, 783.99, 1046.50];
        const playChime = (startTime) => {
            notes.forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, startTime + i * 0.2);
                gain.gain.setValueAtTime(0.3, startTime + i * 0.2);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + i * 0.2 + 0.8);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(startTime + i * 0.2);
                osc.stop(startTime + i * 0.2 + 0.8);
            });
        };

        playChime(ctx.currentTime);
        playChime(ctx.currentTime + 1.5);
    } catch (e) {
        console.warn('[Nice] Could not play alarm sound:', e);
    }
}

// ===== TIMER (Countdown) =====
let activeTimer = null;
let timerInterval = null;

export function setTimer(durationStr) {
    const ms = parseTimerDuration(durationStr);
    if (ms === null) return { success: false, message: `Couldn't understand duration: "${durationStr}"` };

    // Cancel any existing timer
    cancelTimer();

    const endTime = Date.now() + ms;
    activeTimer = { endTime, totalMs: ms };
    void startNativeTimerBubble(endTime);

    // Show live countdown in a toast
    updateTimerDisplay();
    timerInterval = setInterval(() => {
        const remaining = activeTimer.endTime - Date.now();
        if (remaining <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            activeTimer = null;
            void stopNativeTimerBubble();
            triggerTimerDone();
        } else {
            updateTimerDisplay();
            void updateNativeTimerBubble(activeTimer.endTime);
        }
    }, 1000);

    const label = formatDuration(ms);
    return { success: true, message: `Timer set for **${label}**. I'll alert you when it's done.` };
}

export function cancelTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    activeTimer = null;
    void stopNativeTimerBubble();
    removeTimerDisplay();
    return true;
}

export function getTimerStatus() {
    if (!activeTimer) return 'No timer running.';
    const remaining = activeTimer.endTime - Date.now();
    if (remaining <= 0) return 'Timer just finished!';
    return `Timer: **${formatDuration(remaining)}** remaining.`;
}

function parseTimerDuration(str) {
    const text = str.toLowerCase().trim();
    let totalMs = 0;
    let found = false;

    const hourMatch = text.match(/(\d+)\s*(?:hours?|hrs?)/);
    if (hourMatch) { totalMs += parseInt(hourMatch[1]) * 3600000; found = true; }

    const minMatch = text.match(/(\d+)\s*(?:minutes?|mins?)/);
    if (minMatch) { totalMs += parseInt(minMatch[1]) * 60000; found = true; }

    const secMatch = text.match(/(\d+)\s*(?:seconds?|secs?)/);
    if (secMatch) { totalMs += parseInt(secMatch[1]) * 1000; found = true; }

    // Simple number assumed as minutes
    if (!found) {
        const numMatch = text.match(/(\d+)/);
        if (numMatch) { totalMs = parseInt(numMatch[1]) * 60000; found = true; }
    }

    return found ? totalMs : null;
}

function formatDuration(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function updateTimerDisplay() {
    if (!activeTimer) return;
    let el = document.getElementById('timerFloating');
    if (!el) {
        el = document.createElement('div');
        el.id = 'timerFloating';
        el.className = 'timer-floating visible';
        el.innerHTML = '<span class="timer-icon">⏱️</span><span class="timer-time" id="timerTime"></span>';
        document.body.appendChild(el);
    }
    const remaining = activeTimer.endTime - Date.now();
    document.getElementById('timerTime').textContent = formatDuration(Math.max(0, remaining));
}

function removeTimerDisplay() {
    const el = document.getElementById('timerFloating');
    if (el) { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }
}

function triggerTimerDone() {
    void stopNativeTimerBubble();
    removeTimerDisplay();
    playAlarmSound();
    vibrateDevice([300, 100, 300, 100, 600]);
    showToast('⏱️ Timer done!', 'alarm', 8000);
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('⏱️ Timer Done!', {
            body: 'Your countdown timer has finished.',
            icon: '/logo.svg', tag: 'nice-timer',
        });
    }
}

// ===== STOPWATCH =====
let stopwatchStart = null;
let stopwatchRunning = false;
let stopwatchElapsed = 0;
let stopwatchInterval = null;

export function startStopwatch() {
    if (stopwatchRunning) return { message: `Stopwatch already running. ${getStopwatchTime()}` };
    stopwatchStart = Date.now() - stopwatchElapsed;
    stopwatchRunning = true;

    let el = document.getElementById('stopwatchFloating');
    if (!el) {
        el = document.createElement('div');
        el.id = 'stopwatchFloating';
        el.className = 'timer-floating visible';
        el.innerHTML = '<span class="timer-icon">⏱️</span><span class="timer-time" id="stopwatchTime">0:00</span>';
        document.body.appendChild(el);
    } else {
        el.classList.add('visible');
    }

    stopwatchInterval = setInterval(() => {
        stopwatchElapsed = Date.now() - stopwatchStart;
        const el = document.getElementById('stopwatchTime');
        if (el) el.textContent = formatStopwatch(stopwatchElapsed);
    }, 100);

    return { message: 'Stopwatch started! ⏱️ Say "stop stopwatch" to stop.' };
}

export function stopStopwatch() {
    if (!stopwatchRunning) return { message: 'No stopwatch running.' };
    clearInterval(stopwatchInterval);
    stopwatchRunning = false;
    stopwatchElapsed = Date.now() - stopwatchStart;
    const time = formatStopwatch(stopwatchElapsed);

    const el = document.getElementById('stopwatchFloating');
    if (el) { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }

    return { message: `Stopwatch stopped at **${time}**.` };
}

export function resetStopwatch() {
    clearInterval(stopwatchInterval);
    stopwatchRunning = false;
    stopwatchElapsed = 0;
    stopwatchStart = null;

    const el = document.getElementById('stopwatchFloating');
    if (el) { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }

    return { message: 'Stopwatch reset to 0:00.' };
}

function formatStopwatch(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const tenths = Math.floor((ms % 1000) / 100);
    return `${m}:${s.toString().padStart(2, '0')}.${tenths}`;
}

function getStopwatchTime() {
    if (!stopwatchRunning && stopwatchElapsed === 0) return '';
    return formatStopwatch(stopwatchRunning ? Date.now() - stopwatchStart : stopwatchElapsed);
}

// ===== REAL NOTES (localStorage) =====
const NOTES_KEY = 'nice_notes';

export function saveNote(content) {
    const notes = getNotes();
    notes.push({ id: Date.now(), content, createdAt: new Date().toLocaleString() });
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));

    // On Android, also try to open native notes app with the content
    if (isAndroid()) {
        openNativeNotesApp(content);
    }

    return notes.length;
}

// Try to open native notes app on Android with the note content
async function openNativeNotesApp(noteContent) {
    // Strategy 1: Use an Android SEND intent to pass the note text to any notes app
    try {
        const encodedText = encodeURIComponent(noteContent);
        const intentUrl = `intent:#Intent;action=android.intent.action.SEND;type=text/plain;S.android.intent.extra.TEXT=${encodedText};end`;
        const a = document.createElement('a');
        a.href = intentUrl;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 300);
        console.log('[Nice] Opened notes via SEND intent with text');
        showToast('📝 Note saved & opening notes app...', 'info');
        return;
    } catch (e) {
        console.warn('[Nice] SEND intent failed:', e);
    }

    // Strategy 2: Try specific notes app packages via AppLauncher
    const notePackages = [
        'com.google.android.keep',
        'com.samsung.android.app.notes',
        'com.miui.notes',
        'com.oneplus.note',
    ];

    for (const pkg of notePackages) {
        try {
            const { value } = await AppLauncher.canOpenUrl({ url: pkg });
            if (value) {
                await AppLauncher.openUrl({ url: pkg });
                console.log(`[Nice] Opened notes app: ${pkg}`);
                return;
            }
        } catch { continue; }
    }

    // Fallback: show toast that note was saved locally
    console.log('[Nice] Could not open native notes app, note saved locally');
    showToast('📝 Note saved! No notes app found — saved locally.', 'info');
}

export function getNotes() {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '[]'); }
    catch { return []; }
}

export function deleteAllNotes() { localStorage.removeItem(NOTES_KEY); }

export function formatNotesForDisplay() {
    const notes = getNotes();
    if (notes.length === 0) return 'No notes saved yet. Say "Note: [your text]" to save one.';
    return notes.map((n, i) => `${i + 1}. "${n.content}" — ${n.createdAt}`).join('\n');
}

// ===== MUSIC PLAYBACK (Real Files + Web Audio Fallback) =====
import { findAudioFiles, playAudioFile, pauseRealAudio, resumeRealAudio, stopRealAudio, isRealAudioPlaying } from './filesys.js';

let musicAudioCtx = null;
let musicPlaying = false;
let musicNodes = [];
let musicInterval = null;

export async function playMusic(songName) {
    stopMusic();

    const requestedSong = String(songName || '').trim();
    const genericNames = ['a song', 'music', 'something', 'anything', 'some music', 'a track', 'random', 'any song'];
    const isGeneric = genericNames.includes(requestedSong.toLowerCase());

    // Try to find a real audio file first
    try {
        if (isGeneric) {
            const allAudio = findAudioFiles('');
            if (allAudio.length > 0) {
                const randomFile = allAudio[Math.floor(Math.random() * allAudio.length)];
                const result = await playAudioFile(randomFile);
                if (result.success) return result.message;
                return result.message || 'I found audio files but could not start playback. Please check media volume and try again.';
            }
        } else {
            const audioResults = findAudioFiles(requestedSong);
            if (audioResults.length > 0) {
                const result = await playAudioFile(audioResults[0]);
                if (result.success) return result.message;
                return result.message || (`I found "${requestedSong}" but could not start playback.`);
            }

            // Check if there ARE audio files but none matched by name
            const allAudio = findAudioFiles('');
            if (allAudio.length > 0) {
                const songList = allAudio.slice(0, 8).map((f) => {
                    const name = f.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
                    return `- ${name}`;
                }).join('\n');
                return `I couldn't find "${requestedSong}" in your music library.\n\nHere are some songs I found:\n${songList}\n\nTry saying **"play [song name]"** with one of these.`;
            }
        }
    } catch (e) {
        console.warn('[Nice] Audio file search error:', e);
    }

    // No local audio files at all, try native music app on Android.
    if (isAndroid()) {
        try {
            try {
                const { value } = await AppLauncher.canOpenUrl({ url: 'com.spotify.music' });
                if (value) {
                    await AppLauncher.openUrl({ url: 'com.spotify.music' });
                    return `Opening **Spotify** to play "${requestedSong}"...`;
                }
            } catch { }

            try {
                const { value } = await AppLauncher.canOpenUrl({ url: 'com.google.android.apps.youtube.music' });
                if (value) {
                    await AppLauncher.openUrl({ url: 'com.google.android.apps.youtube.music' });
                    return `Opening **YouTube Music** to play "${requestedSong}"...`;
                }
            } catch { }

            try {
                const { value } = await AppLauncher.canOpenUrl({ url: 'com.google.android.youtube' });
                if (value) {
                    await AppLauncher.openUrl({ url: 'com.google.android.youtube' });
                    return `Opening **YouTube** to search for "${requestedSong}"...`;
                }
            } catch { }
        } catch (e) {
            console.warn('[Nice] Music app launch error:', e);
        }
    }

    // Web fallback: generated melody demo when no real audio source is available
    try {
        if (!musicAudioCtx) musicAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = musicAudioCtx;
        if (ctx.state === 'suspended') await ctx.resume();
        musicPlaying = true;

        const seedText = requestedSong || 'music';
        const hash = seedText.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const scales = [
            [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25],
            [293.66, 329.63, 369.99, 392.00, 440.00, 493.88, 554.37, 587.33],
            [329.63, 369.99, 415.30, 440.00, 493.88, 554.37, 622.25, 659.25],
        ];
        const scale = scales[hash % scales.length];
        let noteIndex = hash % scale.length;

        function playNext() {
            if (!musicPlaying) return;
            try {
                const freq = scale[noteIndex % scale.length];
                const dur = 0.25 + (noteIndex % 3) * 0.1;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = noteIndex % 3 === 0 ? 'triangle' : 'sine';
                osc.frequency.setValueAtTime(freq, ctx.currentTime);
                gain.gain.setValueAtTime(0.15, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + dur);
                musicNodes.push(osc);
                // Prune stopped nodes to prevent unbounded growth during long playback
                if (musicNodes.length > 20) {
                    musicNodes = musicNodes.slice(-10);
                }
                noteIndex++;
            } catch (e) {
                console.warn('[Nice] Melody note error:', e);
                clearInterval(musicInterval);
                musicPlaying = false;
            }
        }

        playNext();
        musicInterval = setInterval(() => {
            if (musicPlaying) playNext();
            else clearInterval(musicInterval);
        }, 400);
        updateMusicPlayer(seedText, true);
        return `Now playing **${seedText}** (generated melody demo)`;
    } catch (e) {
        console.warn('[Nice] Music playback error:', e);
        return 'I could not start music playback. Try scanning your files again or checking your device volume.';
    }
}
export function pauseMusic() {
    // Try real audio first
    if (pauseRealAudio()) return;
    // Fallback
    musicPlaying = false;
    if (musicInterval) clearInterval(musicInterval);
    if (musicAudioCtx?.state === 'running') musicAudioCtx.suspend();
    updateMusicPlayer(null, false);
}

export function resumeMusic() {
    // Try real audio first
    if (resumeRealAudio()) return;
    // Fallback
    if (musicAudioCtx?.state === 'suspended') {
        musicAudioCtx.resume(); musicPlaying = true; updateMusicPlayer(null, true);
        musicInterval = setInterval(() => {
            if (!musicPlaying) { clearInterval(musicInterval); return; }
            const ctx = musicAudioCtx;
            const freq = [261.63, 329.63, 392.00, 523.25][Math.floor(Math.random() * 4)];
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(); osc.stop(ctx.currentTime + 0.35);
        }, 400);
    }
}

export function stopMusic() {
    stopRealAudio();
    musicPlaying = false;
    if (musicInterval) clearInterval(musicInterval);
    musicNodes.forEach(n => { try { n.stop(); } catch { } });
    musicNodes = [];
    updateMusicPlayer(null, false);
}

export function isMusicPlaying() { return musicPlaying || isRealAudioPlaying(); }

function updateMusicPlayer(songName, isPlaying) {
    let player = document.getElementById('musicPlayer');
    if (!player) {
        player = document.createElement('div');
        player.id = 'musicPlayer'; player.className = 'music-player';
        player.innerHTML = `<div class="music-player-content"><span class="music-icon">🎵</span><span class="music-title" id="musicTitle">Now Playing</span><div class="music-controls"><button class="music-ctrl-btn" id="musicPauseResume" aria-label="Pause/Resume">⏸️</button><button class="music-ctrl-btn" id="musicStop" aria-label="Stop">⏹️</button></div></div>`;
        document.body.appendChild(player);
        document.getElementById('musicPauseResume').addEventListener('click', () => { if (isMusicPlaying()) pauseMusic(); else resumeMusic(); });
        document.getElementById('musicStop').addEventListener('click', stopMusic);
    }
    if (songName) document.getElementById('musicTitle').textContent = `Now Playing: ${songName}`;
    const btn = document.getElementById('musicPauseResume');
    if (btn) btn.textContent = isPlaying ? '⏸️' : '▶️';
    player.classList.toggle('visible', isPlaying);
}
// ===== APP/URL LAUNCHER (Android-native intent support) =====
import { AppLauncher } from '@capacitor/app-launcher';

// Android package names for native app launching
const ANDROID_PACKAGES = {
    'notes': ['com.google.android.keep', 'com.samsung.android.app.notes', 'com.miui.notes', 'com.oneplus.note'],
    'keep': ['com.google.android.keep'],
    'google keep': ['com.google.android.keep'],
    'maps': ['com.google.android.apps.maps'],
    'google maps': ['com.google.android.apps.maps'],
    'youtube': ['com.google.android.youtube'],
    'calendar': ['com.google.android.calendar', 'com.samsung.android.calendar'],
    'gmail': ['com.google.android.gm'],
    'mail': ['com.google.android.gm'],
    'email': ['com.google.android.gm', 'com.samsung.android.email.provider'],
    'messages': ['com.google.android.apps.messaging', 'com.samsung.android.messaging'],
    'sms': ['com.google.android.apps.messaging'],
    'photos': ['com.google.android.apps.photos'],
    'google photos': ['com.google.android.apps.photos'],
    'drive': ['com.google.android.apps.docs'],
    'google drive': ['com.google.android.apps.docs'],
    'chrome': ['com.android.chrome'],
    'browser': ['com.android.chrome'],
    'contacts': ['com.google.android.contacts', 'com.samsung.android.contacts'],
    'phone': ['com.google.android.dialer', 'com.samsung.android.dialer'],
    'dialer': ['com.google.android.dialer'],
    'files': ['com.google.android.apps.nbu.files', 'com.mi.android.globalFileexplorer'],
    'file manager': ['com.google.android.apps.nbu.files'],
    'translate': ['com.google.android.apps.translate'],
    'whatsapp': ['com.whatsapp'],
    'instagram': ['com.instagram.android'],
    'twitter': ['com.twitter.android'],
    'x': ['com.twitter.android'],
    'facebook': ['com.facebook.katana'],
    'spotify': ['com.spotify.music'],
    'netflix': ['com.netflix.mediaclient'],
    'amazon': ['com.amazon.mShop.android.shopping'],
    'reddit': ['com.reddit.frontpage'],
    'linkedin': ['com.linkedin.android'],
    'pinterest': ['com.pinterest'],
    'tiktok': ['com.zhiliaoapp.musically'],
    'telegram': ['org.telegram.messenger'],
    'discord': ['com.discord'],
    'snapchat': ['com.snapchat.android'],
    'zoom': ['us.zoom.videomeetings'],
    'teams': ['com.microsoft.teams'],
    'outlook': ['com.microsoft.office.outlook'],
    'word': ['com.microsoft.office.word'],
    'excel': ['com.microsoft.office.excel'],
    'play store': ['com.android.vending'],
    'store': ['com.android.vending'],
    'gallery': ['com.google.android.apps.photos', 'com.sec.android.gallery3d', 'com.miui.gallery'],
    'music': ['com.google.android.apps.youtube.music', 'com.spotify.music'],
    'clock': ['com.google.android.deskclock', 'com.sec.android.app.clockpackage'],
    'alarm': ['com.google.android.deskclock'],
    'settings': ['com.android.settings'],
    'calculator': ['com.google.android.calculator', 'com.sec.android.app.popupcalculator'],
    'weather': ['com.google.android.apps.weather', 'com.samsung.android.weather'],
    'recorder': ['com.google.android.apps.recorder', 'com.sec.android.app.voicerecorder'],
    'voice recorder': ['com.google.android.apps.recorder'],
};

// Web fallback URLs (used when native app fails or on desktop)
const WEB_URLS = {
    'maps': 'https://www.google.com/maps',
    'google maps': 'https://www.google.com/maps',
    'youtube': 'https://www.youtube.com',
    'calendar': 'https://calendar.google.com',
    'gmail': 'https://mail.google.com',
    'mail': 'https://mail.google.com',
    'email': 'https://mail.google.com',
    'messages': 'https://messages.google.com',
    'photos': 'https://photos.google.com',
    'google photos': 'https://photos.google.com',
    'drive': 'https://drive.google.com',
    'google drive': 'https://drive.google.com',
    'translate': 'https://translate.google.com',
    'google': 'https://www.google.com',
    'whatsapp': 'https://web.whatsapp.com',
    'instagram': 'https://www.instagram.com',
    'twitter': 'https://twitter.com',
    'x': 'https://twitter.com',
    'facebook': 'https://www.facebook.com',
    'spotify': 'https://open.spotify.com',
    'netflix': 'https://www.netflix.com',
    'amazon': 'https://www.amazon.com',
    'reddit': 'https://www.reddit.com',
    'linkedin': 'https://www.linkedin.com',
    'pinterest': 'https://www.pinterest.com',
    'tiktok': 'https://www.tiktok.com',
    'telegram': 'https://web.telegram.org',
    'discord': 'https://discord.com/app',
    'notion': 'https://www.notion.so',
    'figma': 'https://www.figma.com',
    'github': 'https://github.com',
    'chatgpt': 'https://chat.openai.com',
};

// Detect if running on Android
function isAndroid() {
    return /android/i.test(navigator.userAgent);
}

function normalizeAppLookupKey(appName) {
    return String(appName || '')
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/^\s*(?:open|launch|start|run)\s+/i, '')
        .replace(/^\s*(?:the|my|an?)\s+/i, '')
        .replace(/\s+(?:app|application)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function dedupePackages(packages = []) {
    const seen = new Set();
    const output = [];
    for (const value of packages) {
        const pkg = String(value || '').trim();
        if (!pkg || seen.has(pkg)) continue;
        seen.add(pkg);
        output.push(pkg);
    }
    return output;
}

function resolveKnownAppKey(inputKey) {
    if (!inputKey) return '';
    if (ANDROID_PACKAGES[inputKey]) return inputKey;

    const compact = inputKey.replace(/\s+/g, '');
    const keys = Object.keys(ANDROID_PACKAGES);
    for (const key of keys) {
        const lower = key.toLowerCase();
        if (lower === inputKey || lower.replace(/\s+/g, '') === compact) return key;
    }

    let best = '';
    let bestScore = 0;
    for (const key of keys) {
        const lower = key.toLowerCase();
        let score = 0;
        if (lower.includes(inputKey) || inputKey.includes(lower)) {
            score = Math.min(lower.length, inputKey.length);
        } else if (compact && lower.replace(/\s+/g, '').includes(compact)) {
            score = Math.min(lower.length, compact.length) - 1;
        }
        if (score > bestScore) {
            bestScore = score;
            best = key;
        }
    }
    return best || inputKey;
}

const INSTALLED_APPS_CACHE_MS = 2 * 60 * 1000;
let installedKnownKeysCache = new Set();
let installedProbeAt = 0;
let installedLaunchableAppsCache = [];
let installedLaunchableAppsFetchedAt = 0;

function scoreKeySimilarity(inputKey, candidateKey) {
    if (!inputKey || !candidateKey) return 0;
    if (inputKey === candidateKey) return 100;
    const inCompact = inputKey.replace(/\s+/g, '');
    const candCompact = candidateKey.replace(/\s+/g, '');
    if (inCompact === candCompact) return 95;
    if (candidateKey.includes(inputKey) || inputKey.includes(candidateKey)) {
        return Math.min(inputKey.length, candidateKey.length) + 40;
    }
    if (candCompact.includes(inCompact) || inCompact.includes(candCompact)) {
        return Math.min(inCompact.length, candCompact.length) + 30;
    }
    return 0;
}

async function probeInstalledKnownApps(force = false) {
    if (!isAndroid()) return installedKnownKeysCache;
    const now = Date.now();
    if (!force && installedKnownKeysCache.size > 0 && (now - installedProbeAt) < INSTALLED_APPS_CACHE_MS) {
        return installedKnownKeysCache;
    }

    const next = new Set();
    for (const [appKey, packageList] of Object.entries(ANDROID_PACKAGES)) {
        for (const pkg of dedupePackages(packageList)) {
            try {
                const probe = await AppLauncher.canOpenUrl({ url: pkg });
                if (probe?.value) {
                    next.add(String(appKey).toLowerCase());
                    break;
                }
            } catch {
                // Ignore per-package probe errors.
            }
        }
    }

    installedKnownKeysCache = next;
    installedProbeAt = now;
    return installedKnownKeysCache;
}

export async function refreshInstalledAppsCatalog(force = false) {
    if (isAndroid()) {
        const appCatalogPlugin = getAppCatalogPlugin();
        if (appCatalogPlugin && typeof appCatalogPlugin.listInstalledApps === 'function') {
            const now = Date.now();
            if (!force && installedLaunchableAppsCache.length > 0 && (now - installedLaunchableAppsFetchedAt) < INSTALLED_APPS_CACHE_MS) {
                return installedLaunchableAppsCache.map((entry) => entry.label || entry.packageName).filter(Boolean);
            }

            try {
                const result = await appCatalogPlugin.listInstalledApps({ refresh: !!force });
                const apps = Array.isArray(result?.apps) ? result.apps : [];
                installedLaunchableAppsCache = apps
                    .map((entry) => ({
                        label: String(entry?.label || '').trim(),
                        packageName: String(entry?.packageName || '').trim(),
                    }))
                    .filter((entry) => entry.label || entry.packageName);
                installedLaunchableAppsFetchedAt = now;
                return installedLaunchableAppsCache.map((entry) => entry.label || entry.packageName);
            } catch {
                // Fall through to known package probing below.
            }
        }
    }

    const entries = await probeInstalledKnownApps(force);
    return Array.from(entries).sort();
}

function getAppCatalogPlugin() {
    if (!_appCatalogPlugin && !_appCatalogPluginInitAttempted && isNativePlatform()) {
        _appCatalogPluginInitAttempted = true;
        try {
            // Explicitly bind the Capacitor proxy to avoid relying only on window plugin injection timing.
            _appCatalogPlugin = registerPlugin('AppCatalog');
        } catch {
            _appCatalogPlugin = null;
        }
    }
    const plugin = _appCatalogPlugin || window?.Capacitor?.Plugins?.AppCatalog;
    if (!plugin) return null;
    const hasList = typeof plugin.listInstalledApps === 'function';
    const hasLaunch = typeof plugin.launchApp === 'function' || typeof plugin.launchPackage === 'function';
    return hasList || hasLaunch ? plugin : null;
}

async function tryLaunchInstalledAppByQuery(query) {
    const plugin = getAppCatalogPlugin();
    const text = String(query || '').trim();
    if (!plugin || !text || typeof plugin.launchApp !== 'function') return { opened: false };
    try {
        const result = await plugin.launchApp({ query: text });
        if (result?.opened) {
            return {
                opened: true,
                label: String(result.label || text),
                packageName: String(result.packageName || ''),
            };
        }
    } catch {
        // ignore and allow normal fallback path
    }

    // Fallback path for devices where fuzzy launchApp can fail despite having a valid installed app catalog.
    if (typeof plugin.launchPackage === 'function') {
        try {
            if (!installedLaunchableAppsCache.length) {
                await refreshInstalledAppsCatalog(false);
            }
            const queryKey = normalizeAppLookupKey(text);
            let bestEntry = null;
            let bestScore = 0;
            for (const entry of installedLaunchableAppsCache) {
                const labelKey = normalizeAppLookupKey(entry?.label || '');
                const pkgKey = normalizeAppLookupKey(entry?.packageName || '');
                const score = Math.max(
                    scoreKeySimilarity(queryKey, labelKey),
                    scoreKeySimilarity(queryKey, pkgKey),
                );
                if (score > bestScore) {
                    bestScore = score;
                    bestEntry = entry;
                }
            }

            if (bestEntry?.packageName && bestScore >= 60) {
                const launched = await plugin.launchPackage({ packageName: bestEntry.packageName });
                if (launched?.opened) {
                    return {
                        opened: true,
                        label: String(bestEntry.label || text),
                        packageName: String(bestEntry.packageName),
                    };
                }
            }
        } catch {
            // ignore and allow remaining fallback path
        }
    }
    return { opened: false };
}

function canUseNetworkFallback() {
    if (isOfflineHardLocked()) return false;
    return isOnlineAllowed('any');
}

function isNetworkUrl(url) {
    const value = String(url || '').toLowerCase();
    return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('market://');
}

function isBlockedProtocol(url) {
    const value = String(url || '').trim().toLowerCase();
    return value.startsWith('javascript:') || value.startsWith('data:') || value.startsWith('file:') || value.startsWith('blob:');
}

function safeOpenWindow(url, { requireNetwork = false } = {}) {
    const raw = String(url || '').trim();
    if (!raw || isBlockedProtocol(raw)) return false;

    const networkTarget = isNetworkUrl(raw);
    if ((requireNetwork || networkTarget) && !canUseNetworkFallback()) {
        return false;
    }

    try {
        window.open(raw, '_blank', 'noopener,noreferrer');
        return true;
    } catch {
        return false;
    }
}

// Deep link URL schemes that directly open installed apps
const DEEP_LINK_SCHEMES = {
    'com.google.android.youtube': 'https://www.youtube.com',
    'com.whatsapp': 'whatsapp://',
    'com.instagram.android': 'instagram://',
    'com.twitter.android': 'twitter://',
    'com.facebook.katana': 'fb://',
    'com.spotify.music': 'spotify://',
    'com.google.android.apps.maps': 'https://maps.google.com',
    'com.google.android.gm': 'googlegmail://',
    'com.google.android.apps.photos': 'https://photos.google.com',
    'com.google.android.apps.docs': 'https://drive.google.com',
    'com.google.android.calendar': 'https://calendar.google.com',
    'com.google.android.apps.translate': 'https://translate.google.com',
    'org.telegram.messenger': 'tg://',
    'com.discord': 'discord://',
    'com.snapchat.android': 'snapchat://',
    'com.pinterest': 'pinterest://',
    'com.linkedin.android': 'linkedin://',
    'com.reddit.frontpage': 'reddit://',
    'us.zoom.videomeetings': 'zoomus://',
    'com.netflix.mediaclient': 'nflx://',
    'com.google.android.apps.messaging': 'sms:',
    'com.google.android.dialer': 'tel:',
    'com.google.android.contacts': 'content://contacts',
    'com.android.chrome': 'googlechrome://',
    'com.google.android.deskclock': 'clock://',
    'com.microsoft.teams': 'msteams://',
    'com.microsoft.office.outlook': 'ms-outlook://',
};

function dispatchIntentUrl(intentUrl) {
    try {
        const a = document.createElement('a');
        a.href = intentUrl;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 220);
        return true;
    } catch {
        return false;
    }
}

async function attemptPackageLaunch(packageName, appName) {
    if (!packageName) return { opened: false };

    // Strategy 1: direct package open first (works even when canOpenUrl is false on Android 11+).
    try {
        await AppLauncher.openUrl({ url: packageName });
        return { opened: true, message: `Opening **${appName}** on your device... 📱` };
    } catch {
        // continue
    }

    // Strategy 2: probe + open when package visibility is available.
    try {
        const probe = await AppLauncher.canOpenUrl({ url: packageName });
        if (probe?.value) {
            await AppLauncher.openUrl({ url: packageName });
            return { opened: true, message: `Opening **${appName}** on your device... 📱` };
        }
    } catch {
        // continue
    }

    // Strategy 3: non-network deep link scheme.
    const deepLink = DEEP_LINK_SCHEMES[packageName];
    if (deepLink && !isNetworkUrl(deepLink)) {
        if (safeOpenWindow(deepLink, { requireNetwork: false })) {
            return { opened: true, message: `Opening **${appName}** on your device... 📱` };
        }
    }

    // Strategy 4: explicit Android launcher intent.
    const intentUrl = `intent://main/#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${packageName};end`;
    if (dispatchIntentUrl(intentUrl)) {
        return { opened: true, message: `Opening **${appName}** on your device... 📱` };
    }

    return { opened: false };
}

// Try to open a native Android app using multiple package candidates and fallbacks.
async function tryOpenAndroidApp(packageNames, appName) {
    const uniquePackages = dedupePackages(Array.isArray(packageNames) ? packageNames : [packageNames]);

    for (const packageName of uniquePackages) {
        const launched = await attemptPackageLaunch(packageName, appName);
        if (launched.opened) {
            return launched.message;
        }
    }

    const fallbackKey = Object.keys(ANDROID_PACKAGES).find((k) =>
        dedupePackages(ANDROID_PACKAGES[k]).some((pkg) => uniquePackages.includes(pkg))
    );
    const webUrl = fallbackKey ? WEB_URLS[fallbackKey] : null;
    if (webUrl && canUseNetworkFallback() && safeOpenWindow(webUrl, { requireNetwork: true })) {
        return `I couldn't open a native package for **${appName}**. Opening web fallback... 🌐`;
    }

    if (!canUseNetworkFallback()) {
        return `I couldn't confirm an installed package for **${appName}**. Offline-only mode is active, so internet fallback is disabled.`;
    }

    if (uniquePackages.length > 0) {
        const playStoreUrl = `market://details?id=${encodeURIComponent(uniquePackages[0])}`;
        try {
            await AppLauncher.openUrl({ url: playStoreUrl });
            return `I couldn't find a launchable package for **${appName}**. Opening Play Store listing... 🔍`;
        } catch {
            safeOpenWindow(`https://play.google.com/store/search?q=${encodeURIComponent(appName)}&c=apps`, { requireNetwork: true });
            return `I couldn't find a launchable package for **${appName}**. Opening Play Store search... 🔍`;
        }
    }

    return `I couldn't find **${appName}** installed.`;
}





export function launchApp(appName) {
    const rawName = String(appName || '').trim();
    const key = normalizeAppLookupKey(rawName);
    const resolvedKey = resolveKnownAppKey(key);
    const displayName = rawName || resolvedKey || 'app';
    const looksLikeAndroidPackage = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(key);

    // --- Built-in handlers (no need to open external apps) ---
    if (key === 'camera') {
        openCamera();
        return { action: 'camera', message: 'Opening your camera...' };
    }
    if (key === 'calculator' || key === 'calc') {
        if (isAndroid() && ANDROID_PACKAGES['calculator']) {
            return {
                action: 'opened',
                asyncAction: async () => await tryOpenAndroidApp(ANDROID_PACKAGES['calculator'], 'Calculator')
            };
        }
        return { action: 'info', message: 'I have a built-in calculator! Type any math like "145 * 32".' };
    }
    if (key === 'clock' || key === 'time') {
        if (isAndroid() && ANDROID_PACKAGES['clock']) {
            return {
                action: 'opened',
                asyncAction: async () => await tryOpenAndroidApp(ANDROID_PACKAGES['clock'], 'Clock')
            };
        }
        const now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        return { action: 'info', message: `The current time is **${now}**.` };
    }
    if (key === 'notes' || key === 'note') {
        if (isAndroid() && ANDROID_PACKAGES['notes']) {
            return {
                action: 'opened',
                asyncAction: async () => {
                    const msg = await tryOpenAndroidApp(ANDROID_PACKAGES['notes'], 'Notes');
                    return `${msg}\n\n_If the app didn't open, I'll show your Nice notes instead._`;
                }
            };
        }
        return { action: 'notes', message: formatNotesForDisplay() };
    }
    if (key === 'settings') {
        if (isAndroid()) {
            return {
                action: 'opened',
                asyncAction: async () => await tryOpenAndroidApp(['com.android.settings'], 'Settings')
            };
        }
        return { action: 'info', message: 'Nice settings: TTS is ' + (ttsEnabled ? 'ON' : 'OFF') + '. Say "mute" to toggle.' };
    }
    if (key === 'flashlight' || key === 'torch') { return toggleFlashlight(); }

    // --- Try native Android app first ---
    if (isAndroid()) {
        if (looksLikeAndroidPackage) {
            return {
                action: 'opened',
                asyncAction: async () => await tryOpenAndroidApp([key], key),
            };
        }

        return {
            action: 'opened',
            asyncAction: async () => {
                // 1) Native app-catalog route (launch by label for any installed app).
                const launchQueries = Array.from(new Set([
                    displayName,
                    key,
                    resolvedKey,
                    rawName,
                ].map((value) => String(value || '').trim()).filter(Boolean)));

                for (const query of launchQueries) {
                    const launched = await tryLaunchInstalledAppByQuery(query);
                    if (launched.opened) {
                        return `Opening **${launched.label || displayName}** on your device... 📱`;
                    }
                }

                // 2) Known package map route.
                const packages = dedupePackages(ANDROID_PACKAGES[resolvedKey] || ANDROID_PACKAGES[key] || []);
                if (packages.length > 0) {
                    return tryOpenAndroidApp(packages, displayName);
                }

                // 3) Known-key fuzzy fallback from package visibility probing.
                const installedKeys = await probeInstalledKnownApps(false);
                let bestKey = '';
                let bestScore = 0;

                for (const knownKey of installedKeys) {
                    const score = scoreKeySimilarity(key, knownKey);
                    if (score > bestScore) {
                        bestScore = score;
                        bestKey = knownKey;
                    }
                }

                if (bestKey && bestScore >= 45 && ANDROID_PACKAGES[bestKey]) {
                    return tryOpenAndroidApp(ANDROID_PACKAGES[bestKey], bestKey);
                }

                // 4) Online store fallback only when online mode is allowed.
                if (!canUseNetworkFallback()) {
                    return `I couldn't find an installed app matching **${displayName}**. Offline-only mode is active, so internet fallback is disabled.`;
                }

                const playStoreFallback = `market://search?q=${encodeURIComponent(displayName)}&c=apps`;
                try {
                    await AppLauncher.openUrl({ url: playStoreFallback });
                    return `I couldn't find an installed app matching **${displayName}**. Opening Play Store search... 🔍`;
                } catch {
                    safeOpenWindow(`https://play.google.com/store/search?q=${encodeURIComponent(displayName)}&c=apps`, { requireNetwork: true });
                    return `I couldn't find an installed app matching **${displayName}**. Opening Play Store search... 🔍`;
                }
            },
        };
    }

    // --- Fallback: Try web URL ---
    const webKey = WEB_URLS[resolvedKey] ? resolvedKey : key;
    const webUrl = WEB_URLS[webKey];
    if (webUrl) {
        if (!canUseNetworkFallback()) {
            return { action: 'blocked', message: `I couldn't open **${displayName}**. Web fallback is disabled in offline-only mode.` };
        }
        safeOpenWindow(webUrl, { requireNetwork: true });
        return { action: 'opened', message: `Opening **${displayName}**... 🌐` };
    }

    // --- Last resort: Google search ---
    if (!canUseNetworkFallback()) {
        return { action: 'blocked', message: `I couldn't find **${displayName}** locally, and offline-only mode blocks web fallback.` };
    }
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(displayName + ' web app')}`;
    safeOpenWindow(searchUrl, { requireNetwork: true });
    return { action: 'search', message: `I searched for "${displayName}" for you. 🔍` };
}

// ===== CAMERA =====
function openCamera() {
    // On Android, try to open native camera app first
    if (isAndroid()) {
        openNativeCamera();
        return;
    }

    // Web/Desktop: Use getUserMedia
    openWebCamera();
}

async function openNativeCamera() {
    // The most reliable way to trigger the native camera on Android WebViews
    // is to use a hidden file input with capture="environment"
    try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment';
        input.style.display = 'none';

        // Listen for when they take the photo (or cancel)
        input.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                console.log('[Nice] Photo captured natively:', e.target.files[0].name);
                // We could process the photo here, but for now just opening it is the goal
            }
            input.remove();
        });

        document.body.appendChild(input);

        // Slightly delay the click to ensure DOM registration
        setTimeout(() => input.click(), 50);
        console.log('[Nice] Opened native camera via HTML5 capture API');
        return;
    } catch (e) {
        console.warn('[Nice] Native camera input failed:', e);
    }

    // Fallback: Use web camera modal (getUserMedia)
    console.log('[Nice] No native camera app found, using web camera');
    openWebCamera();
}

function openWebCamera() {
    let modal = document.getElementById('cameraModal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'cameraModal'; modal.className = 'camera-modal';
    modal.innerHTML = `<div class="camera-modal-content"><div class="camera-header"><span>📸 Camera</span><button class="camera-close" id="cameraClose" aria-label="Close camera">✕</button></div><video id="cameraVideo" autoplay playsinline></video><div class="camera-actions"><button class="camera-capture-btn" id="cameraCapture">📷 Capture</button></div><canvas id="cameraCanvas" style="display:none;"></canvas></div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('visible'));

    const video = document.getElementById('cameraVideo');
    let stream = null;

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then(s => { stream = s; video.srcObject = stream; })
        .catch(() => {
            video.style.display = 'none';
            const err = document.createElement('div');
            err.style.cssText = 'padding:40px;text-align:center;color:var(--text-muted);';
            err.textContent = '🚫 Camera access denied. Please allow camera permission in your device settings.';
            modal.querySelector('.camera-modal-content').insertBefore(err, modal.querySelector('.camera-actions'));
        });

    document.getElementById('cameraClose').addEventListener('click', () => {
        if (stream) stream.getTracks().forEach(t => t.stop());
        modal.classList.remove('visible');
        setTimeout(() => modal.remove(), 300);
    });

    document.getElementById('cameraCapture').addEventListener('click', () => {
        if (!video.videoWidth) return;
        const canvas = document.getElementById('cameraCanvas');
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        canvas.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `nice-photo-${Date.now()}.jpg`; a.click();
            URL.revokeObjectURL(url);
            showToast('📸 Photo saved!', 'success');
        }, 'image/jpeg', 0.9);
    });
}

// ===== FLASHLIGHT / TORCH =====
let torchStream = null;

export function toggleFlashlight() {
    if (torchStream) {
        torchStream.getTracks().forEach(t => t.stop());
        torchStream = null;
        return { action: 'flashlight', message: 'Flashlight turned **OFF**. 🔦' };
    }

    // Request camera with torch
    return navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
    }).then(stream => {
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities?.();
        if (caps && caps.torch) {
            track.applyConstraints({ advanced: [{ torch: true }] });
            torchStream = stream;
            return { action: 'flashlight', message: 'Flashlight turned **ON**! 🔦' };
        } else {
            stream.getTracks().forEach(t => t.stop());
            return { action: 'flashlight', message: 'Your device does not support flashlight control. Try opening the Camera instead.' };
        }
    }).catch(() => {
        return { action: 'flashlight', message: 'Could not access flashlight. Camera permission may be needed.' };
    });
}

// ===== BATTERY STATUS =====
export async function getBatteryStatus() {
    // 1. Native Android DeviceBridge
    if (isNativePlatform()) {
        const bridge = getDeviceBridgePlugin();
        if (bridge && typeof bridge.getBatteryInfo === 'function') {
            try {
                const info = await bridge.getBatteryInfo();
                if (info && typeof info.level === 'number') {
                    const level = info.level <= 1 ? Math.round(info.level * 100) : Math.round(info.level);
                    const charging = !!info.isCharging;
                    const plugType = String(info.plugType || '').trim();
                    const isPowerSave = !!info.isPowerSaveMode;

                    let msg = `Battery: **${level}%** ${charging ? '⚡ Charging' : '🔋 Discharging'}`;
                    if (charging && plugType && plugType !== 'NONE' && plugType !== 'Unplugged' && plugType !== 'Unknown') {
                        msg += ` via ${plugType}`;
                    }
                    if (isPowerSave) {
                        msg += `\n\n⚠️ **Power Saver Mode** is active on your device.`;
                    } else if (!charging && level <= 20) {
                        msg += `\n\n⚠️ Battery is low (**${level}%**). Consider plugging in your device.`;
                    }
                    return msg;
                }
            } catch (err) {
                console.warn('[Nice] Native DeviceBridge.getBatteryInfo failed:', err);
            }
        }
    }

    // 2. Web Battery API fallback
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.getBattery === 'function') {
            const battery = await navigator.getBattery();
            const level = Math.round(battery.level * 100);
            const charging = !!battery.charging;
            const timeLeft = battery.dischargingTime;

            let msg = `Battery: **${level}%** ${charging ? '⚡ Charging' : '🔋 Discharging'}`;
            if (!charging && timeLeft && isFinite(timeLeft) && timeLeft > 0) {
                const hrs = Math.floor(timeLeft / 3600);
                const mins = Math.floor((timeLeft % 3600) / 60);
                msg += ` — about ${hrs}h ${mins}m remaining`;
            }
            if (!charging && level <= 20) {
                msg += `\n\n⚠️ Battery is low (**${level}%**).`;
            }
            return msg;
        }
        return 'Battery API is not supported on this browser (supported natively on Android). 🔋';
    } catch {
        return 'Unable to read battery status on this device.';
    }
}

// ===== VIBRATION =====
export function vibrateDevice(pattern = [200]) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(pattern);
        return true;
    }
    return false;
}

// ===== CLIPBOARD =====
export async function copyToClipboard(text) {
    const content = String(text || '');
    if (isNativePlatform()) {
        const bridge = getDeviceBridgePlugin();
        if (bridge && typeof bridge.writeClipboard === 'function') {
            try {
                const res = await bridge.writeClipboard({ text: content });
                if (res?.success !== false) {
                    if (typeof showToast === 'function') {
                        showToast('📋 Copied to clipboard!', 'success');
                    }
                    return { success: true, message: 'Copied to clipboard! 📋' };
                }
            } catch (err) {
                console.warn('[Nice] Native DeviceBridge.writeClipboard failed:', err);
            }
        }
    }

    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(content);
            if (typeof showToast === 'function') {
                showToast('📋 Copied to clipboard!', 'success');
            }
            return { success: true, message: 'Copied to clipboard! 📋' };
        }
        if (typeof document !== 'undefined' && document.body) {
            const textarea = document.createElement('textarea');
            textarea.value = content;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            const copied = document.execCommand ? document.execCommand('copy') : false;
            document.body.removeChild(textarea);
            if (copied) {
                if (typeof showToast === 'function') {
                    showToast('📋 Copied to clipboard!', 'success');
                }
                return { success: true, message: 'Copied to clipboard! 📋' };
            }
        }
        return { success: false, message: 'Unable to copy. Clipboard access may be blocked.' };
    } catch {
        return { success: false, message: 'Unable to copy. Clipboard access may be blocked.' };
    }
}

export async function readFromClipboard() {
    if (isNativePlatform()) {
        const bridge = getDeviceBridgePlugin();
        if (bridge && typeof bridge.readClipboard === 'function') {
            try {
                const res = await bridge.readClipboard();
                const text = String(res?.text || '').trim();
                const hasContent = typeof res?.hasContent === 'boolean' ? res.hasContent : !!text;
                return {
                    success: true,
                    text: res?.text ?? text,
                    hasContent,
                    message: text ? `Clipboard content:\n\n${text}` : 'Your clipboard is empty. 📋',
                };
            } catch (err) {
                console.warn('[Nice] Native DeviceBridge.readClipboard failed:', err);
            }
        }
    }

    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
            const rawText = await navigator.clipboard.readText();
            const text = String(rawText || '');
            const trimmed = text.trim();
            return {
                success: true,
                text,
                hasContent: !!trimmed,
                message: trimmed ? `Clipboard content:\n\n${trimmed}` : 'Your clipboard is empty. 📋',
            };
        }
        return {
            success: false,
            text: '',
            hasContent: false,
            message: 'Clipboard reading is not supported by this browser (supported natively on Android).',
        };
    } catch (err) {
        return {
            success: false,
            text: '',
            hasContent: false,
            message: 'Unable to read clipboard. Please ensure clipboard permission is granted.',
        };
    }
}

// ===== CONTACTS LOOKUP =====
export async function lookupContact(query) {
    const rawQuery = String(query || '').trim();
    if (!rawQuery) {
        return {
            success: false,
            found: false,
            contacts: [],
            message: 'Please provide a name or phone number to look up.',
        };
    }

    // 1. Native Android DeviceBridge
    if (isNativePlatform()) {
        const bridge = getDeviceBridgePlugin();
        if (bridge && typeof bridge.searchContacts === 'function') {
            try {
                const res = await bridge.searchContacts({ query: rawQuery });
                const contacts = Array.isArray(res?.contacts) ? res.contacts : [];
                if (res?.found && contacts.length > 0) {
                    if (contacts.length === 1) {
                        const c = contacts[0];
                        const typeStr = c.type ? ` (${c.type})` : '';
                        return {
                            success: true,
                            found: true,
                            contacts,
                            message: `Found contact for **${c.name}**: 📞 **${c.phone}**${typeStr}`,
                        };
                    }
                    const list = contacts.slice(0, 5).map(c => `- **${c.name}**: 📞 ${c.phone}${c.type ? ` (${c.type})` : ''}`).join('\n');
                    return {
                        success: true,
                        found: true,
                        contacts,
                        message: `Found **${contacts.length}** contacts matching "${rawQuery}":\n\n${list}`,
                    };
                }
                return {
                    success: true,
                    found: false,
                    contacts: [],
                    message: `I couldn't find any contact matching "**${rawQuery}**" on your device.`,
                };
            } catch (err) {
                console.warn('[Nice] Native DeviceBridge.searchContacts failed:', err);
            }
        }
    }

    // 2. Web Contact Picker API fallback
    if (typeof navigator !== 'undefined' && navigator.contacts && typeof navigator.contacts.select === 'function') {
        try {
            const selected = await navigator.contacts.select(['name', 'tel'], { multiple: false });
            if (selected && selected.length > 0) {
                const c = selected[0];
                const name = Array.isArray(c.name) ? c.name[0] : (c.name || rawQuery);
                const phone = Array.isArray(c.tel) ? c.tel[0] : (c.tel || 'No number');
                return {
                    success: true,
                    found: true,
                    contacts: [{ name, phone, type: 'Mobile' }],
                    message: `Selected contact: **${name}** — 📞 **${phone}**`,
                };
            }
        } catch {
            // Cancelled or denied.
        }
    }

    // 3. Document Records Fallback
    try {
        const { searchForAnswer } = await import('./search-engine.js');
        const answer = await searchForAnswer(`contact phone number of ${rawQuery}`);
        if (answer && answer.found && answer.text) {
            return {
                success: true,
                found: true,
                contacts: [{ name: rawQuery, phone: answer.text, type: 'Document' }],
                message: `Found contact details in your local documents:\n\n${answer.text}`,
            };
        }
    } catch {
        // Fall through
    }

    return {
        success: true,
        found: false,
        contacts: [],
        message: `I couldn't find any contact matching "**${rawQuery}**". Contact lookup is supported natively on Android.`,
    };
}

// ===== SCREEN WAKE LOCK =====
let wakeLock = null;

export async function toggleWakeLock() {
    try {
        if (wakeLock) {
            await wakeLock.release();
            wakeLock = null;
            return 'Screen lock resumed. Your screen will turn off normally. 🔓';
        }

        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
            return 'Screen will stay **ON**! 🔒 Say "screen off" to allow sleep again.';
        }
        return 'Wake Lock is not supported on this browser.';
    } catch {
        return 'Unable to control screen wake lock.';
    }
}

// ===== WEB SHARE =====
export async function shareContent(text) {
    try {
        if (navigator.share) {
            await navigator.share({ text, title: 'Shared from Nice' });
            return { success: true, message: 'Shared successfully! 📲' };
        }
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(text);
        return { success: true, message: 'Share not supported — copied to clipboard instead. 📋' };
    } catch {
        return { success: false, message: 'Sharing was cancelled or not supported.' };
    }
}

// ===== FULLSCREEN =====
export function toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen();
        return 'Exited fullscreen mode.';
    }
    document.documentElement.requestFullscreen().catch(() => { });
    return 'Entering fullscreen mode! Press Esc to exit.';
}

// ===== DATE & TIME QUERIES =====
export function getCurrentDateTime() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const date = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return { time, date, full: `It's **${time}** on **${date}**.` };
}

export function getWorldTime(city) {
    const TIMEZONES = {
        'new york': 'America/New_York', 'los angeles': 'America/Los_Angeles', 'chicago': 'America/Chicago',
        'london': 'Europe/London', 'paris': 'Europe/Paris', 'berlin': 'Europe/Berlin',
        'tokyo': 'Asia/Tokyo', 'sydney': 'Australia/Sydney', 'dubai': 'Asia/Dubai',
        'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'india': 'Asia/Kolkata',
        'singapore': 'Asia/Singapore', 'hong kong': 'Asia/Hong_Kong',
        'beijing': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai', 'china': 'Asia/Shanghai',
        'moscow': 'Europe/Moscow', 'brazil': 'America/Sao_Paulo', 'sao paulo': 'America/Sao_Paulo',
        'toronto': 'America/Toronto', 'vancouver': 'America/Vancouver',
        'seoul': 'Asia/Seoul', 'bangkok': 'Asia/Bangkok', 'jakarta': 'Asia/Jakarta',
        'cairo': 'Africa/Cairo', 'nairobi': 'Africa/Nairobi', 'lagos': 'Africa/Lagos',
        'amsterdam': 'Europe/Amsterdam', 'rome': 'Europe/Rome', 'madrid': 'Europe/Madrid',
        'istanbul': 'Europe/Istanbul', 'riyadh': 'Asia/Riyadh',
    };

    const key = city.toLowerCase().trim();
    const tz = TIMEZONES[key];

    if (!tz) {
        return `I don't have a timezone for "${city}". Try major cities like London, Tokyo, New York, Mumbai, etc.`;
    }

    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const date = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' });

    return `The time in **${city}** is **${time}** (${date}).`;
}

// ===== CALENDAR EVENT CREATOR =====
export function createCalendarEvent(eventName, when, options = {}) {
    const rawTitle = String(eventName || 'New Event').trim();
    const eventDate = parseEventDate(when);
    const startMs = Number.isFinite(options?.startTime) ? options.startTime : eventDate.getTime();
    const endMs = Number.isFinite(options?.endTime) ? options.endTime : (startMs + (options?.durationMs || 3600000));
    const description = options?.description || 'Created by Nice Assistant';
    const location = options?.location || '';

    let syncMessage = `Scheduled **${rawTitle}** for ${new Date(startMs).toLocaleString()} in your calendar. 📅`;
    let icsContent = null;
    let asyncWork = null;

    if (isNativePlatform()) {
        const bridge = getDeviceBridgePlugin();
        if (bridge && typeof bridge.createCalendarEvent === 'function') {
            try {
                const p = bridge.createCalendarEvent({
                    title: rawTitle,
                    when: String(when || ''),
                    startTime: startMs,
                    endTime: endMs,
                    description,
                    location,
                });
                asyncWork = Promise.resolve(p).catch(err => {
                    console.warn('[Nice] Native DeviceBridge.createCalendarEvent failed:', err);
                });
            } catch (err) {
                console.warn('[Nice] Native DeviceBridge.createCalendarEvent failed:', err);
            }
        } else {
            try {
                const launcher = getAppLauncher();
                if (launcher?.openUrl) {
                    const insertUrl = `intent://calendar/events/#Intent;action=android.intent.action.INSERT;S.title=${encodeURIComponent(rawTitle)};S.description=${encodeURIComponent(description)};l.beginTime=${startMs};l.endTime=${endMs};end`;
                    asyncWork = launcher.openUrl({ url: insertUrl }).catch(() => {});
                }
            } catch {}
        }
        syncMessage = `Scheduled **${rawTitle}** on ${new Date(startMs).toLocaleString()} in your calendar. 📅`;
    } else {
        if (!canUseNetworkFallback()) {
            icsContent = buildIcsFile(rawTitle, new Date(startMs), new Date(endMs), description, location);
            if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof Blob !== 'undefined') {
                try {
                    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
                    const dlUrl = URL.createObjectURL(blob);
                    const safeName = rawTitle.replace(/[^a-zA-Z0-9_-]/g, '_') || 'event';
                    const a = document.createElement('a');
                    a.href = dlUrl;
                    a.download = `${safeName}.ics`;
                    a.style.display = 'none';
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => {
                        a.remove();
                        URL.revokeObjectURL(dlUrl);
                    }, 1000);
                } catch (err) {
                    console.warn('[Nice] ICS blob creation failed:', err);
                }
            }
            syncMessage = `Created calendar event for **${rawTitle}**. Downloaded **.ics** file locally for offline calendar import. 📅`;
        } else {
            const startDate = formatDateForCal(new Date(startMs));
            const endDate = formatDateForCal(new Date(endMs));
            const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(rawTitle)}&dates=${startDate}/${endDate}&details=${encodeURIComponent(description)}`;
            safeOpenWindow(url, { requireNetwork: true });
            syncMessage = `Opening Google Calendar with your event: **${rawTitle}** 📅`;
        }
    }

    const resultObj = {
        success: true,
        message: syncMessage,
        ...(icsContent ? { ics: icsContent } : {}),
    };

    const promise = Promise.resolve(asyncWork).then(() => resultObj);
    promise.success = resultObj.success;
    promise.message = resultObj.message;
    if (icsContent) promise.ics = icsContent;
    return promise;
}

export function buildIcsFile(title, start, end, description = 'Created by Nice Assistant', location = '') {
    const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Nice Assistant//EN',
        'BEGIN:VEVENT',
        `UID:${Date.now()}@nice`,
        `DTSTAMP:${fmt(new Date())}`,
        `DTSTART:${fmt(start)}`,
        `DTEND:${fmt(end)}`,
        `SUMMARY:${title}`,
        `DESCRIPTION:${description}`,
    ];
    if (location) {
        lines.push(`LOCATION:${location}`);
    }
    lines.push('END:VEVENT');
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
}

export function parseEventDate(when) {
    const text = String(when || '').toLowerCase().trim();
    const now = new Date();

    if (!text || text === 'today' || text === 'now') {
        const d = new Date(now);
        d.setHours(d.getHours() + 1, 0, 0, 0);
        return d;
    }

    // Relative "in X hours/minutes"
    const relMatch = text.match(/in\s+(\d+)\s*(hour|hr|minute|min)s?/i);
    if (relMatch) {
        const amount = parseInt(relMatch[1], 10);
        const unit = relMatch[2].toLowerCase();
        const d = new Date(now);
        if (unit.startsWith('hour') || unit.startsWith('hr')) {
            d.setTime(d.getTime() + amount * 3600000);
        } else {
            d.setTime(d.getTime() + amount * 60000);
        }
        return d;
    }

    // "tomorrow"
    const isTomorrow = text.includes('tomorrow');
    let dayOffset = isTomorrow ? 1 : 0;

    // Weekdays ("friday", "next monday", etc.)
    const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const foundDayIndex = DAYS.findIndex(day => text.includes(day));
    if (foundDayIndex !== -1 && !isTomorrow) {
        const currentDay = now.getDay();
        let diff = foundDayIndex - currentDay;
        if (diff <= 0 || text.includes('next')) diff += 7;
        dayOffset = diff;
    }

    // Parse time portion
    let hours = 9;
    let minutes = 0;
    let timeFound = false;

    const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
        let h = parseInt(timeMatch[1], 10);
        const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        const meridian = timeMatch[3]?.toLowerCase();

        if (meridian === 'pm' && h < 12) h += 12;
        if (meridian === 'am' && h === 12) h = 0;
        if (!meridian && h >= 1 && h <= 7) h += 12;

        hours = h;
        minutes = m;
        timeFound = true;
    } else if (text.includes('morning')) {
        hours = 9; minutes = 0; timeFound = true;
    } else if (text.includes('afternoon') || text.includes('noon')) {
        hours = 14; minutes = 0; timeFound = true;
    } else if (text.includes('evening')) {
        hours = 18; minutes = 0; timeFound = true;
    } else if (text.includes('night')) {
        hours = 20; minutes = 0; timeFound = true;
    }

    // Direct ISO / formatted date check
    const parsedDate = new Date(text);
    if (!isNaN(parsedDate.getTime()) && (text.includes('-') || text.includes('/') || /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text))) {
        if (!timeFound) parsedDate.setHours(9, 0, 0, 0);
        return parsedDate;
    }

    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hours, minutes, 0, 0);

    if (dayOffset === 0 && d <= now) {
        d.setDate(d.getDate() + 1);
    }

    return d;
}

function formatDateForCal(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

// ===== TOAST NOTIFICATION SYSTEM =====
export function showToast(message, type = 'info', duration = 4000) {
    if (typeof document === 'undefined' || !document.getElementById || !document.createElement) return;
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        if (document.body && document.body.appendChild) {
            document.body.appendChild(container);
        }
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    if (container && container.appendChild) {
        container.appendChild(toast);
    }
    const makeVisible = () => {
        if (toast && toast.classList && toast.classList.add) {
            toast.classList.add('visible');
        }
    };
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(makeVisible);
    } else {
        makeVisible();
    }
    setTimeout(() => {
        if (toast && toast.classList && toast.classList.remove) {
            toast.classList.remove('visible');
        }
        setTimeout(() => {
            if (toast && typeof toast.remove === 'function') toast.remove();
        }, 300);
    }, duration);
}











