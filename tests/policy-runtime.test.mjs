import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

class MemoryStorage {
    constructor(seed = {}) {
        this.map = new Map(Object.entries(seed));
    }
    getItem(key) {
        return this.map.has(key) ? this.map.get(key) : null;
    }
    setItem(key, value) {
        this.map.set(key, String(value));
    }
    removeItem(key) {
        this.map.delete(key);
    }
    clear() {
        this.map.clear();
    }
}

class MockCustomEvent {
    constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
    }
}

const policyModulePath = pathToFileURL(path.resolve('src/policy.js')).href;
const assistantPath = path.resolve('src/assistant.js');

async function loadPolicyModule() {
    return import(`${policyModulePath}?t=${Date.now()}_${Math.random()}`);
}

async function runPolicyTests() {
    const events = [];
    globalThis.localStorage = new MemoryStorage();
    globalThis.CustomEvent = MockCustomEvent;
    globalThis.window = {
        addEventListener() { },
        removeEventListener() { },
        dispatchEvent(event) {
            events.push(event);
        },
    };

    const policy = await loadPolicyModule();

    const state = policy.getPolicyState();
    assert.equal(state.offlineDefault, true, 'offlineDefault must remain true');
    assert.equal(state.offlineHardLock, false, 'offline hard lock should be disabled in fully-loaded builds');
    assert.equal(state.onlineSessionOptIn, false, 'session should start offline');
    assert.equal(policy.isOfflineHardLocked(), false, 'policy should report offline-default (not hard-locked)');
    assert.equal(policy.isOnlineAllowed('any'), false, 'network should be blocked before opt-in');
    assert.equal(policy.isOnlineAllowed('webSearch'), false, 'web search should be blocked before opt-in');
    assert.equal(policy.isOnlineAllowed('weather'), false, 'weather should be blocked before opt-in');

    const optInResult = policy.optInToOnline();
    assert.equal(optInResult, true, 'opt-in should enable online session when hard lock is disabled');
    assert.equal(policy.isOnlineAllowed('any'), true, 'online should be enabled after opt-in');
    assert.equal(policy.isOnlineAllowed('webSearch'), true, 'web search should be enabled after opt-in');
    assert.equal(policy.isOnlineAllowed('weather'), true, 'weather should be enabled after opt-in');

    policy.setFeatureAllowed('weather', false);
    assert.equal(policy.isOnlineAllowed('weather'), false, 'feature toggle should gate weather');

    policy.optOutOfOnline();
    assert.equal(policy.isOnlineAllowed('any'), false, 'opt-out should disable online again');
    assert.equal(policy.isOnlineAllowed('webSearch'), false, 'web search should disable after opt-out');

    assert(events.some((e) => e.type === 'nice:policy-updated'), 'policy update event should be emitted');

    const blocked = policy.offlineBlockedMessage('webSearch');
    assert(blocked.toLowerCase().includes('requires an internet connection') || blocked.toLowerCase().includes('offline mode'), 'blocked message should explain why network feature is unavailable');
}

function runNoSimulationGuardTests() {
    const source = fs.readFileSync(assistantPath, 'utf8');

    assert(!source.includes('simulateFileSearch('), 'assistant should not call simulated file search');
    assert(!source.includes('Good news! With the new local backend'), 'assistant should not claim fake backend behavior');
    assert(
        /case INTENTS\.SCAN_FILES:[\s\S]*grantFolderAccess\(/.test(source),
        'scan intent should perform real grantFolderAccess call',
    );
    assert(
        /I do not have a file index yet[\s\S]*scan my files/.test(source),
        'file search fallback should truthfully ask for scanning',
    );
    assert(
        /case INTENTS\.FILE_SEARCH:[\s\S]*searchForAnswer\(/.test(source),
        'file search should use content retrieval instead of filename-only lookup',
    );
    assert(
        /case INTENTS\.SCAN_FILES:[\s\S]*warmupSearchKnowledge\(/.test(source),
        'scan flow should warm local learning profiles after indexing',
    );
}

async function main() {
    await runPolicyTests();
    runNoSimulationGuardTests();
    console.log('policy-runtime.test: ok');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
