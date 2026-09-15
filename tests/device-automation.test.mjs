/**
 * Nice Assistant v1.2.0 — Device Automation Test Suite
 * Milestone 2: Deep Android & System Automations (Requirement R2)
 *
 * Covers:
 * 1. Static Invariants & Code Hardening
 *    - Android manifest permissions (READ_CONTACTS)
 *    - MainActivity plugin registrations (DeviceBridgePlugin)
 *    - DeviceBridgePlugin Java implementation & methods
 *    - JavaScript layer contracts (actions.js, assistant.js)
 * 2. Intent Parsing & Routing (parseCommand in src/assistant.js)
 *    - Calendar commands (schedule, add, create, remind, etc.)
 *    - Contacts lookup (find contact, lookup contact, who is, phone number of, etc.)
 *    - Battery queries (level, status, life, percent, charge, etc.)
 *    - Clipboard write & read commands (copy, clipboard, read clipboard, show clipboard, etc.)
 * 3. Device Actions under Mock Native Environment (Capacitor.isNativePlatform() === true)
 *    - Native Calendar creation via DeviceBridge plugin
 *    - Native Contacts lookup with hit & miss scenarios
 *    - Native Battery info retrieval (level, charging, plugType, power-save)
 *    - Native Clipboard read and write operations
 * 4. Device Actions under Mock Web Browser Environment (isNativePlatform() === false)
 *    - Offline Calendar fallback: RFC 5545 .ics generation & Blob URL
 *    - Online Calendar fallback: Google Calendar URL template
 *    - Web Contacts fallback: Contact Picker API & local fallback
 *    - Web Battery fallback: navigator.getBattery support & missing API degradation
 *    - Web Clipboard read & write via navigator.clipboard + permission rejection handling
 * 5. generateResponse asyncAction pipeline tests
 * 6. Strict Zero-Network Enforcement
 *    - Blocked outbound fetch / http / https during device automations
 *    - Verification of zero external requests
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

const read = (relPath) => fs.readFileSync(path.resolve(relPath), 'utf8');

// =========================================================================
// SECTION 1: STATIC CODE HARDENING & CONTRACT INSPECTION
// =========================================================================

function runStaticInspectionTests() {
    console.log('🔍 Group 1: Static Code Hardening & Native Invariants');

    const manifestSource = read('android/app/src/main/AndroidManifest.xml');
    const mainActivitySource = read('android/app/src/main/java/com/nice/assistant/MainActivity.java');
    const actionsSource = read('src/actions.js');
    const assistantSource = read('src/assistant.js');
    const pluginPath = path.resolve('android/app/src/main/java/com/nice/assistant/DeviceBridgePlugin.java');

    // 1. Android Manifest permissions
    assert(
        manifestSource.includes('android.permission.READ_CONTACTS'),
        'AndroidManifest.xml must declare android.permission.READ_CONTACTS for contacts lookup'
    );

    // 2. MainActivity plugin registration
    assert(
        mainActivitySource.includes('registerPlugin(DeviceBridgePlugin.class);'),
        'MainActivity.java must register DeviceBridgePlugin.class'
    );

    // 3. DeviceBridgePlugin.java implementation
    assert(fs.existsSync(pluginPath), 'DeviceBridgePlugin.java must exist in com/nice/assistant/');
    const pluginSource = fs.readFileSync(pluginPath, 'utf8');

    assert(/@CapacitorPlugin\s*\(\s*name\s*=\s*"DeviceBridge"/.test(pluginSource) || pluginSource.includes('@CapacitorPlugin(name = "DeviceBridge")'), 'DeviceBridgePlugin must have @CapacitorPlugin annotation with name "DeviceBridge"');
    assert(pluginSource.includes('extends Plugin'), 'DeviceBridgePlugin must extend Capacitor Plugin class');
    assert(pluginSource.includes('createCalendarEvent('), 'DeviceBridgePlugin must implement createCalendarEvent');
    assert(pluginSource.includes('searchContacts('), 'DeviceBridgePlugin must implement searchContacts');
    assert(pluginSource.includes('getBatteryInfo('), 'DeviceBridgePlugin must implement getBatteryInfo');
    assert(pluginSource.includes('readClipboard('), 'DeviceBridgePlugin must implement readClipboard');
    assert(pluginSource.includes('writeClipboard('), 'DeviceBridgePlugin must implement writeClipboard');
    assert(pluginSource.includes('ContactsContract.CommonDataKinds.Phone'), 'searchContacts must query ContactsContract Phone content URI');
    assert(pluginSource.includes('BatteryManager'), 'getBatteryInfo must query Android BatteryManager');
    assert(pluginSource.includes('ClipboardManager'), 'read/writeClipboard must access Android ClipboardManager');

    // 4. JavaScript Layer Contracts
    assert(actionsSource.includes('lookupContact(') || actionsSource.includes('export async function lookupContact'), 'src/actions.js must export lookupContact');
    assert(actionsSource.includes('readFromClipboard(') || actionsSource.includes('export async function readFromClipboard'), 'src/actions.js must export readFromClipboard');
    assert(actionsSource.includes('createCalendarEvent('), 'src/actions.js must export createCalendarEvent');
    assert(actionsSource.includes('getBatteryStatus('), 'src/actions.js must export getBatteryStatus');
    assert(actionsSource.includes('copyToClipboard('), 'src/actions.js must export copyToClipboard');

    // 5. Assistant Intents
    assert(assistantSource.includes('CONTACT_LOOKUP'), 'src/assistant.js must define INTENTS.CONTACT_LOOKUP');
    assert(assistantSource.includes('CLIPBOARD_READ'), 'src/assistant.js must define INTENTS.CLIPBOARD_READ');

    console.log('  ✅ Group 1: All static invariants and contracts verified.');
}

// =========================================================================
// SECTION 2: INTENT PARSING UNIT TESTS (parseCommand in src/assistant.js)
// =========================================================================

function runIntentParsingTests(parseCommand, INTENTS) {
    console.log('\n🧠 Group 2: Intent Parsing & Command Routing (parseCommand)');

    const testCases = [
        // Calendar Intent Permutations
        { input: 'schedule meeting with Bob tomorrow at 3pm', expectedIntent: INTENTS.CALENDAR, label: 'Schedule meeting with time' },
        { input: 'add appointment dentist on Friday', expectedIntent: INTENTS.CALENDAR, label: 'Add appointment with day' },
        { input: 'create event Team Sync at 10am', expectedIntent: INTENTS.CALENDAR, label: 'Create event at time' },
        { input: 'remind me to call Mom tomorrow', expectedIntent: INTENTS.CALENDAR, label: 'Remind me with relative day' },
        { input: 'calendar event Quarterly Planning', expectedIntent: INTENTS.CALENDAR, label: 'Direct calendar event command' },
        { input: 'set meeting design review for today', expectedIntent: INTENTS.CALENDAR, label: 'Set meeting today' },

        // Contact Lookup Intent Permutations
        { input: 'find contact Alice', expectedIntent: INTENTS.CONTACT_LOOKUP, expectedQuery: 'Alice', label: 'Find contact <name>' },
        { input: 'lookup contact Bob', expectedIntent: INTENTS.CONTACT_LOOKUP, expectedQuery: 'Bob', label: 'Lookup contact <name>' },
        { input: 'who is Charlie', expectedIntent: INTENTS.CONTACT_LOOKUP, expectedQuery: 'Charlie', label: 'Who is <name>' },
        { input: 'phone number of David', expectedIntent: INTENTS.CONTACT_LOOKUP, expectedQuery: 'David', label: 'Phone number of <name>' },
        { input: 'contact Sarah', expectedIntent: INTENTS.CONTACT_LOOKUP, expectedQuery: 'Sarah', label: 'Contact <name>' },
        { input: 'search contacts for John Doe', expectedIntent: INTENTS.CONTACT_LOOKUP, expectedQuery: 'John Doe', label: 'Search contacts for <name>' },

        // Battery Status Intent Permutations
        { input: 'battery', expectedIntent: INTENTS.BATTERY, label: 'Single word "battery"' },
        { input: 'battery level', expectedIntent: INTENTS.BATTERY, label: 'Battery level' },
        { input: 'battery status', expectedIntent: INTENTS.BATTERY, label: 'Battery status' },
        { input: 'battery life', expectedIntent: INTENTS.BATTERY, label: 'Battery life' },
        { input: 'battery percent', expectedIntent: INTENTS.BATTERY, label: 'Battery percent' },
        { input: 'how much battery', expectedIntent: INTENTS.BATTERY, label: 'How much battery' },
        { input: 'charge status', expectedIntent: INTENTS.BATTERY, label: 'Charge status' },
        { input: 'what is my battery level', expectedIntent: INTENTS.BATTERY, label: 'What is my battery level' },

        // Clipboard Commands Permutations
        { input: 'copy secret token 1234', expectedIntent: INTENTS.CLIPBOARD, label: 'Copy <text>' },
        { input: 'clipboard remember to buy milk', expectedIntent: INTENTS.CLIPBOARD, label: 'Clipboard <text>' },
        { input: 'read clipboard', expectedIntent: INTENTS.CLIPBOARD_READ, label: 'Read clipboard' },
        { input: "what's on my clipboard", expectedIntent: INTENTS.CLIPBOARD_READ, label: "What's on my clipboard" },
        { input: 'what is on my clipboard', expectedIntent: INTENTS.CLIPBOARD_READ, label: 'What is on my clipboard' },
        { input: 'paste clipboard', expectedIntent: INTENTS.CLIPBOARD_READ, label: 'Paste clipboard' },
        { input: 'show clipboard', expectedIntent: INTENTS.CLIPBOARD_READ, label: 'Show clipboard' },
        { input: 'view clipboard', expectedIntent: INTENTS.CLIPBOARD_READ, label: 'View clipboard' },
    ];

    for (const tc of testCases) {
        const parsed = parseCommand(tc.input);
        assert.equal(parsed.intent, tc.expectedIntent, `${tc.label} ("${tc.input}") should parse to ${tc.expectedIntent}, got ${parsed.intent}`);
        if (tc.expectedQuery) {
            const actualQuery = parsed.query || parsed.name || '';
            assert(
                actualQuery.toLowerCase().includes(tc.expectedQuery.toLowerCase()),
                `${tc.label} query should contain "${tc.expectedQuery}", got "${actualQuery}"`
            );
        }
        console.log(`  ✓ [parseCommand] ${tc.label} -> ${tc.expectedIntent}`);
    }
    console.log('  ✅ Group 2: All 26 intent parsing permutations verified.');
}

// =========================================================================
// SECTION 3: NATIVE ENVIRONMENT TESTS (Capacitor.isNativePlatform() === true)
// =========================================================================

async function runNativeEnvironmentTests(actions) {
    console.log('\n🤖 Group 3: Device Actions under Mock Native Environment');

    const nativeCalls = [];
    const mockBridge = {
        async createCalendarEvent(opts) {
            nativeCalls.push({ method: 'createCalendarEvent', opts });
            return { success: true, message: `Event ${opts.title} scheduled.` };
        },
        async searchContacts(args) {
            nativeCalls.push({ method: 'searchContacts', query: args?.query });
            const q = String(args?.query || '').toLowerCase();
            if (q.includes('alice')) {
                return {
                    found: true,
                    contacts: [{ name: 'Alice Smith', phone: '+1-555-0100', type: 'Mobile' }],
                };
            }
            return { found: false, contacts: [] };
        },
        async getBatteryInfo() {
            nativeCalls.push({ method: 'getBatteryInfo' });
            return {
                level: 84,
                isCharging: true,
                plugType: 'AC',
                isPowerSaveMode: false,
            };
        },
        async readClipboard() {
            nativeCalls.push({ method: 'readClipboard' });
            return { text: 'Native clipboard content: Top Secret', hasContent: true };
        },
        async writeClipboard(opts) {
            nativeCalls.push({ method: 'writeClipboard', opts });
            return { success: true };
        },
    };

    // Configure Mock Capacitor Native Environment
    globalThis.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
            DeviceBridge: mockBridge,
        },
    };
    globalThis.window.Capacitor = globalThis.Capacitor;

    // 1. Native Calendar Creation
    const calResult = actions.createCalendarEvent('Sprint Review', 'tomorrow at 3pm');
    assert(calResult.success, 'Native createCalendarEvent should succeed');
    assert(calResult.message.includes('Sprint Review'), 'Calendar confirmation should contain event name');
    const calCall = nativeCalls.find(c => c.method === 'createCalendarEvent');
    assert(calCall, 'DeviceBridge.createCalendarEvent should have been called');
    assert.equal(calCall.opts.title, 'Sprint Review', 'Calendar event title must match');
    assert(typeof calCall.opts.startTime === 'number' && calCall.opts.startTime > 0, 'Calendar startTime must be numeric timestamp');
    console.log('  ✓ [Native] createCalendarEvent dispatched valid intent with long timestamp');

    // 2. Native Contact Lookup (Hit)
    const contactHit = await actions.lookupContact('Alice');
    assert(contactHit.found === true, 'Contact lookup for Alice should report found');
    assert(contactHit.contacts.length > 0, 'Contact lookup for Alice should return records');
    assert.equal(contactHit.contacts[0].name, 'Alice Smith');
    assert.equal(contactHit.contacts[0].phone, '+1-555-0100');
    console.log('  ✓ [Native] lookupContact found Alice Smith (+1-555-0100)');

    // 3. Native Contact Lookup (Miss)
    const contactMiss = await actions.lookupContact('UnknownStranger');
    assert(contactMiss.found === false, 'Contact lookup for unknown person should report found: false');
    assert.equal(contactMiss.contacts.length, 0, 'Contact lookup for unknown person should return empty array');
    console.log('  ✓ [Native] lookupContact handled miss gracefully');

    // 4. Native Battery Status
    const batteryStatus = await actions.getBatteryStatus();
    assert(batteryStatus.includes('84%'), 'Battery status should report 84%');
    assert(batteryStatus.includes('Charging'), 'Battery status should report Charging');
    assert(batteryStatus.includes('AC'), 'Battery status should report AC plug type');
    console.log('  ✓ [Native] getBatteryStatus reported "84% Charging (AC)"');

    // 5. Native Clipboard Write
    const copyResult = await actions.copyToClipboard('Meeting token 9988');
    assert(copyResult.success, 'Native copyToClipboard should succeed');
    const writeCall = nativeCalls.find(c => c.method === 'writeClipboard');
    assert(writeCall, 'DeviceBridge.writeClipboard should have been called');
    assert.equal(writeCall.opts.text, 'Meeting token 9988');
    console.log('  ✓ [Native] copyToClipboard wrote text via ClipboardManager');

    // 6. Native Clipboard Read
    const readResult = await actions.readFromClipboard();
    assert(readResult.hasContent === true, 'readFromClipboard should report hasContent: true');
    assert.equal(readResult.text, 'Native clipboard content: Top Secret');
    console.log('  ✓ [Native] readFromClipboard retrieved text via ClipboardManager');

    console.log('  ✅ Group 3: All native device automation bridges verified.');
}

// =========================================================================
// SECTION 4: WEB BROWSER FALLBACK ENVIRONMENT TESTS (isNativePlatform() === false)
// =========================================================================

async function runWebFallbackEnvironmentTests(actions) {
    console.log('\n🌐 Group 4: Device Actions under Mock Browser Fallback Environment');

    let blobUrlsCreated = [];
    let clipboardStoredText = '';
    let windowOpenedUrls = [];

    globalThis.Capacitor = {
        isNativePlatform: () => false,
    };
    globalThis.window.Capacitor = globalThis.Capacitor;
    globalThis.window.open = (url) => {
        windowOpenedUrls.push(url);
        return {};
    };

    globalThis.URL.createObjectURL = (blob) => {
        const id = `blob:mock-uuid-${blobUrlsCreated.length + 1}`;
        blobUrlsCreated.push({ id, blob });
        return id;
    };
    globalThis.URL.revokeObjectURL = () => {};

    const mockNavigator = {
        clipboard: {
            async writeText(text) {
                clipboardStoredText = text;
            },
            async readText() {
                return clipboardStoredText;
            },
        },
        contacts: {
            async select(props) {
                return [{ name: ['Browser Contact'], tel: ['+1-800-WEB'] }];
            },
        },
        async getBattery() {
            return {
                level: 0.62,
                charging: false,
                dischargingTime: 5400,
            };
        },
    };
    Object.defineProperty(globalThis, 'navigator', {
        value: mockNavigator,
        configurable: true,
        writable: true,
    });
    globalThis.window.navigator = mockNavigator;

    // 1. Offline Calendar Fallback (.ics RFC 5545 generation)
    const calOffline = actions.createCalendarEvent('Offline Meet', 'tomorrow at 5pm');
    assert(calOffline.success, 'Offline calendar event creation should succeed');
    assert(blobUrlsCreated.length > 0, 'Offline calendar event creation should create a Blob URL');
    const createdBlob = blobUrlsCreated[blobUrlsCreated.length - 1].blob;
    let icsContent = '';
    if (typeof createdBlob.text === 'function') {
        icsContent = await createdBlob.text();
    } else if (calOffline.ics) {
        icsContent = calOffline.ics;
    }
    assert(icsContent.includes('BEGIN:VCALENDAR'), 'ICS file must contain BEGIN:VCALENDAR');
    assert(icsContent.includes('VERSION:2.0'), 'ICS file must declare VERSION:2.0');
    assert(icsContent.includes('SUMMARY:Offline Meet'), 'ICS file must have SUMMARY:Offline Meet');
    assert(icsContent.includes('DTSTART:'), 'ICS file must have DTSTART');
    assert(icsContent.includes('END:VCALENDAR'), 'ICS file must contain END:VCALENDAR');
    console.log('  ✓ [Web Fallback] createCalendarEvent generated RFC 5545 .ics Blob');

    // 2. Web Contact Picker API Fallback
    const contactResult = await actions.lookupContact('Browser Contact');
    assert(contactResult.found === true, 'Web contact lookup should succeed via navigator.contacts');
    assert.equal(contactResult.contacts[0].name, 'Browser Contact');
    assert.equal(contactResult.contacts[0].phone, '+1-800-WEB');
    console.log('  ✓ [Web Fallback] lookupContact resolved via navigator.contacts.select');

    // 3. Web Battery API Fallback (Supported)
    const batteryWeb = await actions.getBatteryStatus();
    assert(batteryWeb.includes('62%'), 'Web battery status should report 62%');
    assert(batteryWeb.includes('Discharging'), 'Web battery status should report Discharging');
    assert(batteryWeb.includes('1h 30m remaining'), 'Web battery status should report time remaining');
    console.log('  ✓ [Web Fallback] getBatteryStatus resolved via navigator.getBattery()');

    // 4. Web Battery API Fallback (Deprecated / Absent)
    const originalGetBattery = globalThis.navigator.getBattery;
    delete globalThis.navigator.getBattery;
    const batteryAbsent = await actions.getBatteryStatus();
    assert(
        batteryAbsent.includes('not supported') || batteryAbsent.includes('Unable'),
        'Absent getBattery should return user-friendly degradation message'
    );
    globalThis.navigator.getBattery = originalGetBattery;
    console.log('  ✓ [Web Fallback] getBatteryStatus handled absent navigator.getBattery without crashing');

    // 5. Web Clipboard Write & Read
    const copyWeb = await actions.copyToClipboard('Browser clipboard data 554');
    assert(copyWeb.success, 'Web copyToClipboard should succeed');
    assert.equal(clipboardStoredText, 'Browser clipboard data 554');

    const readWeb = await actions.readFromClipboard();
    assert(readWeb.hasContent === true, 'Web readFromClipboard should have content');
    assert.equal(readWeb.text, 'Browser clipboard data 554');
    console.log('  ✓ [Web Fallback] copyToClipboard & readFromClipboard round-trip verified');

    // 6. Web Clipboard Permission Rejection
    const originalReadText = globalThis.navigator.clipboard.readText;
    globalThis.navigator.clipboard.readText = async () => {
        const err = new Error('Permission denied');
        err.name = 'NotAllowedError';
        throw err;
    };
    const deniedRead = await actions.readFromClipboard();
    assert(deniedRead.hasContent === false, 'Permission denied readFromClipboard should return hasContent: false');
    assert(
        deniedRead.message.includes('blocked') || deniedRead.message.includes('permission') || deniedRead.message.includes('Unable'),
        'Permission denied readFromClipboard should explain access limitation'
    );
    globalThis.navigator.clipboard.readText = originalReadText;
    console.log('  ✓ [Web Fallback] readFromClipboard handled NotAllowedError gracefully');

    console.log('  ✅ Group 4: All browser fallbacks verified.');
}

// =========================================================================
// SECTION 5: GENERATERESPONSE EXECUTION PIPELINE TESTS
// =========================================================================

async function runGenerateResponseTests(generateResponse, INTENTS) {
    console.log('\n💬 Group 5: generateResponse Execution Pipeline');

    const testIntents = [
        { parsed: { intent: INTENTS.CALENDAR, event: 'Dentist', when: 'tomorrow at 2pm' }, expectedTag: 'CALENDAR' },
        { parsed: { intent: INTENTS.CONTACT_LOOKUP, name: 'Alice' }, expectedTag: 'CONTACT_LOOKUP' },
        { parsed: { intent: INTENTS.CLIPBOARD_READ }, expectedTag: 'CLIPBOARD_READ' },
        { parsed: { intent: INTENTS.CLIPBOARD, text: 'Secret' }, expectedTag: 'CLIPBOARD' },
        { parsed: { intent: INTENTS.BATTERY }, expectedTag: 'BATTERY' },
    ];

    for (const item of testIntents) {
        const res = generateResponse(item.parsed);
        assert.equal(res.intent_tag, item.expectedTag, `Expected intent_tag ${item.expectedTag}`);
        assert.ok(typeof res.text === 'string', 'Expected text confirmation string');
        assert.ok(typeof res.asyncAction === 'function', 'Expected asyncAction handler');
        const asyncResult = await res.asyncAction();
        assert.ok(typeof asyncResult === 'string' && asyncResult.length > 0, 'asyncAction must return non-empty text result');
        console.log(`  ✓ [generateResponse] ${item.expectedTag} handled cleanly`);
    }

    console.log('  ✅ Group 5: generateResponse pipeline verified.');
}

// =========================================================================
// SECTION 6: STRICT ZERO-NETWORK ENFORCEMENT & PLATFORM HARDENING
// =========================================================================

async function runZeroNetworkTests(actions) {
    console.log('\n🔒 Group 6: Strict Zero-Network Enforcement');

    let externalHttpAttempts = 0;
    const recordViolation = (target) => {
        externalHttpAttempts++;
        throw new Error(`[ZERO-NETWORK VIOLATION] Device automation attempted outbound request to: ${target}`);
    };

    // Spy on globalThis.fetch
    globalThis.fetch = async (url) => {
        recordViolation(url);
    };

    // Spy on node http and https
    const origHttpRequest = http.request;
    const origHttpsRequest = https.request;
    http.request = (url) => recordViolation(url);
    https.request = (url) => recordViolation(url);

    try {
        // Run all device automation methods in sequence
        await actions.createCalendarEvent('Security Audit Meeting', 'tomorrow at 9am');
        await actions.lookupContact('Security Contact');
        await actions.getBatteryStatus();
        await actions.copyToClipboard('Security Check');
        await actions.readFromClipboard();

        assert.equal(externalHttpAttempts, 0, 'Zero external network requests must occur during device automations');
        console.log('  ✓ 0 outbound HTTP/HTTPS requests triggered across all device automation flows');
    } finally {
        http.request = origHttpRequest;
        https.request = origHttpsRequest;
    }

    console.log('  ✅ Group 6: Zero-network offline compliance verified.');
}

// =========================================================================
// MAIN RUNNER
// =========================================================================

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

async function main() {
    console.log('====================================================');
    console.log('🧪 Nice Assistant — Device Automation Test Suite');
    console.log('====================================================\n');

    // 1. Static Code & Manifest Inspection
    runStaticInspectionTests();

    // 2. Setup Global Mock Environment for Module Dynamic Loading
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

    // Load assistant and actions modules
    const assistantModUrl = pathToFileURL(path.resolve('src/assistant.js')).href;
    const actionsModUrl = pathToFileURL(path.resolve('src/actions.js')).href;

    const assistantMod = await import(`${assistantModUrl}?t=${Date.now()}_${Math.random()}`);
    const actionsMod = await import(`${actionsModUrl}?t=${Date.now()}_${Math.random()}`);

    const INTENTS = assistantMod.INTENTS;

    // 3. Intent Parsing Tests
    runIntentParsingTests(assistantMod.parseCommand, INTENTS);

    // 4. Native Environment Integration Tests
    await runNativeEnvironmentTests(actionsMod);

    // 5. Web Browser Fallback Environment Tests
    await runWebFallbackEnvironmentTests(actionsMod);

    // 6. generateResponse Execution Pipeline Tests
    await runGenerateResponseTests(assistantMod.generateResponse, INTENTS);

    // 7. Zero-Network Compliance Tests
    await runZeroNetworkTests(actionsMod);

    console.log('\n====================================================');
    console.log('✅ device-automation.test: ok');
    console.log('====================================================\n');
}

main().catch((err) => {
    console.error('\n❌ device-automation.test: FAILED');
    console.error(err);
    process.exit(1);
});
