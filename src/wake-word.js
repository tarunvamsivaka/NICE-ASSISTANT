/**
 * Nice — Wake Word Detector ("Hey Nice")
 * Lightweight energy-based keyword detection using Web Audio API
 * Runs continuously in the background with minimal battery usage
 */

let audioContext = null;
let analyser = null;
let mediaStream = null;
let listening = false;
let onWakeCallback = null;
let activeMode = 'none'; // speech | energy | none

// Detection parameters
const ENERGY_THRESHOLD = 0.02;   // Min energy to start analyzing
const COOLDOWN_MS = 3000;        // Min time between detections
const MIN_BURST_MS = 90;
const MAX_BURST_MS = 1200;
const BURST_SEQUENCE_WINDOW_MS = 2200;
let lastDetection = 0;
let lastFrameAboveThreshold = false;
let activeBurstStart = 0;
let burstSequenceStart = 0;
let burstCount = 0;

// Web Speech Recognition for wake word (very lightweight)
let recognition = null;
let isPaused = false; // Add pause state for hardware sharing
let restartTimer = null;
let restartAttempts = 0;
const MAX_SPEECH_RESTART_ATTEMPTS = 6;

async function startEnergyFallback() {
    try {
        if (audioContext && audioContext.state !== 'closed') {
            await audioContext.close().catch(() => { });
        }

        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(mediaStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        listening = true;
        activeMode = 'energy';
        resetEnergyFallbackState();
        monitorEnergy();
        console.log('[Nice] Wake word listener started (energy-based fallback)');
        return true;
    } catch (e) {
        console.warn('[Nice] Could not start energy wake-word fallback:', e);
        return false;
    }
}

function clearSpeechRestartTimer() {
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
}

function resetEnergyFallbackState() {
    lastFrameAboveThreshold = false;
    activeBurstStart = 0;
    burstSequenceStart = 0;
    burstCount = 0;
}

/**
 * Start listening for "Hey Nice" wake word
 * Uses Web Speech API in continuous mode with a keyword filter
 */
export async function startWakeWordListener(onWake) {
    if (listening) {
        if (isPaused) resumeWakeWord();
        return true;
    }
    onWakeCallback = onWake;
    isPaused = false;
    restartAttempts = 0;
    clearSpeechRestartTimer();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
        // Use Web Speech API for accurate wake word detection
        recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;

        const attemptRestart = async () => {
            if (listening && !isPaused) {
                clearSpeechRestartTimer();
                restartTimer = setTimeout(() => {
                    try {
                        recognition.start();
                        restartAttempts = 0;
                    } catch {
                        restartAttempts += 1;
                        if (restartAttempts > MAX_SPEECH_RESTART_ATTEMPTS) {
                            stopWakeWordListener();
                            startEnergyFallback().catch(() => { });
                            return;
                        }
                        attemptRestart();
                    } // Loop if it refuses to start immediately
                }, 300);
            }
        };

        recognition.onresult = (event) => {
            if (isPaused) return; // Ignore input while paused
            const now = Date.now();
            if (now - lastDetection < COOLDOWN_MS) return;

            for (let i = event.resultIndex; i < event.results.length; i++) {
                for (let j = 0; j < event.results[i].length; j++) {
                    const transcript = event.results[i][j].transcript.toLowerCase().trim();

                    // Expanded fuzziness for typical ASR mistakes
                    if (transcript.includes('hey nice') || transcript.includes('hay nice') ||
                        transcript.includes('hey nise') || transcript.includes('a nice') ||
                        transcript.includes('hi nice') || transcript.includes('high nice') ||
                        transcript.includes('hey niece') || transcript.includes('hay niece') ||
                        transcript === 'nice') {

                        lastDetection = now;
                        console.log('[Nice] Wake word detected:', transcript);
                        if (onWakeCallback) onWakeCallback();
                        return;
                    }
                }
            }
        };

        recognition.onerror = (e) => {
            if (!listening || isPaused) return;
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                stopWakeWordListener();
                return;
            }
            if (e.error === 'no-speech' || e.error === 'aborted' || e.error === 'network') {
                // Wait and aggressively restart, then fallback if repeatedly failing.
                attemptRestart().catch(() => { });
            }
        };

        recognition.onend = () => {
            // Restart continuous if still officially "listening" and not paused
            attemptRestart().catch(() => { });
        };

        try {
            recognition.start();
            listening = true;
            activeMode = 'speech';
            console.log('[Nice] Wake word listener started (Web Speech API)');
            return true;
        } catch (e) {
            console.warn('[Nice] Wake word start failed:', e);
            restartAttempts += 1;
            if (restartAttempts <= MAX_SPEECH_RESTART_ATTEMPTS) {
                attemptRestart().catch(() => { });
            }
        }
    }

    // Fallback: energy-based detection using AudioContext
    return await startEnergyFallback();
}

