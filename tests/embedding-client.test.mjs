import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(path.resolve('src/embedding-client.js')).href;

async function loadClient({ overrides = {}, onPostMessage }) {
    const workers = [];
    let workerCount = 0;

    globalThis.__NICE_EMBEDDING_TEST_OVERRIDES__ = overrides;
    globalThis.Worker = class MockWorker {
        constructor() {
            workerCount += 1;
            this.id = workerCount;
            this.onmessage = null;
            this.onerror = null;
            this.terminated = false;
            workers.push(this);
        }
        postMessage(message) {
            onPostMessage?.(this, message);
        }
        terminate() {
            this.terminated = true;
        }
    };

    const mod = await import(`${moduleUrl}?case=${Date.now()}_${Math.random()}`);
    return {
        mod,
        workers,
        getWorkerCount: () => workerCount,
    };
}

async function testInitSuccess() {
    const client = await loadClient({
        overrides: { initTimeoutMs: 100, requestTimeoutMs: 100 },
        onPostMessage(worker, message) {
            if (message.type === 'init') {
                setTimeout(() => worker.onmessage?.({ data: { type: 'ready' } }), 0);
            }
        },
    });

    await client.mod.initEmbeddingWorker();
    assert.equal(client.mod.getEmbeddingWorkerStatus().ready, true, 'worker should become ready');
}

async function testInitRetrySuccess() {
    const client = await loadClient({
        overrides: { initTimeoutMs: 70, requestTimeoutMs: 100, maxInitRetries: 1 },
        onPostMessage(worker, message) {
            if (message.type !== 'init') return;
            if (worker.id === 2) {
                setTimeout(() => worker.onmessage?.({ data: { type: 'ready' } }), 0);
            }
        },
    });

    await client.mod.initEmbeddingWorker();
    assert.equal(client.getWorkerCount(), 2, 'client should retry once after init timeout');
    assert.equal(client.mod.getEmbeddingWorkerStatus().ready, true, 'worker should be ready after retry');
}

async function testEmbedErrorPath() {
    const client = await loadClient({
        overrides: { initTimeoutMs: 100, requestTimeoutMs: 100 },
        onPostMessage(worker, message) {
            if (message.type === 'init') {
                setTimeout(() => worker.onmessage?.({ data: { type: 'ready' } }), 0);
                return;
            }
            if (message.type === 'embed') {
                setTimeout(() => worker.onmessage?.({
                    data: { type: 'result', id: message.id, error: 'mock embed failure' },
                }), 0);
            }
        },
    });

    await client.mod.initEmbeddingWorker();
    await assert.rejects(
        () => client.mod.embedTextWithWorker('hello'),
        /mock embed failure/,
        'embedding errors should surface to caller',
    );
}

async function testEmbedTimeoutPath() {
    const client = await loadClient({
        overrides: { initTimeoutMs: 100, requestTimeoutMs: 30 },
        onPostMessage(worker, message) {
            if (message.type === 'init') {
                setTimeout(() => worker.onmessage?.({ data: { type: 'ready' } }), 0);
            }
            // Intentionally ignore embed requests.
        },
    });

    await client.mod.initEmbeddingWorker();
    await assert.rejects(
        () => client.mod.embedTextWithWorker('timeout case'),
        /timed out/i,
        'embedding request should timeout when worker does not respond',
    );
}

async function main() {
    await testInitSuccess();
    await testInitRetrySuccess();
    await testEmbedErrorPath();
    await testEmbedTimeoutPath();
    console.log('embedding-client.test: ok');
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => {
        delete globalThis.__NICE_EMBEDDING_TEST_OVERRIDES__;
        delete globalThis.Worker;
    });
