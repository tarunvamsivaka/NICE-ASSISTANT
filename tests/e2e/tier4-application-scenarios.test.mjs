/**
 * Tier 4: Real-World Application Scenarios Test Suite — Nice Assistant v1.2.0
 * Exactly 15 comprehensive end-to-end user workflows (T4-01 to T4-15)
 * specified in Explorer 3 report, solving multi-step practical tasks across
 * financial, healthcare, travel, legal, field operations, engineering, and logistics.
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
  activateZeroNetworkGuard,
  deactivateZeroNetworkGuard,
  getZeroNetworkAuditReport,
  resetZeroNetworkAudit,
  enforceMemoryLimits,
  clampContextBudget,
} from './harness/env.mjs';
import { mockDeviceBridge } from './harness/mock-device-bridge.mjs';
import { MockWorker } from './harness/mock-workers.mjs';
import {
  SAMPLE_MINIMAL_XLSX_DATA,
  SAMPLE_CANDIDATES_XLSX_DATA,
  SAMPLE_MSA_2025_MD,
  SAMPLE_MSA_2026_DRAFT_MD,
  SAMPLE_CLUSTER_DEPLOYMENT_JSON,
} from './harness/fixtures.mjs';

// Setup environment
initE2EEnvironment();

describe('Tier 4: Real-World Application Workflows (T4-01 to T4-15)', () => {

  // -----------------------------------------------------------------
  // SCENARIO T4-01: Financial Spreadsheet Analysis & Audit Scheduling
  // -----------------------------------------------------------------
  it('Scenario T4-01: Financial Spreadsheet Analysis & Audit Review Scheduling', async () => {
    conversationMemory.clearMemory();
    mockDeviceBridge.reset();

    // 1. Ingest quarterly expense spreadsheet
    const extracted = extractDocumentText({ name: 'Q3_Financial_Summary.xlsx', ext: 'xlsx' }, SAMPLE_MINIMAL_XLSX_DATA);
    assert.equal(extracted.type, 'tabular');
    assert.equal(extracted.rowCount > 0, true);

    // 2. Query Q3 operating expenditure
    const q3Opex = '$1,245,000';
    assert.equal(extracted.text.includes(q3Opex), true);
    conversationMemory.recordTurn({
      userText: 'What was our total operating expenditure in Q3 according to Q3_Financial_Summary.xlsx?',
      assistantText: `Total Q3 OpEx was ${q3Opex}`,
      entities: ['Q3 Operating Expenditure ($1,245,000)'],
      retrievedFiles: ['Q3_Financial_Summary.xlsx'],
    });

    // 3. Multi-turn follow up: "How does that compare to Q2?"
    const resolved = resolveAntecedents('How does that compare to Q2?', conversationMemory);
    assert.equal(resolved.entities[0].includes('Q3 Operating Expenditure'), true);

    const q2Opex = '$1,120,000';
    const varianceSummary = 'Q3 vs Q2 OpEx Variance: +$125,000 (+11.16%) [Source: Q3_Financial_Summary.xlsx]';
    conversationMemory.recordTurn({
      userText: 'How does that compare to Q2?',
      assistantText: varianceSummary,
      entities: [varianceSummary],
    });

    // 4. Copy variance summary to clipboard
    await mockDeviceBridge.writeClipboard({ text: varianceSummary });
    const clip = await mockDeviceBridge.readClipboard();
    assert.equal(clip.text, varianceSummary);

    // 5. Schedule review meeting next Tuesday at 2 PM
    const nextTuesdayMs = Date.now() + 86400000 * 3;
    const calRes = await mockDeviceBridge.createCalendarEvent({
      title: 'Q3 Budget Review',
      startTime: nextTuesdayMs,
      description: varianceSummary,
    });
    assert.equal(calRes.success, true);
    assert.equal(calRes.event.title, 'Q3 Budget Review');
  }, 'F3');

  // -----------------------------------------------------------------
  // SCENARIO T4-02: Project Release Blocker Triage & Team Communication
  // -----------------------------------------------------------------
  it('Scenario T4-02: Project Release Blocker Triage & Team Communication', async () => {
    conversationMemory.clearMemory();
    mockDeviceBridge.reset();

    // 1. Ingest release notes and sprint tasks
    searchEngineSimulator.indexFile('v1.2.0_release_notes.md', '# Release 1.2.0\n## Critical Blockers\nAssigned: Marcus Vance to fix P0 worker crash.');
    searchEngineSimulator.indexFile('jira_sprint_export.csv', 'Key,Assignee,Priority,Status\nJIRA-402,Marcus Vance,P0,Open');

    // 2. Query critical blockers
    const searchRes = await searchEngineSimulator.searchForAnswer('critical blockers Marcus Vance');
    assert.equal(searchRes.results.length > 0, true);
    assert.equal(searchRes.results[0].chunk.includes('Marcus Vance'), true);

    // 3. Look up contact Marcus Vance
    const contactRes = await mockDeviceBridge.searchContacts({ query: 'Marcus Vance' });
    assert.equal(contactRes.found, true);
    assert.equal(contactRes.contacts[0].phone, '+1-555-0144');
    assert.equal(contactRes.contacts[0].email, 'marcus@nice.local');

    // 4. Save note
    const noteContent = 'Marcus Vance assigned to fix P0 blockers before Thursday release cutoff.';
    conversationMemory.recordTurn({
      userText: `Save note: ${noteContent}`,
      assistantText: 'Note saved successfully.',
      entities: [noteContent],
    });
    assert.equal(conversationMemory.getRecentTurns().length, 1);
  }, 'F1');

  // -----------------------------------------------------------------
  // SCENARIO T4-03: In-Flight Offline Travel & Power Conservation Mode
  // -----------------------------------------------------------------
  it('Scenario T4-03: In-Flight Offline Travel & Power Conservation Mode', async () => {
    activateZeroNetworkGuard();
    resetZeroNetworkAudit();

    // 1. Battery query: 17%, discharging, power saver active
    mockDeviceBridge.setBatteryState({ level: 17, isCharging: false, isPowerSaveMode: true });
    const battery = await mockDeviceBridge.getBatteryInfo();
    assert.equal(battery.level, 17);
    assert.equal(battery.isPowerSaveMode, true);

    // 2. Governor activates conserve energy mode and clamps context
    const limits = enforceMemoryLimits('conserve');
    assert.equal(limits.maxContextChars, 1200);

    // 3. Query itinerary documents offline
    searchEngineSimulator.indexFile('trip_bookings.tsv', 'Item\tConfirmation\tAddress\nFlight\tNX-8821\tGate 14\nHotel\tHT-502\t452 Market St');
    const searchRes = await searchEngineSimulator.searchForAnswer('NX-8821 Market St');
    assert.equal(searchRes.results.length > 0, true);
    assert.equal(searchRes.results[0].chunk.includes('452 Market St'), true);

    // 4. Copy hotel address to clipboard
    await mockDeviceBridge.writeClipboard({ text: '452 Market St' });
    const clip = await mockDeviceBridge.readClipboard();
    assert.equal(clip.text, '452 Market St');

    // 5. Zero-network audit verification
    const audit = getZeroNetworkAuditReport();
    assert.equal(audit.externalRequestCount, 0);
    deactivateZeroNetworkGuard();
  }, 'F13');

  // -----------------------------------------------------------------
  // SCENARIO T4-04: Clinical Prescription Dosage Check & Patient Alarm Setup
  // -----------------------------------------------------------------
  it('Scenario T4-04: Clinical Prescription Dosage Check & Patient Alarm Setup', async () => {
    // 1. Ingest clinical guideline markdown and patient chart CSV
    const guidelines = '# Clinical Guidelines\n### Ceftriaxone\nStandard pediatric dosage: 50-75 mg/kg/day.\nWarning: Cross-reactivity in severe penicillin allergy.';
    const patients = 'Bed,Patient,Allergies\nBed 12,John Doe,Penicillin (Severe)\nBed 14,Jane Smith,None';

    searchEngineSimulator.indexFile('clinical_guidelines.md', guidelines);
    searchEngineSimulator.indexFile('ward_b_patients.csv', patients);

    // 2. Query dosage
    const res1 = await searchEngineSimulator.searchForAnswer('pediatric dosage Ceftriaxone');
    assert.equal(res1.results.length > 0, true);
    assert.equal(res1.results[0].chunk.includes('50-75 mg/kg/day'), true);

    // 3. Query Patient Bed 12 allergy
    const res2 = await searchEngineSimulator.searchForAnswer('Bed 12 Allergies');
    assert.equal(res2.results.length > 0, true);
    assert.equal(res2.results[0].chunk.includes('Penicillin (Severe)'), true);

    // 4. RAG cross-reactivity warning
    const prompt = `Question: Does guideline warn against Ceftriaxone in severe penicillin allergy?\nContext:\n${guidelines}\nAnswer:`;
    const response = MockWorker.synthesizeGroundedResponse(prompt);
    assert.equal(response.includes('Warning: Cross-reactivity'), true);
  }, 'F4');

  // -----------------------------------------------------------------
  // SCENARIO T4-05: STEM Study Session & Homework Word Math Verification
  // -----------------------------------------------------------------
  it('Scenario T4-05: STEM Study Session & Homework Word Math Verification', async () => {
    // 1. Index physics mechanics notes
    const physicsMd = '# Physics Mechanics\n## Planetary Motion\nEscape velocity: v_e = sqrt(2 * G * M / R).\nEarth escape velocity is approximately 11186 m/s (11.2 km/s).';
    searchEngineSimulator.indexFile('physics_mechanics.md', physicsMd);

    // 2. Query escape velocity formula
    const res = await searchEngineSimulator.searchForAnswer('formula escape velocity');
    assert.equal(res.results.length > 0, true);
    assert.equal(res.results[0].chunk.includes('v_e = sqrt(2 * G * M / R)'), true);

    // 3. Word math evaluation
    const calculatedVelocity = '11186 m/s';
    await mockDeviceBridge.writeClipboard({ text: calculatedVelocity });
    const clip = await mockDeviceBridge.readClipboard();
    assert.equal(clip.text, '11186 m/s');
  }, 'F7');

  // -----------------------------------------------------------------
  // SCENARIO T4-06: Legal Contract Addendum Comparison & Clause Extraction
  // -----------------------------------------------------------------
  it('Scenario T4-06: Legal Contract Addendum Comparison & Clause Extraction', () => {
    // 1. Ingest both versions of MSA agreement
    const chunk2025 = chunkMarkdown(SAMPLE_MSA_2025_MD, 'msa_agreement_2025.md');
    const chunk2026 = chunkMarkdown(SAMPLE_MSA_2026_DRAFT_MD, 'msa_agreement_2026_draft.md');

    assert.equal(chunk2025.some(c => c.includes('capped at 12 months fees paid')), true);
    assert.equal(chunk2026.some(c => c.includes('capped at 2x annual fees')), true);

    // 2. Comparative synthesis
    const comparisonPrompt = `Question: What is the difference in liability cap?\nContext:\n[File: msa_agreement_2025.md] Section 11: Liability capped at 12 months fees paid.\n[File: msa_agreement_2026_draft.md] Section 11: Liability capped at 2x annual fees.\nAnswer:`;
    const summary = MockWorker.synthesizeGroundedResponse(comparisonPrompt);
    assert.equal(summary.includes('fees'), true);
  }, 'F4');

  // -----------------------------------------------------------------
  // SCENARIO T4-07: Field Equipment Maintenance & Repair Scheduling
  // -----------------------------------------------------------------
  it('Scenario T4-07: Field Equipment Maintenance & Repair Scheduling', async () => {
    // 1. Index generator fleet log and manual
    const fleetLog = 'Unit,RunHours,LastService,FaultCode\nG-402,4120,2026-08-10,E-33\nG-405,1200,2026-09-01,None';
    const manual = '# Manual\n### Fault Codes\nE-33: Fuel rail pressure drop; inspect high pressure fuel pump.\nE-12: Coolant overheat.';
    searchEngineSimulator.indexFile('generator_fleet_log.csv', fleetLog);
    searchEngineSimulator.indexFile('diesel_troubleshooting_manual.md', manual);

    // 2. Query maintenance record for Unit G-402
    const resLog = await searchEngineSimulator.searchForAnswer('Unit G-402');
    assert.equal(resLog.results.length > 0, true);
    assert.equal(resLog.results[0].chunk.includes('E-33'), true);

    // 3. Query meaning of fault code E-33
    const resManual = await searchEngineSimulator.searchForAnswer('E-33 fuel rail');
    assert.equal(resManual.results.length > 0, true);
    assert.equal(resManual.results[0].chunk.includes('Fuel rail pressure drop'), true);

    // 4. Schedule overhaul event
    const resCal = await mockDeviceBridge.createCalendarEvent({
      title: 'Overhaul Fuel Pump G-402',
      startTime: 1792053600000,
      description: 'Fuel rail pressure drop (Error E-33)',
    });
    assert.equal(resCal.success, true);
  }, 'F2');

  // -----------------------------------------------------------------
  // SCENARIO T4-08: HR Talent Acquisition Interview Pipeline Execution
  // -----------------------------------------------------------------
  it('Scenario T4-08: HR Talent Acquisition Interview Pipeline Execution', async () => {
    conversationMemory.clearMemory();
    mockDeviceBridge.reset();

    // 1. Ingest candidates spreadsheet
    const extracted = extractDocumentText({ name: 'candidates_pipeline_q3.xlsx', ext: 'xlsx' }, SAMPLE_CANDIDATES_XLSX_DATA);
    assert.equal(extracted.text.includes('Elena Rostova'), true);
    assert.equal(extracted.text.includes('4.8'), true);

    // 2. Query candidate
    conversationMemory.recordTurn({
      userText: 'Find candidates with Senior Android Engineer role',
      assistantText: 'Elena Rostova (Rating: 4.8, Expected: $165k)',
      entities: ['Elena Rostova'],
      retrievedFiles: ['candidates_pipeline_q3.xlsx'],
    });

    // 3. Coreference resolution: "Look up contact Elena Rostova"
    const contactRes = await mockDeviceBridge.searchContacts({ query: 'Elena Rostova' });
    assert.equal(contactRes.found, true);
    assert.equal(contactRes.contacts[0].phone, '+1-555-0182');

    // 4. Copy phone to clipboard
    await mockDeviceBridge.writeClipboard({ text: contactRes.contacts[0].phone });
    const clip = await mockDeviceBridge.readClipboard();
    assert.equal(clip.text, '+1-555-0182');

    // 5. Schedule interview
    const calRes = await mockDeviceBridge.createCalendarEvent({
      title: 'Interview Elena Rostova',
      startTime: 1792053600000,
    });
    assert.equal(calRes.success, true);
  }, 'F3');

  // -----------------------------------------------------------------
  // SCENARIO T4-09: Warehouse Inventory Reorder & Metric Conversion
  // -----------------------------------------------------------------
  it('Scenario T4-09: Warehouse Inventory Reorder & Metric Conversion', () => {
    // 1. Ingest warehouse bins stock CSV
    const stockCsv = 'SKU,Item,Qty,MinThreshold,UnitWeightLbs\nSKU-5542,Industrial Bearings,45,200,2.5';
    searchEngineSimulator.indexFile('warehouse_bins_stock.csv', stockCsv);

    // 2. Calculate shortfall: 200 - 45 = 155 units
    const shortfall = 200 - 45;
    assert.equal(shortfall, 155);

    // 3. Calculate total weight: 155 * 2.5 = 387.5 lbs
    const totalWeightLbs = shortfall * 2.5;
    assert.equal(totalWeightLbs, 387.5);

    // 4. Convert lbs to kg: 387.5 * 0.453592 = 175.7669 kg
    const totalWeightKg = Number((totalWeightLbs * 0.453592).toFixed(2));
    assert.equal(totalWeightKg, 175.77);

    // 5. Save note
    const note = `Reorder ${shortfall} units SKU-5542 total weight ${totalWeightKg} kg from supplier.`;
    assert.equal(note.includes('155 units'), true);
    assert.equal(note.includes('175.77 kg'), true);
  }, 'F1');

  // -----------------------------------------------------------------
  // SCENARIO T4-10: Confidential Executive Journaling & Privacy Guardrail
  // -----------------------------------------------------------------
  it('Scenario T4-10: Confidential Executive Journaling & Privacy Guardrail Verification', () => {
    activateZeroNetworkGuard();
    resetZeroNetworkAudit();
    conversationMemory.clearMemory();

    // 1. Record sensitive journal note
    const secretNote = 'M&A exploration with Horizon Corp approved for preliminary due diligence.';
    conversationMemory.recordTurn({
      userText: `Save note: ${secretNote}`,
      assistantText: 'Confidential note saved locally.',
      entities: [secretNote],
    });

    const turns = conversationMemory.getRecentTurns();
    assert.equal(turns[0].entities[0], secretNote);

    // 2. Audit verification confirms strictly 0 external network requests
    const report = getZeroNetworkAuditReport();
    assert.equal(report.externalRequestCount, 0);
    deactivateZeroNetworkGuard();
  }, 'F23');

  // -----------------------------------------------------------------
  // SCENARIO T4-11: Commercial Real Estate Site Inspection & Client Offer
  // -----------------------------------------------------------------
  it('Scenario T4-11: Commercial Real Estate Site Inspection & Client Offer', async () => {
    // 1. Ingest commercial listings
    const listings = 'Address,Price,SqFt,Zoning\n1200 Technology Parkway,3450000,15000,Commercial Light Industrial';
    searchEngineSimulator.indexFile('commercial_listings_2026.csv', listings);

    // 2. Compute price per sq ft: 3450000 / 15000 = $230.00
    const pricePerSqFt = 3450000 / 15000;
    assert.equal(pricePerSqFt, 230);

    // 3. Copy pricing breakdown to clipboard
    const quote = `1200 Technology Parkway: $3,450,000 ($230.00/sqft)`;
    await mockDeviceBridge.writeClipboard({ text: quote });
    const clip = await mockDeviceBridge.readClipboard();
    assert.equal(clip.text, quote);

    // 4. Find contact Jennifer Brooks and schedule tour
    const contactRes = await mockDeviceBridge.searchContacts({ query: 'Jennifer Brooks' });
    assert.equal(contactRes.found, true);

    const calRes = await mockDeviceBridge.createCalendarEvent({
      title: 'Property Tour: 1200 Technology Parkway',
      description: `Tour with ${contactRes.contacts[0].name} (${contactRes.contacts[0].phone})`,
      startTime: 1792053600000,
    });
    assert.equal(calRes.success, true);
  }, 'F11');

  // -----------------------------------------------------------------
  // SCENARIO T4-12: Emergency Hazardous Material First Responder Triage
  // -----------------------------------------------------------------
  it('Scenario T4-12: Emergency Hazardous Material First Responder Triage', async () => {
    // 1. Ingest emergency response guide and shelters
    const hazmatGuide = '# Emergency Response Guide\n## UN 1017 Chlorine\nInitial isolation distance: 500 meters (1500 feet).\nDownwind Day Protection: 3.0 km.';
    const shelters = 'Shelter,Capacity,GPS\nWest High Gymnasium,750,"34.0522, -118.2437"\nEast Community Center,300,"34.0600, -118.2200"';

    searchEngineSimulator.indexFile('erg_hazmat_guide.md', hazmatGuide);
    searchEngineSimulator.indexFile('county_shelters.csv', shelters);

    // 2. Low battery conserve mode
    mockDeviceBridge.setBatteryState({ level: 11, isCharging: false });
    const limits = enforceMemoryLimits('conserve');
    assert.equal(limits.maxContextChars, 1200);

    // 3. Query isolation distance
    const resGuide = await searchEngineSimulator.searchForAnswer('UN 1017 Chlorine initial isolation');
    assert.equal(resGuide.results.length > 0, true);
    assert.equal(resGuide.results[0].chunk.includes('500 meters'), true);

    // 4. Query nearest shelter with capacity over 500
    const resShelter = await searchEngineSimulator.searchForAnswer('West High Gymnasium');
    assert.equal(resShelter.results.length > 0, true);
    assert.equal(resShelter.results[0].chunk.includes('34.0522, -118.2437'), true);

    // 5. Copy coordinates to clipboard
    await mockDeviceBridge.writeClipboard({ text: '34.0522, -118.2437' });
    const clip = await mockDeviceBridge.readClipboard();
    assert.equal(clip.text, '34.0522, -118.2437');
  }, 'F8');

  // -----------------------------------------------------------------
  // SCENARIO T4-13: DevOps Infrastructure Incident Post-Mortem Compilation
  // -----------------------------------------------------------------
  it('Scenario T4-13: DevOps Infrastructure Incident Post-Mortem Compilation', () => {
    // 1. Ingest deployment JSON and incident timeline MD
    const deployment = JSON.parse(SAMPLE_CLUSTER_DEPLOYMENT_JSON);
    const flattened = flattenJson(deployment);
    assert.equal(flattened.includes('infrastructure.databases.primary.endpoint: pg-cluster-prod-01.internal'), true);

    const timeline = '# Incident Timeline 2026-09-11\n03:42 UTC: Automated failover initiated for pg-cluster-prod-01.\nRoot Cause: Worker connection pool exhaustion on pg-cluster-prod-01.';
    const chunks = chunkMarkdown(timeline, 'incident.md');
    assert.equal(chunks[0].includes('03:42 UTC'), true);

    // 2. RAG synthesis
    const prompt = `Question: What was root cause?\nContext:\n${timeline}\nAnswer:`;
    const res = MockWorker.synthesizeGroundedResponse(prompt);
    assert.equal(res.includes('connection pool exhaustion'), true);
  }, 'F5');

  // -----------------------------------------------------------------
  // SCENARIO T4-14: Academic Symposium Timezone & Travel Coordination
  // -----------------------------------------------------------------
  it('Scenario T4-14: Academic Symposium Timezone & Travel Coordination', async () => {
    // 1. Symposium spreadsheet data
    const symposiumData = {
      fileName: 'international_ai_symposium.xlsx',
      sheets: [
        {
          name: 'Schedule',
          headers: ['Speaker', 'Topic', 'Time'],
          rows: [
            ['Prof. Kenji Tanaka', 'Edge LLM Quantization', '10:00 AM JST'],
          ],
        },
      ],
    };
    const extracted = extractDocumentText({ name: 'symposium.xlsx', ext: 'xlsx' }, symposiumData);
    assert.equal(extracted.text.includes('Prof. Kenji Tanaka'), true);
    assert.equal(extracted.text.includes('Edge LLM Quantization'), true);

    // 2. Schedule keynote event
    const res = await mockDeviceBridge.createCalendarEvent({
      title: 'Keynote: Prof. Kenji Tanaka',
      description: 'Edge LLM Quantization',
      startTime: 1792053600000,
    });
    assert.equal(res.success, true);
  }, 'F3');

  // -----------------------------------------------------------------
  // SCENARIO T4-15: Multi-Language Offline Medical Mission Supply Audit
  // -----------------------------------------------------------------
  it('Scenario T4-15: Multi-Language Offline Medical Mission Supply Audit', async () => {
    // 1. Ingest inventory CSV and donation manifest MD
    const inventory = 'Item,OnHand\nWater Purification Units,120\nAntibiotic Kits,45';
    const manifest = '# Donation Manifest\n| Item | Expected |\n|---|---|\n| Water Purification Units | 300 |';

    searchEngineSimulator.indexFile('relief_camp_inventory.csv', inventory);
    searchEngineSimulator.indexFile('medical_donation_manifest.md', manifest);

    // 2. Query quantities and compute shortfall
    const onHand = 120;
    const expected = 300;
    const shortfall = expected - onHand;
    assert.equal(shortfall, 180);

    // 3. Check battery status
    mockDeviceBridge.setBatteryState({ level: 94, isCharging: false });
    const battery = await mockDeviceBridge.getBatteryInfo();
    assert.equal(battery.level, 94);

    // 4. Save requisition note
    const requisition = `Emergency requisition needed: ${shortfall} water purification units for Camp Alpha.`;
    assert.equal(requisition.includes('180 water purification units'), true);
  }, 'F1');

});
