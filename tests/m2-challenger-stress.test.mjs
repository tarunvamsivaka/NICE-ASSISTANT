/**
 * Nice Assistant v1.2.0 — Empirical Challenger Stress Test Suite
 * Milestone 2: Deep Android & System Automations
 *
 * Adversarial edge cases, stress testing, fuzzing, and unhandled rejection guards:
 * - parseCommand: strange whitespace, casing, missing parameters, punctuation, overlapping intents
 * - actions.js: invalid timestamps, missing options, rejected permissions, missing navigator/document
 * - generateResponse: asyncAction pipeline stress and crash prevention
 * - concurrency and fuzzing stress harness
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

class MemoryStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
    clear() { this.map.clear(); }
}

class MockCustomEvent {
    constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
    }
}

// Global unhandled rejection detector
let unhandledRejections = [];
process.on('unhandledRejection', (reason) => {
    unhandledRejections.push(reason);
    console.error('💥 UNHANDLED PROMISE REJECTION DETECTED:', reason);
});

// Setup baseline browser-like global environment for module loading
globalThis.localStorage = new MemoryStorage();
globalThis.CustomEvent = MockCustomEvent;
globalThis.window = {
    Capacitor: { isNativePlatform: () => false },
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {},
};
globalThis.document = {
    getElementById() { return null; },
    addEventListener() {},
    removeEventListener() {},
    createElement() {
        return {
            style: {},
            classList: { add() {}, remove() {}, toggle() {} },
            appendChild() {},
            remove() {},
            addEventListener() {},
            click() {},
        };
    },
    body: { appendChild() {}, removeChild() {} },
};

const assistantModUrl = pathToFileURL(path.resolve('src/assistant.js')).href;
const actionsModUrl = pathToFileURL(path.resolve('src/actions.js')).href;

const assistantMod = await import(`${assistantModUrl}?t=${Date.now()}_${Math.random()}`);
const actionsMod = await import(`${actionsModUrl}?t=${Date.now()}_${Math.random()}`);

const { parseCommand, generateResponse, INTENTS } = assistantMod;
const {
    createCalendarEvent,
    lookupContact,
    getBatteryStatus,
    copyToClipboard,
    readFromClipboard,
    buildIcsFile,
    parseEventDate,
} = actionsMod;

let totalTests = 0;
let passedTests = 0;
let failedTests = [];

function check(label, condition, detail = '') {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ ${label}`);
    } else {
        const msg = `FAIL: ${label} ${detail ? `(${detail})` : ''}`;
        failedTests.push(msg);
        console.error(`  ❌ ${msg}`);
    }
}

async function runAllStressTests() {
    console.log('====================================================');
    console.log('⚡ Challenger 1 M2: Adversarial & Empirical Stress Suite');
    console.log('====================================================\n');

    // =========================================================================
    // SECTION 1: parseCommand Whitespace, Casing & Punctuation Stress
    // =========================================================================
    console.log('🧪 Section 1: parseCommand Whitespace, Casing & Punctuation Resilience');

    // Whitespace permutations
    const wsCases = [
        { input: '   find   contact   Alice   ', intent: INTENTS.CONTACT_LOOKUP, name: 'Alice' },
        { input: '\t\tlookup\tcontact\tBob\t', intent: INTENTS.CONTACT_LOOKUP, name: 'Bob' },
        { input: '  \n  battery   status  \n  ', intent: INTENTS.BATTERY },
        { input: '   read    clipboard   ', intent: INTENTS.CLIPBOARD_READ },
        { input: '  copy   secret token 123  ', intent: INTENTS.CLIPBOARD, text: 'secret token 123' },
        { input: '  schedule   meeting   Alice   tomorrow   at   3pm  ', intent: INTENTS.CALENDAR },
    ];
    for (const tc of wsCases) {
        const res = parseCommand(tc.input);
        check(`Whitespace: "${tc.input.replace(/\s+/g, ' ')}" parses to ${tc.intent}`, res.intent === tc.intent);
    }

    // Casing permutations
    const casingCases = [
        { input: 'FIND CONTACT ALICE', intent: INTENTS.CONTACT_LOOKUP, name: 'ALICE' },
        { input: 'LOOKUP CONTACT BOB', intent: INTENTS.CONTACT_LOOKUP, name: 'BOB' },
        { input: 'BATTERY STATUS', intent: INTENTS.BATTERY },
        { input: 'READ CLIPBOARD', intent: INTENTS.CLIPBOARD_READ },
        { input: 'WHAT IS ON MY CLIPBOARD', intent: INTENTS.CLIPBOARD_READ },
        { input: 'WHAT\'S ON MY CLIPBOARD', intent: INTENTS.CLIPBOARD_READ },
        { input: 'SCHEDULE MEETING SYNC ON FRIDAY', intent: INTENTS.CALENDAR },
        { input: 'FiNd CoNtAcT cHaRlIe', intent: INTENTS.CONTACT_LOOKUP, name: 'cHaRlIe' },
        { input: 'BaTtErY lEvEl', intent: INTENTS.BATTERY },
        { input: 'ReAd ClIpBoArD', intent: INTENTS.CLIPBOARD_READ },
    ];
    for (const tc of casingCases) {
        const res = parseCommand(tc.input);
        check(`Casing: "${tc.input}" parses to ${tc.intent}`, res.intent === tc.intent);
    }

    // Punctuation permutations
    const punctCases = [
        { input: 'find contact Alice???', intent: INTENTS.CONTACT_LOOKUP },
        { input: 'lookup contact Bob!', intent: INTENTS.CONTACT_LOOKUP },
        { input: 'who is Charlie?!?', intent: INTENTS.CONTACT_LOOKUP },
        { input: 'phone number of David???', intent: INTENTS.CONTACT_LOOKUP },
        { input: 'battery status?!?', intent: INTENTS.BATTERY },
        { input: 'what is my battery level???', intent: INTENTS.BATTERY },
        { input: 'read clipboard!', intent: INTENTS.CLIPBOARD_READ },
        { input: 'what\'s on my clipboard???', intent: INTENTS.CLIPBOARD_READ },
    ];
    for (const tc of punctCases) {
        const res = parseCommand(tc.input);
        check(`Punctuation: "${tc.input}" parses to ${tc.intent}`, res.intent === tc.intent);
    }

    // =========================================================================
    // SECTION 2: Missing Parameters & Malformed Inputs in parseCommand
    // =========================================================================
    console.log('\n🧪 Section 2: Missing Parameters & Degraded Inputs in parseCommand');

    // Missing parameters must not throw
    const degradedInputs = [
        '',
        '   ',
        null,
        undefined,
        'find contact',
        'lookup contact',
        'who is',
        'phone number of',
        'copy',
        'schedule',
        'create event',
        'add to calendar',
        'paste',
    ];

    for (const input of degradedInputs) {
        let threw = false;
        let res = null;
        try {
            res = parseCommand(input);
        } catch (e) {
            threw = true;
            console.error('Crash on input:', input, e);
        }
        check(`Degraded input "${input}" handled without crash`, !threw && res && typeof res.intent === 'string');
    }

    // "paste" alone routes to CLIPBOARD_READ
    const pasteRes = parseCommand('paste');
    check('"paste" routes to CLIPBOARD_READ', pasteRes.intent === INTENTS.CLIPBOARD_READ);

    // =========================================================================
    // SECTION 3: Overlapping Intents & Ambiguity Disambiguation
    // =========================================================================
    console.log('\n🧪 Section 3: Intent Overlap & Disambiguation Scenarios');

    // 1. "find contact file" vs "find contact file.csv"
    const overlap1 = parseCommand('find contact file');
    const overlap1b = parseCommand('find contact file.csv');
    console.log(`    Note: "find contact file" -> ${overlap1.intent}, name: ${overlap1.name || overlap1.file}`);
    console.log(`    Note: "find contact file.csv" -> ${overlap1b.intent}, name: ${overlap1b.name || overlap1b.file}`);
    check('"find contact file" produces valid intent without crash', !!overlap1.intent);
    check('"find contact file.csv" produces valid intent without crash', !!overlap1b.intent);

    // 2. "copy battery status"
    const overlap2 = parseCommand('copy battery status');
    console.log(`    Note: "copy battery status" -> ${overlap2.intent}`);
    check('"copy battery status" routes safely without crash', overlap2.intent === INTENTS.BATTERY || overlap2.intent === INTENTS.CLIPBOARD);

    // 3. "read clipboard notes"
    const overlap3 = parseCommand('read clipboard notes');
    console.log(`    Note: "read clipboard notes" -> ${overlap3.intent}`);
    check('"read clipboard notes" produces valid intent without crash', !!overlap3.intent);

    // 4. "open contacts" -> App launch vs Contact lookup
    const overlap4 = parseCommand('open contacts');
    console.log(`    Note: "open contacts" -> ${overlap4.intent}`);
    check('"open contacts" routes without crash', overlap4.intent === INTENTS.OPEN_TARGET || overlap4.intent === INTENTS.LAUNCH_APP);

    // 5. Reserved words "contact us", "contact support", "contact contacts"
    const overlap5a = parseCommand('contact us');
    const overlap5b = parseCommand('contact support');
    const overlap5c = parseCommand('contact contacts');
    check('"contact us" does not treat "us" as a personal contact lookup', overlap5a.intent !== INTENTS.CONTACT_LOOKUP);
    check('"contact support" does not treat "support" as a personal contact lookup', overlap5b.intent !== INTENTS.CONTACT_LOOKUP);
    check('"contact contacts" does not treat "contacts" as a personal contact lookup', overlap5c.intent !== INTENTS.CONTACT_LOOKUP);

    // 6. "who is 123"
    const overlap6 = parseCommand('who is 123');
    check('"who is 123" parses safely without crash', !!overlap6.intent);

    // 7. "my schedule" vs "schedule meeting"
    const sched1 = parseCommand('my schedule');
    const sched2 = parseCommand('schedule meeting with team tomorrow at 10am');
    check('"my schedule" routes to TODAY_SCHEDULE', sched1.intent === INTENTS.TODAY_SCHEDULE);
    check('"schedule meeting..." routes to CALENDAR', sched2.intent === INTENTS.CALENDAR);

    // =========================================================================
    // SECTION 4: parseEventDate & buildIcsFile Edge Cases
    // =========================================================================
    console.log('\n🧪 Section 4: parseEventDate & buildIcsFile Stress');

    const dateInputs = [
        null,
        undefined,
        '',
        'today',
        'now',
        'tomorrow',
        'tomorrow at 3pm',
        'tomorrow at 10:30am',
        'on Friday',
        'next monday',
        'in 2 hours',
        'in 45 minutes',
        'in -5 hours',
        'yesterday',
        '2026-10-15',
        '10/15/2026',
        'Dec 25 at 8pm',
        'completely invalid random string 9999999',
    ];

    for (const dInput of dateInputs) {
        let threw = false;
        let d = null;
        try {
            d = parseEventDate(dInput);
        } catch (e) {
            threw = true;
        }
        check(`parseEventDate("${dInput}") returns valid Date`, !threw && d instanceof Date && !isNaN(d.getTime()));
    }

    // buildIcsFile stress
    const icsResult = buildIcsFile(
        'Sprint Review & Planning: "High Priority"',
        new Date(Date.now() + 3600000),
        new Date(Date.now() + 7200000),
        'Line 1\nLine 2, with comma and semicolon;\nEmojis: 🚀📅',
        'Conference Room A; Building 2'
    );
    check('buildIcsFile contains VCALENDAR start', icsResult.includes('BEGIN:VCALENDAR'));
    check('buildIcsFile contains VCALENDAR end', icsResult.includes('END:VCALENDAR'));
    check('buildIcsFile contains SUMMARY', icsResult.includes('SUMMARY:Sprint Review'));
    check('buildIcsFile contains DESCRIPTION', icsResult.includes('DESCRIPTION:Line 1'));
    check('buildIcsFile contains LOCATION', icsResult.includes('LOCATION:Conference Room A'));

    // =========================================================================
    // SECTION 5: createCalendarEvent Robustness (Native & Web)
    // =========================================================================
    console.log('\n🧪 Section 5: createCalendarEvent Parameter Resilience');

    // Missing options / malformed timestamps
    const calTests = [
        { title: null, when: null, opts: null, label: 'null title, when, opts' },
        { title: '', when: '', opts: {}, label: 'empty title, when, opts' },
        { title: 'Valid Event', when: 'tomorrow at 9am', opts: { startTime: NaN, endTime: NaN }, label: 'NaN startTime/endTime' },
        { title: 'Valid Event', when: 'tomorrow at 9am', opts: { startTime: Infinity }, label: 'Infinity startTime' },
        { title: 'Valid Event', when: 'tomorrow at 9am', opts: { startTime: -1000, endTime: -500 }, label: 'Negative startTime' },
        { title: 'Valid Event', when: 'tomorrow at 9am', opts: { startTime: 100000, endTime: 50000 }, label: 'endTime before startTime' },
        { title: '<script>alert(1)</script>', when: 'today', opts: { description: '<b>XSS</b>' }, label: 'HTML/Script injection in title/desc' },
    ];

    for (const tc of calTests) {
        let threw = false;
        let res = null;
        try {
            res = createCalendarEvent(tc.title, tc.when, tc.opts);
            if (res && typeof res.then === 'function') {
                await res;
            }
        } catch (e) {
            threw = true;
            console.error('Crash in createCalendarEvent:', tc.label, e);
        }
        check(`createCalendarEvent (${tc.label}) executed safely`, !threw && res && res.success);
        check(`createCalendarEvent (${tc.label}) provides synchronous .message`, typeof res?.message === 'string');
    }

    // =========================================================================
    // SECTION 6: Device Action Error & Permission Rejection Stress
    // =========================================================================
    console.log('\n🧪 Section 6: Device Action Error & Permission Rejection Stress');

    // 1. getBatteryStatus under hostile environments
    // Case A: navigator is undefined
    const origNav = globalThis.navigator;
    delete globalThis.navigator;
    let bStatus1 = await getBatteryStatus();
    check('getBatteryStatus without navigator returns fallback string', typeof bStatus1 === 'string' && bStatus1.length > 0);

    // Case B: navigator.getBattery throws/rejects
    globalThis.navigator = {
        async getBattery() {
            throw new Error('Battery hardware sensor detached');
        },
    };
    let bStatus2 = await getBatteryStatus();
    check('getBatteryStatus when getBattery() throws returns graceful error', bStatus2.includes('Unable') || bStatus2.includes('not supported'));

    // Case C: native bridge getBatteryInfo throws
    globalThis.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
            DeviceBridge: {
                async getBatteryInfo() {
                    throw new Error('Native BatteryManager IPC failed');
                },
            },
        },
    };
    globalThis.window.Capacitor = globalThis.Capacitor;
    let bStatus3 = await getBatteryStatus();
    check('getBatteryStatus when native bridge throws falls back gracefully', typeof bStatus3 === 'string' && bStatus3.length > 0);

    // 2. copyToClipboard under hostile environments
    // Case A: native bridge writeClipboard throws
    globalThis.Capacitor.Plugins.DeviceBridge.writeClipboard = async () => {
        throw new Error('ClipboardManager IPC failure');
    };
    // Web fallback has navigator.clipboard.writeText throw
    globalThis.navigator.clipboard = {
        async writeText() {
            const err = new Error('Clipboard write access blocked');
            err.name = 'NotAllowedError';
            throw err;
        },
    };
    let copyRes1 = await copyToClipboard('test copy');
    check('copyToClipboard when native & web throw returns success: false gracefully', copyRes1 && copyRes1.success === false);

    // Case B: non-string text arguments
    const nonStringTexts = [null, undefined, 12345, { key: 'val' }, [1, 2, 3]];
    for (const ns of nonStringTexts) {
        let copyRes2 = await copyToClipboard(ns);
        check(`copyToClipboard(${JSON.stringify(ns)}) executes without crash`, copyRes2 && typeof copyRes2.success === 'boolean');
    }

    // 3. readFromClipboard under hostile environments
    // Case A: native bridge throws
    globalThis.Capacitor.Plugins.DeviceBridge.readClipboard = async () => {
        throw new Error('ClipboardManager IPC failure');
    };
    // Web fallback has navigator.clipboard.readText throw NotAllowedError
    globalThis.navigator.clipboard.readText = async () => {
        const err = new Error('Permission denied by user');
        err.name = 'NotAllowedError';
        throw err;
    };
    let readRes1 = await readFromClipboard();
    check('readFromClipboard when native & web throw returns success: false gracefully', readRes1 && readRes1.success === false);
    check('readFromClipboard handles empty/failed read without throwing', readRes1.hasContent === false);

    // Case B: native bridge returns null text
    globalThis.Capacitor.Plugins.DeviceBridge.readClipboard = async () => {
        return { text: null, hasContent: false };
    };
    let readRes2 = await readFromClipboard();
    check('readFromClipboard with native null text returns text: "" safely', readRes2 && typeof readRes2.text === 'string');

    // 4. lookupContact under hostile environments
    // Case A: empty/null queries
    let cRes1 = await lookupContact('');
    let cRes2 = await lookupContact(null);
    let cRes3 = await lookupContact(undefined);
    check('lookupContact("") returns success: false with polite message', cRes1.success === false && cRes1.found === false);
    check('lookupContact(null) returns success: false with polite message', cRes2.success === false);
    check('lookupContact(undefined) returns success: false with polite message', cRes3.success === false);

    // Case B: native bridge throws
    globalThis.Capacitor.Plugins.DeviceBridge.searchContacts = async () => {
        throw new Error('ContactsContract query timeout');
    };
    // Web fallback navigator.contacts throws
    globalThis.navigator.contacts = {
        async select() {
            throw new Error('User dismissed contact picker');
        },
    };
    let cRes4 = await lookupContact('Charlie');
    check('lookupContact when native & web throw returns found: false gracefully without crashing', cRes4 && cRes4.found === false);

    // Restore navigator
    globalThis.navigator = origNav || {
        clipboard: { async writeText() {}, async readText() { return ''; } },
    };

    // =========================================================================
    // SECTION 7: generateResponse Execution Pipeline Stress
    // =========================================================================
    console.log('\n🧪 Section 7: generateResponse asyncAction Execution Pipeline Stress');

    const pipelineCases = [
        {
            parsed: { intent: INTENTS.CALENDAR, event: '', when: 'tomorrow' },
            expectedTag: 'CALENDAR',
            label: 'CALENDAR empty event name',
        },
        {
            parsed: { intent: INTENTS.CALENDAR, title: 'Dental', when: '' },
            expectedTag: 'CALENDAR',
            label: 'CALENDAR empty when',
        },
        {
            parsed: { intent: INTENTS.CONTACT_LOOKUP, name: '' },
            expectedTag: 'CONTACT_LOOKUP',
            label: 'CONTACT_LOOKUP empty name',
        },
        {
            parsed: { intent: INTENTS.CLIPBOARD_READ },
            expectedTag: 'CLIPBOARD_READ',
            label: 'CLIPBOARD_READ default',
        },
        {
            parsed: { intent: INTENTS.CLIPBOARD, text: '' },
            expectedTag: 'CLIPBOARD',
            label: 'CLIPBOARD empty text',
        },
        {
            parsed: { intent: INTENTS.BATTERY },
            expectedTag: 'BATTERY',
            label: 'BATTERY status',
        },
    ];

    for (const tc of pipelineCases) {
        let threw = false;
        let res = null;
        let asyncResult = null;
        try {
            res = generateResponse(tc.parsed);
            if (typeof res?.asyncAction === 'function') {
                asyncResult = await res.asyncAction();
            }
        } catch (e) {
            threw = true;
            console.error('Crash in generateResponse pipeline:', tc.label, e);
        }
        check(`generateResponse (${tc.label}) executed without crash`, !threw && res && res.intent_tag === tc.expectedTag);
        if (typeof res?.asyncAction === 'function') {
            check(`generateResponse (${tc.label}) asyncAction returned non-empty text`, typeof asyncResult === 'string' && asyncResult.length > 0);
        }
    }

    // =========================================================================
    // SECTION 8: Concurrent Fuzzing & Unhandled Rejection Guard
    // =========================================================================
    console.log('\n🧪 Section 8: Concurrent Action Execution & Random Fuzzing');

    // Concurrent burst of 30 mixed action calls
    const concurrentPromises = [];
    for (let i = 0; i < 30; i++) {
        concurrentPromises.push(createCalendarEvent(`Concurrent Event ${i}`, 'tomorrow at 10am'));
        concurrentPromises.push(getBatteryStatus());
        concurrentPromises.push(lookupContact(`Contact_${i}`));
        concurrentPromises.push(copyToClipboard(`Payload ${i}`));
        concurrentPromises.push(readFromClipboard());
    }
    const concurrentResults = await Promise.allSettled(concurrentPromises);
    const rejectedCount = concurrentResults.filter(r => r.status === 'rejected').length;
    check('150 concurrent action calls settled with 0 uncaught rejections', rejectedCount === 0);

    // Random string fuzzing of parseCommand
    const FUZZ_COUNT = 100;
    let fuzzCrashes = 0;
    const fuzzAlphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \t\n\r!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`\\';
    for (let i = 0; i < FUZZ_COUNT; i++) {
        const len = Math.floor(Math.random() * 80) + 1;
        let fuzzStr = '';
        for (let j = 0; j < len; j++) {
            fuzzStr += fuzzAlphabet[Math.floor(Math.random() * fuzzAlphabet.length)];
        }
        try {
            const parsed = parseCommand(fuzzStr);
            if (!parsed || typeof parsed.intent !== 'string') {
                fuzzCrashes++;
            }
        } catch {
            fuzzCrashes++;
        }
    }
    check(`Fuzzed parseCommand with ${FUZZ_COUNT} adversarial strings (0 crashes)`, fuzzCrashes === 0);

    // Final unhandled rejection audit
    check('Global process unhandled rejections is exactly 0', unhandledRejections.length === 0, `Detected: ${unhandledRejections.length}`);

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log('\n====================================================');
    console.log(`📊 Challenger Results: ${passedTests} passed, ${failedTests.length} failed (out of ${totalTests} total)`);
    console.log('====================================================');

    if (failedTests.length > 0) {
        console.error('\nFAILED TESTS:');
        for (const f of failedTests) {
            console.error(`  - ${f}`);
        }
        process.exit(1);
    } else {
        console.log('\n🌟 ALL CHALLENGER STRESS TESTS PASSED EMPIRICALLY!');
        process.exit(0);
    }
}

runAllStressTests().catch(err => {
    console.error('Fatal crash in stress runner:', err);
    process.exit(1);
});
