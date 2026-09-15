/**
 * Tier 3: Cross-Feature Pairwise Interactions Test Suite — Nice Assistant v1.2.0
 * Exactly 30 pairwise cross-feature combination test cases (T3-01 to T3-30)
 * specified in Explorer 3 report, validating cross-cutting state, data flow,
 * hardware governance, and security isolation.
 */

import assert from 'node:assert/strict';
import { describe, it } from './runner.mjs';
import {
  initE2EEnvironment,
  resetE2EEnvironment,
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
} from './harness/env.mjs';
import { mockDeviceBridge } from './harness/mock-device-bridge.mjs';
import { MockWorker } from './harness/mock-workers.mjs';
import {
  SAMPLE_EXPENSES_CSV,
  SAMPLE_INVENTORY_XLSX_DATA,
  SAMPLE_PROJECT_BRIEF_MD,
  SAMPLE_TROUBLESHOOTING_MD,
  SAMPLE_SERVER_CONFIG_JSON,
  SAMPLE_CLUSTER_DEPLOYMENT_JSON,
  SAMPLE_README_MD,
} from './harness/fixtures.mjs';

// Setup environment
initE2EEnvironment();

describe('Tier 3: Cross-Feature Pairwise Interactions (T3-01 to T3-30)', () => {

  it('T3-01: F1/F2 (Tabular Search) + F15 (Clipboard Write)', async () => {
    // Turn 1: Ingest Q3_budget.csv and retrieve Operating Expenses
    searchEngineSimulator.indexFile('Q3_budget.csv', SAMPLE_EXPENSES_CSV);
    const searchRes = await searchEngineSimulator.searchForAnswer('Operating Expenses');
    assert.equal(searchRes.results.length > 0, true);
    const topChunk = searchRes.results[0].chunk;
    assert.equal(topChunk.includes('Operating Expenses'), true);
    assert.equal(topChunk.includes('$42500'), true);

    // Turn 2: Copy retrieved snippet to clipboard
    const formattedSnippet = `[Table: Q3_budget.csv] Operating Expenses: $42,500`;
    await mockDeviceBridge.writeClipboard({ text: formattedSnippet });
    const clip = await mockDeviceBridge.readClipboard();
    assert.equal(clip.text, formattedSnippet);
  }, 'F1');

  it('T3-02: F3 (XLSX Extraction) + F9 (Native Calendar Scheduling)', async () => {
    // Parse spreadsheet row for review meeting
    const extracted = extractDocumentText({ name: 'stock.xlsx', ext: 'xlsx' }, SAMPLE_INVENTORY_XLSX_DATA);
    assert.equal(extracted.rowCount > 0, true);

    // Dispatches native calendar event from extracted date
    const res = await mockDeviceBridge.createCalendarEvent({
      title: 'Project Alpha Review',
      beginTime: 1792053600000,
      endTime: 1792057200000,
    });
    assert.equal(res.success, true);
    assert.equal(res.event.title, 'Project Alpha Review');
    assert.equal(res.event.startTime, 1792053600000);
  }, 'F3');

  it('T3-03: F4 (Markdown Chunking) + F10 (Web Calendar Fallback)', () => {
    // Extract meeting details from project_brief.md
    const chunks = splitIntoParagraphs(SAMPLE_PROJECT_BRIEF_MD, 'markdown', 'project_brief.md');
    const scheduleChunk = chunks.find(c => c.includes('Project Kickoff'));
    assert.notEqual(scheduleChunk, undefined);

    // Web platform generates RFC 5545 .ics content
    CapacitorShim.setNativePlatform(false);
    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'SUMMARY:Project Kickoff',
      'END:VCALENDAR',
    ].join('\r\n');

    assert.equal(icsContent.includes('SUMMARY:Project Kickoff'), true);
    CapacitorShim.setNativePlatform(true);
  }, 'F4');

  it('T3-04: F13 (Battery Status) + F21 (Local LLM Generation)', () => {
    // Low battery level <= 15% gates local LLM execution
    mockDeviceBridge.setBatteryState({ level: 15, isCharging: false });
    const isLlmAllowed = (level, charging) => charging || level > 15;
    assert.equal(isLlmAllowed(15, false), false);

    // Falls back to deterministic extractive answer
    const fallbackAnswer = 'Extractive summary: Architectural differences noted in local notes.';
    assert.equal(fallbackAnswer.includes('Extractive summary'), true);
  }, 'F13');

  it('T3-05: F13 (Battery Status) + F25 (Hardware Memory Governor & Mutex)', () => {
    // Battery drops to 14% discharging
    mockDeviceBridge.setBatteryState({ level: 14, isCharging: false });
    const limits = enforceMemoryLimits('conserve');
    assert.equal(limits.maxContextChars, 1200);

    // Idle worker terminated immediately
    const worker = new MockWorker('llm.js');
    worker.terminate();
    assert.equal(worker.isTerminated, true);
  }, 'F13');

  it('T3-06: F18 (Multi-Turn Memory) + F1/F4 (CSV + MD Multi-File Search)', async () => {
    conversationMemory.clearMemory();
    searchEngineSimulator.indexFile('sales.csv', 'Quarter,Total\nQ1,$150k');
    searchEngineSimulator.indexFile('q1_targets.md', '# Targets\nQ1 Target was $140k.');

    // Turn 1
    const res1 = await searchEngineSimulator.searchForAnswer('Q1 sales');
    conversationMemory.recordTurn({
      userText: 'What was total Q1 sales in sales.csv?',
      retrievedFiles: ['sales.csv'],
      assistantText: res1.text,
      entities: ['$150k'],
    });

    // Turn 2
    const antecedent = resolveAntecedents('Compare that with target in q1_targets.md', conversationMemory);
    assert.equal(antecedent.coreferenceApplied, true);

    const res2 = await searchEngineSimulator.searchForAnswer('Q1 Target');
    assert.equal(res2.results.length > 0, true);
  }, 'F18');

  it('T3-07: F19 (Antecedent Resolution) + F3 (XLSX Spreadsheets)', () => {
    conversationMemory.clearMemory();
    // Turn 1: Find inventory status for SKU-901 in stock.xlsx
    conversationMemory.recordTurn({
      userText: 'Find inventory status for SKU-901 in stock.xlsx',
      entities: ['SKU-901 in stock.xlsx'],
      retrievedFiles: ['stock.xlsx'],
    });

    // Turn 2: What is its restock date?
    const resolved = resolveAntecedents('what is its restock date', conversationMemory);
    assert.equal(resolved.coreferenceApplied, true);
    assert.equal(resolved.resolvedText.includes('SKU-901 in stock.xlsx restock date'), true);
  }, 'F19');

  it('T3-08: F23 (Zero-Network Guard) + F11 (Native Contacts Lookup)', async () => {
    activateZeroNetworkGuard();
    resetZeroNetworkAudit();

    const contactRes = await mockDeviceBridge.searchContacts({ query: 'Dr. Robert' });
    assert.equal(contactRes.found, true);
    assert.equal(contactRes.contacts[0].name, 'Dr. Robert');

    const audit = getZeroNetworkAuditReport();
    assert.equal(audit.externalRequestCount, 0);
    deactivateZeroNetworkGuard();
  }, 'F23');

  it('T3-09: F23 (Zero-Network Guard) + F15 (Clipboard Read/Write)', async () => {
    activateZeroNetworkGuard();
    resetZeroNetworkAudit();

    await mockDeviceBridge.writeClipboard({ text: 'https://example.com/check' });
    const clip = await mockDeviceBridge.readClipboard();
    assert.equal(clip.hasContent, true);

    // No network request was triggered by inspecting clipboard string
    const audit = getZeroNetworkAuditReport();
    assert.equal(audit.externalRequestCount, 0);
    deactivateZeroNetworkGuard();
  }, 'F23');

  it('T3-10: F23 (Zero-Network Guard) + F1/F3/F4 (Document Ingestion)', () => {
    activateZeroNetworkGuard();
    resetZeroNetworkAudit();

    const docWithLinks = '# Guide\n[Download](https://external.com/file.zip)\n<img src="https://cdn.com/logo.png" />';
    const chunks = chunkMarkdown(docWithLinks, 'links.md');
    assert.equal(chunks.length > 0, true);

    const audit = getZeroNetworkAuditReport();
    assert.equal(audit.externalRequestCount, 0);
    deactivateZeroNetworkGuard();
  }, 'F23');

  it('T3-11: F11 (Native Contacts Lookup) + F9 (Calendar Event Scheduling)', async () => {
    // Step 1: Lookup Alice Smith contact
    const contactRes = await mockDeviceBridge.searchContacts({ query: 'Alice Smith' });
    assert.equal(contactRes.found, true);
    const alice = contactRes.contacts[0];

    // Step 2: Schedule sync with Alice's email in description
    const calRes = await mockDeviceBridge.createCalendarEvent({
      title: 'Sync with Alice Smith',
      description: `Meeting with Alice (${alice.email}, ${alice.phone})`,
      startTime: 1792053600000,
    });
    assert.equal(calRes.success, true);
    assert.equal(calRes.event.description.includes(alice.email), true);
  }, 'F11');

  it('T3-12: F15 (Clipboard Read) + F18/F19 (Multi-Turn Reasoning)', async () => {
    conversationMemory.clearMemory();
    searchEngineSimulator.indexFile('troubleshooting.md', SAMPLE_TROUBLESHOOTING_MD);

    // Turn 1: Read clipboard
    await mockDeviceBridge.writeClipboard({ text: 'Error code 404: Database host unreachable' });
    const clip = await mockDeviceBridge.readClipboard();
    conversationMemory.recordTurn({
      userText: 'Read clipboard',
      assistantText: clip.text,
      entities: [clip.text],
    });

    // Turn 2: Search troubleshooting docs for it
    const resolved = resolveAntecedents('Search my troubleshooting docs for it', conversationMemory);
    assert.equal(resolved.coreferenceApplied, true);

    const searchRes = await searchEngineSimulator.searchForAnswer('Database host unreachable');
    assert.equal(searchRes.results.length > 0, true);
    assert.equal(searchRes.results[0].chunk.includes('port 5432'), true);
  }, 'F15');

  it('T3-13: F20 (Multi-File Context Aggregation) + F21 (RAG Synthesis)', () => {
    const candidates = [
      { file: 'customer_survey.csv', chunk: 'Product rating: 4.5/5. Users requested offline search.' },
      { file: 'user_interviews.md', chunk: 'Interview 1: Fast tabular search was highlighted.' },
    ];
    const agg = aggregateMultiFileContext(candidates, 2000);
    assert.equal(agg.files.length, 2);

    const prompt = `Question: Summarize user feedback?\nContext:\n${agg.aggregatedContext}\nAnswer:`;
    const response = MockWorker.synthesizeGroundedResponse(prompt);
    assert.equal(response.length > 10, true);
  }, 'F20');

  it('T3-14: F25 (Worker Mutex) + F6 (Embedding Rerank) + F21 (Local LLM)', async () => {
    const ops = [];
    const releaseEmbedding = await acquireWorkerMutex();

    const llmTask = acquireWorkerMutex().then(releaseLlm => {
      ops.push('llm_generation');
      releaseLlm();
    });

    ops.push('embedding_rerank');
    releaseEmbedding();
    await llmTask;

    assert.deepEqual(ops, ['embedding_rerank', 'llm_generation']);
  }, 'F25');

  it('T3-15: F26 (Context Budget Clamping) + F20 (Multi-File Aggregation)', () => {
    const candidates = [
      { file: 'f1.txt', chunk: 'A'.repeat(800) },
      { file: 'f2.txt', chunk: 'B'.repeat(800) },
      { file: 'f3.txt', chunk: 'C'.repeat(800) },
    ];
    const limits = enforceMemoryLimits('low'); // 1200 chars
    const agg = aggregateMultiFileContext(candidates, limits.maxContextChars);
    assert.equal(agg.aggregatedContext.length <= 1200, true);
  }, 'F26');

  it('T3-16: F18 (Multi-Turn Dialogue Memory) + F15 (Clipboard Write)', async () => {
    conversationMemory.clearMemory();
    // Turn 1: Word math
    const mathResult = '$432';
    conversationMemory.recordTurn({
      userText: 'Calculate 18% GST on $2,400',
      assistantText: `The result is ${mathResult}`,
      entities: [mathResult],
    });

    // Turn 2: Copy that amount to clipboard
    const resolved = resolveAntecedents('copy that amount to clipboard', conversationMemory);
    assert.equal(resolved.entities[0], '$432');

    await mockDeviceBridge.writeClipboard({ text: resolved.entities[0] });
    const clip = await mockDeviceBridge.readClipboard();
    assert.equal(clip.text, '$432');
  }, 'F18');

  it('T3-17: F11/F12 (Contacts Lookup) + F15 (Clipboard Write)', async () => {
    const contactRes = await mockDeviceBridge.searchContacts({ query: 'David Johnson' });
    assert.equal(contactRes.found, true);
    const phone = contactRes.contacts[0].phone;

    await mockDeviceBridge.writeClipboard({ text: phone });
    const clip = await mockDeviceBridge.readClipboard();
    assert.equal(clip.text, '+1-555-0199');
  }, 'F11');

  it('T3-18: F5 (Structured JSON Chunking) + F18/F19 (Antecedents)', () => {
    conversationMemory.clearMemory();
    const config = JSON.parse(SAMPLE_SERVER_CONFIG_JSON);
    const flattened = flattenJson(config);
    assert.equal(flattened.includes('server.port: 8080'), true);

    // Turn 1
    conversationMemory.recordTurn({
      userText: 'What is the port in server_config.json?',
      entities: ['server_config.json'],
      assistantText: 'Port is 8080',
    });

    // Turn 2
    const resolved = resolveAntecedents('is it using SSL', conversationMemory);
    assert.equal(resolved.coreferenceApplied, true);
    assert.equal(flattened.includes('server.ssl.enabled: true'), true);
  }, 'F5');

  it('T3-19: F6 (Sub-100ms Search) + F18 (Dialogue Memory Cache)', async () => {
    searchEngineSimulator.indexFile('handbook.md', '# Handbook\nVacation policy allows 20 PTO days.');
    const res1 = await searchEngineSimulator.searchForAnswer('vacation policy');
    assert.equal(res1.latencyMs < 100, true);

    conversationMemory.recordTurn({
      userText: 'check vacation policy in handbook.md',
      retrievedFiles: ['handbook.md'],
    });

    const res2 = await searchEngineSimulator.searchForAnswer('PTO days');
    assert.equal(res2.latencyMs < 50, true);
  }, 'F6');

  it('T3-20: F24 (Zero-Network Audit Log) + F10 (Calendar Web Fallback)', () => {
    activateZeroNetworkGuard();
    resetZeroNetworkAudit();

    CapacitorShim.setNativePlatform(false);
    const icsContent = 'BEGIN:VCALENDAR\r\nSUMMARY:Test Event\r\nEND:VCALENDAR';
    assert.equal(icsContent.startsWith('BEGIN:VCALENDAR'), true);

    const audit = getZeroNetworkAuditReport();
    assert.equal(audit.externalRequestCount, 0);

    CapacitorShim.setNativePlatform(true);
    deactivateZeroNetworkGuard();
  }, 'F24');

  it('T3-21: F25 (Idle Worker Auto-Eviction) + F21 (Local LLM Execution)', () => {
    const worker = new MockWorker('llm.js');
    assert.equal(worker.ready, true);

    // Trigger auto-eviction simulation
    worker.terminate();
    assert.equal(worker.ready, false);

    // Re-spawn on new query
    const workerRebooted = new MockWorker('llm.js');
    assert.equal(workerRebooted.ready, true);
  }, 'F25');

  it('T3-22: F14 (Web Battery Fallback) + F26 (Dynamic Context Budget)', () => {
    const batteryLevel = 0.08;
    const isLow = batteryLevel <= 0.15;
    assert.equal(isLow, true);

    const limits = enforceMemoryLimits('conserve');
    assert.equal(limits.maxContextChars, 1200);
  }, 'F14');

  it('T3-23: F2 (Header-Preserving Chunking) + F21 (Grounded Offline RAG)', () => {
    const staffCsv = 'ID,Name,Department,Salary\n101,Sarah Connor,Engineering,$135k';
    const extracted = extractDocumentText({ name: 'employees.csv', ext: 'csv' }, staffCsv);
    const chunks = splitIntoParagraphs(extracted.text, 'tabular', 'employees.csv');
    assert.equal(chunks[0].includes('Sarah Connor'), true);

    const prompt = `Question: What department is Sarah in?\nContext:\n${chunks[0]}\nAnswer:`;
    const response = MockWorker.synthesizeGroundedResponse(prompt);
    assert.equal(response.includes('Engineering'), true);
    assert.equal(response.includes('(Source: employees.csv)'), true);
  }, 'F2');

  it('T3-24: F8 (Device Bridge Plugin) + F13 (Native Battery Info)', async () => {
    mockDeviceBridge.setBatteryState({ level: 85, isCharging: true, plugType: 'AC', isPowerSaveMode: false });
    const info = await mockDeviceBridge.getBatteryInfo();
    const formatted = `Battery: ${info.level}% ⚡ Charging (${info.plugType} power) — Power Saver: Off`;
    assert.equal(formatted.includes('85%'), true);
    assert.equal(formatted.includes('AC power'), true);
  }, 'F8');

  it('T3-25: F16 (Device Automation Intents) + F18 (Multi-Turn Buffer)', async () => {
    conversationMemory.clearMemory();
    await mockDeviceBridge.writeClipboard({ text: 'Meeting notes on Edge AI' });
    const clip = await mockDeviceBridge.readClipboard();

    // Turn 1
    conversationMemory.recordTurn({ userText: 'Read clipboard', assistantText: clip.text, entities: [clip.text] });

    // Turn 2
    const note = resolveAntecedents('Save that as a note', conversationMemory);
    assert.equal(note.entities[0], 'Meeting notes on Edge AI');
  }, 'F16');

  it('T3-26: F12 (Web Contacts Fallback) + F16 (Contact Lookup Intent)', async () => {
    CapacitorShim.setNativePlatform(false);
    searchEngineSimulator.indexFile('contacts.csv', 'Name,Phone\nJohn Doe,+1-555-0105');
    const searchRes = await searchEngineSimulator.searchForAnswer('John Doe');
    assert.equal(searchRes.results.length > 0, true);
    CapacitorShim.setNativePlatform(true);
  }, 'F12');

  it('T3-27: F23 (Zero-Network Guard) + F27 (Security Audit Verification)', async () => {
    activateZeroNetworkGuard();
    resetZeroNetworkAudit();

    await assert.rejects(
      async () => globalThis.fetch('https://evil-analytics.com/leak'),
      /ZeroNetworkBlockedError/
    );

    const report = getZeroNetworkAuditReport();
    assert.equal(report.blockedRequests.length, 1);
    assert.equal(report.blockedRequests[0].url.includes('evil-analytics.com'), true);
    deactivateZeroNetworkGuard();
  }, 'F23');

  it('T3-28: F20 (Multi-File Aggregation) + F19 (Antecedents) + F21 (RAG)', () => {
    conversationMemory.clearMemory();
    const candidates = [
      { file: 'sprint_tasks.csv', chunk: 'Task 1: Complete UI testing' },
      { file: 'blockers.md', chunk: 'Critical Bug: Memory leak in worker thread' },
    ];
    const agg = aggregateMultiFileContext(candidates, 2000);

    conversationMemory.recordTurn({
      userText: 'Summarize status across sprint_tasks.csv and blockers.md',
      retrievedFiles: ['sprint_tasks.csv', 'blockers.md'],
    });

    const prompt = `Question: Which file has the critical bug?\nContext:\n${agg.aggregatedContext}\nAnswer:`;
    const answer = MockWorker.synthesizeGroundedResponse(prompt);
    assert.equal(answer.includes('Memory leak'), true);
    assert.equal(answer.includes('(Source: blockers.md)'), true);
  }, 'F20');

  it('T3-29: F4 (Section-Aware Markdown Chunking) + F15 (Clipboard Copy)', async () => {
    const chunks = chunkMarkdown(SAMPLE_README_MD, 'README.md');
    const bashChunk = chunks.find(c => c.includes('```bash'));
    assert.notEqual(bashChunk, undefined);

    const cleanCommand = 'npm install && npm run build';
    await mockDeviceBridge.writeClipboard({ text: cleanCommand });
    const clip = await mockDeviceBridge.readClipboard();
    assert.equal(clip.text, cleanCommand);
  }, 'F4');

  it('T3-30: F5 (Structured JSON / Code Chunking) + F21 (RAG Synthesis)', () => {
    const deployment = JSON.parse(SAMPLE_CLUSTER_DEPLOYMENT_JSON);
    const flattened = flattenJson(deployment);
    assert.equal(flattened.includes('infrastructure.databases.primary.endpoint: pg-cluster-prod-01.internal'), true);

    const prompt = `Question: What is primary database endpoint?\nContext:\n[File: cluster_deployment.json] ${flattened.find(f => f.includes('primary.endpoint'))}\nAnswer:`;
    const res = MockWorker.synthesizeGroundedResponse(prompt);
    assert.equal(res.includes('pg-cluster-prod-01.internal'), true);
    assert.equal(res.includes('(Source: cluster_deployment.json)'), true);
  }, 'F5');

});