/**
 * Monitor audio energy for voice activity detection
 */
function monitorEnergy() {
    if (!listening || !analyser) return;

    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);

    let energy = 0;
    for (let i = 0; i < buffer.length; i++) {
        energy += buffer[i] * buffer[i];
    }
    energy = Math.sqrt(energy / buffer.length);

    const now = Date.now();
    const above = energy > ENERGY_THRESHOLD;

    if (above) {
        if (!lastFrameAboveThreshold) {
            activeBurstStart = now;
        }
        lastFrameAboveThreshold = true;
    } else if (lastFrameAboveThreshold) {
        const burstMs = Math.max(0, now - activeBurstStart);
        lastFrameAboveThreshold = false;

        if (burstMs >= MIN_BURST_MS && burstMs <= MAX_BURST_MS) {
            if (!burstSequenceStart || (now - burstSequenceStart) > BURST_SEQUENCE_WINDOW_MS) {
                burstSequenceStart = now;
                burstCount = 1;
            } else {
                burstCount += 1;
            }
        } else if (burstMs > MAX_BURST_MS) {
            burstSequenceStart = 0;
            burstCount = 0;
        }
    }

    if (burstSequenceStart && (now - burstSequenceStart) > BURST_SEQUENCE_WINDOW_MS) {
        burstSequenceStart = 0;
        burstCount = 0;
    }

    // Require two short voice bursts in a short window to reduce false wake triggers.
    if (burstCount >= 2 && (now - lastDetection) > COOLDOWN_MS) {
        lastDetection = now;
        burstSequenceStart = 0;
        burstCount = 0;
        if (onWakeCallback) onWakeCallback();
    }

    requestAnimationFrame(monitorEnergy);
}

/**
 * Stop wake word listening
 */
export function stopWakeWordListener() {
    listening = false;
    isPaused = false;
    activeMode = 'none';
    restartAttempts = 0;
    clearSpeechRestartTimer();
    resetEnergyFallbackState();

    if (recognition) {
        try { recognition.stop(); } catch { /* ignore */ }
        recognition = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }

    if (audioContext) {
        audioContext.close().catch(() => { });
        audioContext = null;
    }

    analyser = null;
    console.log('[Nice] Wake word listener stopped');
}

/**
 * Check if wake word listener is active
 */
export function isWakeWordActive() {
    return listening;
}

/**
 * Temporarily pause the wake word listener (e.g. when main app needs the mic)
 */
export function pauseWakeWord() {
    if (!listening || isPaused) return;
    isPaused = true;
    clearSpeechRestartTimer();
    resetEnergyFallbackState();
    if (recognition) {
        try { recognition.stop(); } catch { /* ignore */ }
    }
    console.log('[Nice] Wake word listener paused for main mic access');
}

/**
 * Resume the wake word listener
 */
export function resumeWakeWord() {
    if (!listening || !isPaused) return;
    isPaused = false;
    if (activeMode === 'speech' && recognition) {
        setTimeout(() => {
            try { recognition.start(); } catch { /* ignore */ }
        }, 300);
        return;
    }
    if (activeMode === 'energy' && audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => { });
    }
    console.log('[Nice] Wake word listener resumed');
}
