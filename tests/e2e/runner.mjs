#!/usr/bin/env node
/**
 * Nice Assistant v1.2.0 — Opaque-Box E2E Test Runner
 * Command: node tests/e2e/runner.mjs [--tier=1|2|3|4|all] [--verbose] [--bail] [--filter=regex] [--json]
 */

import { initE2EEnvironment, resetE2EEnvironment } from './harness/env.mjs';

// Parse CLI flags
const args = process.argv.slice(2);
const tierArgMatch = args.find(a => a.startsWith('--tier='));
const selectedTier = tierArgMatch ? tierArgMatch.split('=')[1].toLowerCase() : 'all';
const bail = args.includes('--bail');
const verbose = args.includes('--verbose');
const jsonOutput = args.includes('--json');
const filterArgMatch = args.find(a => a.startsWith('--filter='));
const testFilter = filterArgMatch ? new RegExp(filterArgMatch.split('=')[1], 'i') : null;

// Execution statistics
export const stats = {
  selectedTier,
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  startTime: Date.now(),
  durationMs: 0,
  failures: [],
  featureCounts: new Map(), // 'F1'..'F28' -> count
  tierCounts: { tier1: 0, tier2: 0, tier3: 0, tier4: 0 },
};

// Test queue
const testQueue = [];
let currentSuiteName = '';
const beforeEachHooks = [];
const afterEachHooks = [];

export function describe(name, fn) {
  const prevSuite = currentSuiteName;
  currentSuiteName = prevSuite ? `${prevSuite} > ${name}` : name;
  try {
    fn();
  } finally {
    currentSuiteName = prevSuite;
  }
}

export function it(name, testFn, featureTag = null) {
  testQueue.push({
    suite: currentSuiteName,
    name,
    testFn,
    featureTag,
  });
}

export const test = it;

export function beforeEach(fn) {
  beforeEachHooks.push(fn);
}

export function afterEach(fn) {
  afterEachHooks.push(fn);
}

export async function runTest(name, fn, featureTag = null) {
  stats.total += 1;
  const start = Date.now();
  try {
    for (const hook of beforeEachHooks) await hook();
    await fn();
    for (const hook of afterEachHooks) await hook();
    stats.passed += 1;

    if (featureTag) {
      const tag = featureTag.toUpperCase();
      stats.featureCounts.set(tag, (stats.featureCounts.get(tag) || 0) + 1);
    }

    if (verbose) {
      console.log(`  ✓ PASS: ${name} (${Date.now() - start}ms)`);
    }
  } catch (err) {
    stats.failed += 1;
    stats.failures.push({
      suite: currentSuiteName,
      name,
      featureTag,
      error: err?.message || String(err),
      stack: err?.stack || '',
    });
    console.error(`  ✗ FAIL: ${name}\n    Error: ${err?.message || err}`);
    if (bail) {
      printSummaryAndExit();
    }
  }
}

async function executeQueue() {
  initE2EEnvironment();
  resetE2EEnvironment();

  for (const item of testQueue) {
    const fullName = item.suite ? `[${item.suite}] ${item.name}` : item.name;
    if (testFilter && !testFilter.test(fullName) && (!item.featureTag || !testFilter.test(item.featureTag))) {
      stats.skipped += 1;
      continue;
    }
    await runTest(fullName, item.testFn, item.featureTag);
  }
}

function printSummaryAndExit() {
  stats.durationMs = Date.now() - stats.startTime;

  if (jsonOutput) {
    console.log(JSON.stringify(stats, null, 2));
    process.exit(stats.failed > 0 ? 1 : 0);
    return;
  }

  console.log('\n' + '='.repeat(70));
  console.log(' Nice Assistant v1.2.0 — E2E Test Execution Summary');
  console.log('='.repeat(70));
  console.log(` Selected Tier : ${selectedTier.toUpperCase()}`);
  console.log(` Total Tests   : ${stats.total}`);
  console.log(` Passed        : ${stats.passed}`);
  console.log(` Failed        : ${stats.failed}`);
  console.log(` Skipped       : ${stats.skipped}`);
  console.log(` Duration      : ${(stats.durationMs / 1000).toFixed(2)}s`);
  console.log('-'.repeat(70));

  if (stats.featureCounts.size > 0) {
    console.log(' Feature Verification Coverage:');
    const sortedFeatures = Array.from(stats.featureCounts.entries()).sort((a, b) => {
      const numA = parseInt(a[0].replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b[0].replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

    for (const [feat, count] of sortedFeatures) {
      console.log(`   • [${feat.padEnd(4)}] : ${count} verified tests`);
    }
    console.log('-'.repeat(70));
  }

  if (stats.failed > 0) {
    console.log('\n Failures Detail:');
    stats.failures.forEach((f, idx) => {
      console.log(`\n ${idx + 1}) ${f.name}`);
      console.log(`    Feature: ${f.featureTag || 'N/A'}`);
      console.log(`    Message: ${f.error}`);
      if (f.stack) console.log(`    Stack: ${f.stack}`);
    });
    console.log('\n' + '='.repeat(70));
    console.log(' RESULT: FAILED ❌');
    console.log('='.repeat(70) + '\n');
    process.exit(1);
  } else {
    console.log('\n' + '='.repeat(70));
    console.log(' RESULT: ALL TESTS PASSED ✅');
    console.log('='.repeat(70) + '\n');
    process.exit(0);
  }
}

// Main execution entry point
async function main() {
  console.log(`\nStarting Nice Assistant v1.2.0 E2E Test Suite (Tier: ${selectedTier.toUpperCase()})...\n`);

  try {
    if (selectedTier === '1' || selectedTier === 'all') {
      console.log('Loading Tier 1: Feature Coverage Suite...');
      await import('./tier1-feature-coverage.test.mjs');
    }
    if (selectedTier === '2' || selectedTier === 'all') {
      console.log('Loading Tier 2: Boundary & Corner Cases Suite...');
      await import('./tier2-boundary-corner.test.mjs');
    }
    if (selectedTier === '3' || selectedTier === 'all') {
      console.log('Loading Tier 3: Cross-Feature Interactions Suite...');
      await import('./tier3-cross-feature.test.mjs');
    }
    if (selectedTier === '4' || selectedTier === 'all') {
      console.log('Loading Tier 4: Real-World Application Scenarios Suite...');
      await import('./tier4-application-scenarios.test.mjs');
    }

    console.log(`Executing ${testQueue.length} registered test cases...\n`);
    await executeQueue();
  } catch (err) {
    console.error('Fatal error during test suite execution:', err);
    process.exit(1);
  }

  printSummaryAndExit();
}

// If run directly
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tests/e2e/runner.mjs')) {
  main();
}
