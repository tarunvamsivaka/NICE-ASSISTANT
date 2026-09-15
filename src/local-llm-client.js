/**
 * Nice - Local LLM Worker Client
 * Manages local-llm-worker lifecycle and guarded generation calls.
 */

let worker = null;
let initPromise = null;
let isReady = false;
let requestId = 0;
let initRetries = 0;

const pending = new Map();
const INIT_TIMEOUT_MS = 30000;
const REQUEST_TIMEOUT_MS = 60000;
const MAX_INIT_RETRIES = 1;

function cleanupPending(error) {
    for (const [, req] of pending.entries()) {
        clearTimeout(req.timeoutId);
        req.reject(error);
    }
    pending.clear();
}

function resetWorker(error = null) {
    if (worker) {
        worker.terminate();
        worker = null;
    }
    isReady = false;
    initPromise = null;
    if (error) cleanupPending(error);
}

function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./local-llm-worker.js', import.meta.url), { type: 'module' });

    worker.onmessage = (event) => {
        const msg = event?.data || {};
        if (msg.type === 'ready') {
            isReady = true;
            return;
        }
        if (msg.type === 'error') {
            console.warn('[Nice] Local LLM worker:', msg.error || 'unknown error');
            return;
        }
        if (msg.type !== 'result' || typeof msg.id !== 'number') return;
        const req = pending.get(msg.id);
        if (!req) return;
        pending.delete(msg.id);
        clearTimeout(req.timeoutId);
        if (msg.error) {
            req.reject(new Error(msg.error));
            return;
        }
        req.resolve(String(msg.text || '').trim());
    };

    worker.onerror = (error) => {
        resetWorker(new Error(error?.message || 'Local LLM worker crashed'));
    };

    return worker;
}

async function initWorkerOnce() {
    const instance = ensureWorker();
    return await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('Local LLM init timed out')), INIT_TIMEOUT_MS);
        const pollReady = () => {
            if (isReady) {
                clearTimeout(timeoutId);
                resolve(true);
                return;
            }
            setTimeout(pollReady, 60);
        };
        try {
            instance.postMessage({ type: 'init' });
            pollReady();
        } catch (error) {
            clearTimeout(timeoutId);
            reject(error);
        }
    });
}

export async function initLocalLlmWorker() {
    if (isReady) return true;
    if (initPromise) return initPromise;

    initPromise = initWorkerOnce()
        .then(() => {
            initRetries = 0;
            return true;
        })
        .catch(async (error) => {
            if (initRetries < MAX_INIT_RETRIES) {
                initRetries += 1;
                resetWorker();
                initPromise = null;
                return initLocalLlmWorker();
            }
            resetWorker(error);
            throw error;
        })
        .finally(() => {
            if (!isReady) initPromise = null;
        });

    return initPromise;
}

export async function generateLocalLlmAnswer({ question, context, maxNewTokens = 160 }) {
    await initLocalLlmWorker();
    const instance = ensureWorker();
    const id = ++requestId;

    return await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            pending.delete(id);
            reject(new Error('Local LLM request timed out'));
        }, REQUEST_TIMEOUT_MS);

        pending.set(id, { resolve, reject, timeoutId });

        try {
            instance.postMessage({
                type: 'generate',
                id,
                question: String(question || ''),
                context: String(context || ''),
                maxNewTokens: Number(maxNewTokens) || 160,
            });
        } catch (error) {
            pending.delete(id);
            clearTimeout(timeoutId);
            reject(error);
        }
    });
}

export function getLocalLlmStatus() {
    return {
        ready: isReady,
        retries: initRetries,
        inFlight: pending.size,
    };
}

export function resetLocalLlmWorker() {
    initRetries = 0;
    resetWorker();
}

