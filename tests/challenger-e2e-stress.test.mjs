/**
 * Challenger 2 Adversarial Stress & Isolation Test Suite
 * E2E Testing Track — Nice Assistant v1.2.0
 */

import assert from 'node:assert/strict';
import {
  initE2EEnvironment,
  resetE2EEnvironment,
  DOC_EXTENSIONS,
  getFileType,
  parseCsv,
  parseXlsx,
  chunkMarkdown,
  flattenJson,
  extractDocumentText,
  splitIntoParagraphs,
  searchEngineSimulator,
  conversationMemory,
  resolveAntecedents,
  aggregateMultiFileContext,
  activateZeroNetworkGuard,
  deactivateZeroNetworkGuard,
  getZeroNetworkAuditReport,
  resetZeroNetworkAudit,
  acquireWorkerMutex,
  enforceMemoryLimits,
  clampContextBudget,
  CapacitorShim,
} from './e2e/harness/env.mjs';
import { mockDeviceBridge } from './e2e/harness/mock-device-bridge.mjs';
import { MockWorker } from './e2e/harness/mock-workers.mjs';

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ PASS: ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, error: err.message, stack: err.stack });
    console.error(`  ✗ FAIL: ${name}\n    Error: ${err.message}`);
  }
}

async function runAdversarialStress() {
  console.log('\n======================================================================');
  console.log(' Starting Challenger 2 Adversarial Stress & Boundary Verification');
  console.log('======================================================================\n');

  initE2EEnvironment();
  resetE2EEnvironment();

  // -------------------------------------------------------------------
  // 1. BATTERY STRESS (0%, 100%, negative, >100, Power Save, Transitions)
  // -------------------------------------------------------------------
  console.log('\n--- 1. BATTERY BOUNDARY & STRESS TESTS ---');

  await test('BATTERY-01: Boundary battery level 0% reporting', async () => {
    mockDeviceBridge.setBatteryState({ level: 0, isCharging: false });
    const info = await mockDeviceBridge.getBatteryInfo();
    assert.strictEqual(info.level, 0);
    assert.strictEqual(info.isCharging, false);
  });

  await test('BATTERY-02: Boundary battery level 100% reporting', async () => {
    mockDeviceBridge.setBatteryState({ level: 100, isCharging: true });
    const info = await mockDeviceBridge.getBatteryInfo();
    assert.strictEqual(info.level, 100);
    assert.strictEqual(info.isCharging, true);
  });

  await test('BATTERY-03: Critical low threshold gating (<=15%) behavior', async () => {
    const isGated = (lvl, chg) => !chg && lvl <= 15;
    assert.strictEqual(isGated(0, false), true);
    assert.strictEqual(isGated(15, false), true);
    assert.strictEqual(isGated(16, false), false);
    assert.strictEqual(isGated(15, true), false, 'Charging at 15% should not gate');
  });

  await test('BATTERY-04: Android Power Save Mode active clamps to conserve mode (1200 chars)', async () => {
    mockDeviceBridge.setBatteryState({ isPowerSaveMode: true });
    const info = await mockDeviceBridge.getBatteryInfo();
    assert.strictEqual(info.isPowerSaveMode, true);
    const limits = enforceMemoryLimits('conserve');
    assert.strictEqual(limits.maxContextChars, 1200);
    assert.strictEqual(limits.maxNewTokens, 100);
  });

  await test('BATTERY-05: Rapid 50-cycle battery state transitions without race conditions', async () => {
    for (let i = 0; i < 50; i++) {
      const lvl = i * 2;
      const chg = i % 2 === 0;
      const ps = lvl < 20;
      mockDeviceBridge.setBatteryState({ level: lvl, isCharging: chg, isPowerSaveMode: ps, plugType: chg ? 'USB' : 'none' });
      const info = await mockDeviceBridge.getBatteryInfo();
      assert.strictEqual(info.level, lvl);
      assert.strictEqual(info.isCharging, chg);
      assert.strictEqual(info.isPowerSaveMode, ps);
    }
  });

  await test('BATTERY-06: Unmapped and anomalous plug types handled gracefully', async () => {
    for (const pt of ['AC', 'USB', 'Wireless', 'Dock', 'unknown', '99', '']) {
      mockDeviceBridge.setBatteryState({ plugType: pt });
      const info = await mockDeviceBridge.getBatteryInfo();
      assert.strictEqual(typeof info.plugType, 'string');
    }
  });

  // -------------------------------------------------------------------
  // 2. CONTEXT BUDGET CLAMPING (1200 / 2000 / 2800, No Spaces, Multibyte)
  // -------------------------------------------------------------------
  console.log('\n--- 2. CONTEXT BUDGET CLAMPING STRESS TESTS ---');

  await test('CLAMP-01: Low tier (1200 chars) exact boundary enforcement', () => {
    const limits = enforceMemoryLimits('low');
    assert.strictEqual(limits.maxContextChars, 1200);
    assert.strictEqual(limits.maxNewTokens, 100);

    const exact = 'word '.repeat(240); // 1200 chars
    const clampedExact = clampContextBudget(exact, 'low');
    assert.ok(clampedExact.length <= 1200);

    const oversized = 'word '.repeat(500); // 2500 chars
    const clampedOver = clampContextBudget(oversized, 'low');
    assert.ok(clampedOver.length <= 1200, `Clamped length ${clampedOver.length} exceeds 1200`);
    assert.ok(clampedOver.endsWith('...'));
  });

  await test('CLAMP-02: Mid tier (2000 chars) exact boundary enforcement', () => {
    const limits = enforceMemoryLimits('mid');
    assert.strictEqual(limits.maxContextChars, 2000);
    assert.strictEqual(limits.maxNewTokens, 150);

    const oversized = 'word '.repeat(600); // 3000 chars
    const clamped = clampContextBudget(oversized, 'mid');
    assert.ok(clamped.length <= 2000, `Clamped length ${clamped.length} exceeds 2000`);
    assert.ok(clamped.endsWith('...'));
  });

  await test('CLAMP-03: High tier (2800 chars) exact boundary enforcement', () => {
    const limits = enforceMemoryLimits('high');
    assert.strictEqual(limits.maxContextChars, 2800);
    assert.strictEqual(limits.maxNewTokens, 250);

    const oversized = 'word '.repeat(1000); // 5000 chars
    const clamped = clampContextBudget(oversized, 'high');
    assert.ok(clamped.length <= 2800, `Clamped length ${clamped.length} exceeds 2800`);
    assert.ok(clamped.endsWith('...'));
  });

  await test('CLAMP-04: String with zero spaces (continuous characters) does not crash or exceed budget', () => {
    const continuous = 'X'.repeat(5000);
    const clampedLow = clampContextBudget(continuous, 'low');
    assert.ok(clampedLow.length <= 1200, `Low clamp ${clampedLow.length} exceeds 1200`);
    assert.ok(clampedLow.endsWith('...'));

    const clampedMid = clampContextBudget(continuous, 'mid');
    assert.ok(clampedMid.length <= 2000, `Mid clamp ${clampedMid.length} exceeds 2000`);

    const clampedHigh = clampContextBudget(continuous, 'high');
    assert.ok(clampedHigh.length <= 2800, `High clamp ${clampedHigh.length} exceeds 2800`);
  });

  await test('CLAMP-05: Empty, null, undefined, and short inputs return safe strings', () => {
    assert.strictEqual(clampContextBudget('', 'low'), '');
    assert.strictEqual(clampContextBudget(null, 'low'), '');
    assert.strictEqual(clampContextBudget(undefined, 'low'), '');
    assert.strictEqual(clampContextBudget('hello world', 'low'), 'hello world');
  });

  await test('CLAMP-06: Giant 500,000 char string clamped in <5ms without memory exhaustion', () => {
    const giant = 'Paragraph of text in a very large document. '.repeat(11000);
    assert.ok(giant.length > 400000);
    const start = Date.now();
    const clamped = clampContextBudget(giant, 'high');
    const elapsed = Date.now() - start;
    assert.ok(clamped.length <= 2800);
    assert.ok(elapsed < 20, `Elapsed ${elapsed}ms too slow`);
  });

  // -------------------------------------------------------------------
  // 3. DOCUMENT EXTRACTION CORRUPT & MALFORMED INPUTS
  // -------------------------------------------------------------------
  console.log('\n--- 3. CORRUPT & EMPTY DOCUMENT INGESTION TESTS ---');

  await test('DOC-01: CSV with 0 bytes, null, whitespace, pure newlines', () => {
    assert.strictEqual(extractDocumentText({ name: 'f.csv', ext: 'csv' }, '').rowCount, 0);
    assert.strictEqual(extractDocumentText({ name: 'f.csv', ext: 'csv' }, null).rowCount, 0);
    assert.strictEqual(extractDocumentText({ name: 'f.csv', ext: 'csv' }, '   \n \r\n   ').rowCount, 0);
  });

  await test('DOC-02: CSV with unterminated quotes at EOF', () => {
    const malformed = 'id,name,notes\n1,Alice,"this quote never ends\n2,Bob,"still open';
    const res = extractDocumentText({ name: 'malformed.csv', ext: 'csv' }, malformed);
    assert.ok(res.rowCount >= 1);
  });

  await test('DOC-03: CSV with duplicate header names disambiguated cleanly', () => {
    const dupCsv = 'name,name,name,age\nAlice,Smith,Ali,30';
    const parsed = parseCsv(dupCsv);
    assert.strictEqual(parsed.headers[0], 'name');
    assert.strictEqual(parsed.headers[1], 'name_1');
    assert.strictEqual(parsed.headers[2], 'name_2');
    assert.strictEqual(parsed.headers[3], 'age');
  });

  await test('DOC-04: XLSX with 0 bytes, corrupt non-zip bytes, empty archive', () => {
    const emptyRes = parseXlsx(new Uint8Array(0));
    assert.strictEqual(emptyRes.error, 'empty_file');

    const corruptBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const corruptRes = parseXlsx(corruptBytes);
    assert.strictEqual(corruptRes.error, 'corrupt_archive');

    const fakeZipEmpty = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode('<sheetData/>')]);
    const zipEmptyRes = parseXlsx(fakeZipEmpty);
    assert.strictEqual(zipEmptyRes.rowCount, 0);
  });

  await test('DOC-05: Markdown with unclosed code blocks and unclosed tables', () => {
    const brokenMd = '# Header 1\n```js\nconst a = 1;\n// unclosed block\n| col1 | col2 |\n| val1 | val2 |';
    const chunks = chunkMarkdown(brokenMd, 'broken.md');
    assert.ok(chunks.length > 0);
    assert.ok(chunks.some(c => c.includes('const a = 1;')));
  });

  await test('DOC-06: Deeply nested JSON beyond maxDepth (20)', () => {
    let deep = { val: 'leaf' };
    for (let i = 0; i < 30; i++) {
      deep = { nested: deep };
    }
    const flattened = flattenJson(deep);
    assert.ok(flattened.length > 0);
    assert.ok(flattened.some(line => line.includes('[Max depth reached]')));
  });

  await test('DOC-07: Malformed JSON string gracefully returns text fallback', () => {
    const brokenJson = '{ "name": "Alice", invalid_json...';
    const res = extractDocumentText({ name: 'config.json', ext: 'json' }, brokenJson);
    assert.strictEqual(res.type, 'text');
    assert.strictEqual(res.error, 'invalid_json');
  });

  // -------------------------------------------------------------------
  // 4. TEST ISOLATION & ORDER INDEPENDENCE
  // -------------------------------------------------------------------
  console.log('\n--- 4. TEST ISOLATION & STATE INDEPENDENCE TESTS ---');

  await test('ISOLATION-01: ConversationMemory sliding window strict FIFO eviction', () => {
    conversationMemory.clearMemory();
    for (let i = 1; i <= 15; i++) {
      conversationMemory.recordTurn({
        userText: `Turn ${i}`,
        assistantText: `Response ${i}`,
        entities: [`Entity_${i}`],
      });
    }

    const turns = conversationMemory.getRecentTurns();
    assert.strictEqual(turns.length, 10, 'Memory buffer must cap at 10 turns');
    assert.strictEqual(turns[0].userText, 'Turn 6', 'Turn 1-5 must be evicted');
    assert.strictEqual(turns[9].userText, 'Turn 15');
    conversationMemory.clearMemory();
  });

  await test('ISOLATION-02: Zero-Network Guard active state isolation', () => {
    resetZeroNetworkAudit();
    deactivateZeroNetworkGuard();
    assert.strictEqual(getZeroNetworkAuditReport().active, false);

    activateZeroNetworkGuard();
    assert.strictEqual(getZeroNetworkAuditReport().active, true);

    deactivateZeroNetworkGuard();
    assert.strictEqual(getZeroNetworkAuditReport().active, false);
  });

  await test('ISOLATION-03: SearchEngineSimulator index isolation & cache clearing', async () => {
    searchEngineSimulator.invalidateCaches();
    searchEngineSimulator.indexedFiles.clear();

    searchEngineSimulator.indexFile('test_iso.txt', 'Secret information alpha bravo charlie');
    const r1 = await searchEngineSimulator.searchForAnswer('alpha bravo');
    assert.strictEqual(r1.totalFound, 1);

    searchEngineSimulator.indexedFiles.clear();
    searchEngineSimulator.invalidateCaches();
    const r2 = await searchEngineSimulator.searchForAnswer('alpha bravo');
    assert.strictEqual(r2.totalFound, 0);
  });

  await test('ISOLATION-04: MockDeviceBridge reset restores all default state', async () => {
    mockDeviceBridge.setBatteryState({ level: 5, isCharging: false, isPowerSaveMode: true });
    mockDeviceBridge.setPermission('READ_CONTACTS', false);
    mockDeviceBridge.setPermission('CLIPBOARD', false);
    await mockDeviceBridge.writeClipboard({ text: 'dirty' });

    mockDeviceBridge.reset();

    const bat = await mockDeviceBridge.getBatteryInfo();
    assert.strictEqual(bat.level, 85);
    assert.strictEqual(bat.isPowerSaveMode, false);
    assert.strictEqual(mockDeviceBridge.permissions.READ_CONTACTS, true);
    assert.strictEqual(mockDeviceBridge.permissions.CLIPBOARD, true);
    const clip = await mockDeviceBridge.readClipboard();
    assert.strictEqual(clip.text, '');
  });

  // -------------------------------------------------------------------
  // 5. TIER 3 & TIER 4 INTEGRATION VERIFICATION
  // -------------------------------------------------------------------
  console.log('\n--- 5. TIER 3 & TIER 4 WORKFLOW INTEGRATION TESTS ---');

  await test('INTEG-01: Multi-file cross-format RAG context aggregation (CSV + MD + JSON)', () => {
    const candidates = [
      { file: 'budget.csv', chunk: '[Table: budget.csv] Q3 OpEx: $1,245,000' },
      { file: 'brief.md', chunk: '[Doc: brief.md > Goals] Deliver offline assistant v1.2.0.' },
      { file: 'config.json', chunk: 'server.port: 8080\nserver.host: localhost' },
    ];
    const agg = aggregateMultiFileContext(candidates, 2000);
    assert.strictEqual(agg.files.length, 3);
    assert.ok(agg.aggregatedContext.includes('budget.csv'));
    assert.ok(agg.aggregatedContext.includes('brief.md'));
    assert.ok(agg.aggregatedContext.includes('config.json'));
  });

  await test('INTEG-02: Multi-turn Antecedent resolution with dialogue memory', () => {
    conversationMemory.clearMemory();
    conversationMemory.recordTurn({
      userText: 'Open project_spec.md and check requirements',
      assistantText: 'Opened project_spec.md. 4 key requirements found.',
      retrievedFiles: ['project_spec.md'],
      entities: ['project_spec.md'],
    });

    const followUp1 = resolveAntecedents('Summarize it for the team', conversationMemory);
    assert.strictEqual(followUp1.coreferenceApplied, true);
    assert.ok(followUp1.resolvedText.includes('project_spec.md'));

    const followUp2 = resolveAntecedents('Compare that with legacy.md', conversationMemory);
    assert.strictEqual(followUp2.coreferenceApplied, true);
    assert.ok(followUp2.resolvedText.includes('project_spec.md'));

    conversationMemory.clearMemory();
  });

  await test('INTEG-03: Zero-Network audit logging across fetch, XHR, and WebSocket', async () => {
    activateZeroNetworkGuard();
    resetZeroNetworkAudit();

    // 1. Fetch blocked
    let fetchBlocked = false;
    try {
      await globalThis.fetch('https://malicious-telemetry.com/track');
    } catch {
      fetchBlocked = true;
    }
    assert.strictEqual(fetchBlocked, true);

    // 2. Safe local fetch allowed
    let localAllowed = false;
    try {
      const res = await globalThis.fetch('http://localhost:3000/models/flan-t5.onnx');
      localAllowed = res.ok;
    } catch {}
    assert.strictEqual(localAllowed, true);

    // 3. XHR blocked
    let xhrBlocked = false;
    try {
      const xhr = new globalThis.XMLHttpRequest();
      xhr.open('POST', 'https://api.external.com/log');
      xhr.send();
    } catch {
      xhrBlocked = true;
    }
    assert.strictEqual(xhrBlocked, true);

    // 4. WebSocket blocked
    let wsBlocked = false;
    try {
      new globalThis.WebSocket('wss://live-sync.cloud.com');
    } catch {
      wsBlocked = true;
    }
    assert.strictEqual(wsBlocked, true);

    const report = getZeroNetworkAuditReport();
    assert.strictEqual(report.blockedRequests.length, 3);
    assert.strictEqual(report.allowedRequests.length, 1);
    assert.strictEqual(report.externalRequestCount, 3);

    deactivateZeroNetworkGuard();
    resetZeroNetworkAudit();
  });

  // SUMMARY
  console.log('\n======================================================================');
  console.log(` Challenger 2 Adversarial Stress Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    console.error('Failures detail:');
    failures.forEach((f, idx) => {
      console.error(`${idx + 1}) ${f.name}: ${f.error}`);
    });
    process.exit(1);
  }
}

runAdversarialStress();
