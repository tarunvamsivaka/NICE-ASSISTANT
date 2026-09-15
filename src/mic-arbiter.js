/**
 * Nice - Microphone Arbiter
 * Prevents wake-word and active STT sessions from contending for mic access.
 */

export const MIC_STATES = Object.freeze({
    IDLE: 'idle',
    WAKE_WORD: 'wake_word',
    LISTENING: 'listening',
    PROCESSING: 'processing',
});

let currentState = MIC_STATES.IDLE;
let lastReason = '';

function emitState() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('nice:mic-state', {
        detail: {
            state: currentState,
            reason: lastReason,
            ts: Date.now(),
        },
    }));
}

export function getMicState() {
    return currentState;
}

export function canStartActiveListening() {
    return currentState === MIC_STATES.IDLE || currentState === MIC_STATES.WAKE_WORD;
}

export function setMicState(nextState, reason = '') {
    if (!Object.values(MIC_STATES).includes(nextState)) {
        return currentState;
    }
    currentState = nextState;
    lastReason = reason;
    emitState();
    return currentState;
}

export function resetMicState() {
    currentState = MIC_STATES.IDLE;
    lastReason = '';
    emitState();
}

