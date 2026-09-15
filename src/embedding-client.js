/**
 * Nice - Embedding Worker Client
 * Dedicated client for MiniLM embedding requests via embedding-worker.js.
 */

let worker = null;
let isReady = false;
let initPromise = null;
let requestSeq = 0;
let initRetries = 0;
const testOverrides = globalThis.__NICE_EMBEDDING_TEST_OVERRIDES__ || {};

const pending = new Map();
const INIT_TIMEOUT_MS = Number(testOverrides.initTimeoutMs) || 15000;
const REQUEST_TIMEOUT_MS = Number(testOverrides.requestTimeoutMs) || 20000;
const MAX_INIT_RETRIES = Number.isInteger(testOverrides.maxInitRetries)
    ? testOverrides.maxInitRetries
    : 1;

function cleanupPending(error) {
    for (const [, request] of pending.entries()) {
        clearTimeout(request.timeoutId);
        request.reject(error);
    }
    pending.clear();
}

function resetWorkerState(error) {
    if (worker) {
        worker.terminate();
        worker = null;
    }
    isReady = false;
    initPromise = null;
    if (error) {
        cleanupPending(error);
    }
}

function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./embedding-worker.js', import.meta.url), { type: 'module' });

    worker.onmessage = (event) => {
        const { type, id, vector, error } = event.data || {};

        if (type === 'ready') {
            isReady = true;
            return;
        }

        if (type === 'error') {
            console.warn('[Nice] Embedding worker error:', error || 'Unknown error');
            return;
        }

        if (type !== 'result' || typeof id !== 'number') return;
        const request = pending.get(id);
        if (!request) return;
        pending.delete(id);
        clearTimeout(request.timeoutId);

        if (error) {
            request.reject(new Error(error));
            return;
        }
        request.resolve(vector);
    };

    worker.onerror = (err) => {
        resetWorkerState(new Error(err?.message || 'Embedding worker crashed'));
    };

    return worker;
}

async function initWorkerOnce() {
    const instance = ensureWorker();
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error('Embedding worker init timed out'));
        }, INIT_TIMEOUT_MS);

        const onReadyPoll = () => {
            if (isReady) {
                clearTimeout(timeoutId);
                resolve(true);
                return;
            }
            setTimeout(onReadyPoll, 50);
        };

        try {
            instance.postMessage({ type: 'init' });
            onReadyPoll();
        } catch (error) {
            clearTimeout(timeoutId);
            reject(error);
        }
    });
}

export async function initEmbeddingWorker() {
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
                resetWorkerState();
                initPromise = null;
                return initEmbeddingWorker();
            }
            resetWorkerState(error);
            throw error;
        })
        .finally(() => {
            if (!isReady) initPromise = null;
        });

    return initPromise;
}

export async function embedTextWithWorker(text) {
    await initEmbeddingWorker();
    const instance = ensureWorker();
    const id = ++requestSeq;

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            pending.delete(id);
            reject(new Error('Embedding request timed out'));
        }, REQUEST_TIMEOUT_MS);

        pending.set(id, { resolve, reject, timeoutId });

        try {
            instance.postMessage({ type: 'embed', id, text });
        } catch (error) {
            pending.delete(id);
            clearTimeout(timeoutId);
            reject(error);
        }
    });
}

export function getEmbeddingWorkerStatus() {
    return {
        ready: isReady,
        inFlight: pending.size,
        retries: initRetries,
    };
}

export function resetEmbeddingWorker() {
    resetWorkerState();
    initRetries = 0;
}
