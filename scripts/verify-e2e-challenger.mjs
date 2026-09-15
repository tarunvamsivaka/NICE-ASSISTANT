/**
 * Adversarial Verification Harness for Challenger 1
 * Runs test suites, CLI flag variations, and fault injection to verify genuine test behavior.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const results = [];

function runRunner(args, description) {
  console.log(`\n>>> TEST RUN: ${description}`);
  console.log(`Command: node tests/e2e/runner.mjs ${args.join(' ')}`);
  
  const start = Date.now();
  const res = spawnSync(process.execPath, ['tests/e2e/runner.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });
  const duration = Date.now() - start;

  const passed = res.status === 0;
  console.log(`Exit Code: ${res.status} (Pass: ${passed}) [${duration}ms]`);
  if (res.stdout) {
    const lines = res.stdout.trim().split('\n');
    const summaryLines = lines.slice(-15).join('\n');
    console.log(`Output snippet:\n${summaryLines}`);
  }
  if (res.stderr) {
    console.error(`Stderr snippet:\n${res.stderr.trim()}`);
  }

  const resultRecord = {
    description,
    args: args.join(' '),
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    durationMs: duration,
  };
  results.push(resultRecord);
  return resultRecord;
}

console.log('=== CHALLENGER 1 EMPIRICAL TEST SUITE VERIFICATION ===');

// 1. Run all tiers
runRunner(['--tier=all'], 'Full Suite: All 4 Tiers');

// 2. Run individual tiers
runRunner(['--tier=1'], 'Tier 1: Nominal Feature Coverage');
runRunner(['--tier=2'], 'Tier 2: Boundary & Corner Cases');
runRunner(['--tier=3'], 'Tier 3: Cross-Feature Interactions');
runRunner(['--tier=4'], 'Tier 4: Real-World Application Scenarios');

// 3. Test CLI flags
runRunner(['--tier=all', '--bail'], 'CLI Flag: --bail');
runRunner(['--tier=all', '--verbose'], 'CLI Flag: --verbose');
runRunner(['--tier=all', '--json'], 'CLI Flag: --json');
runRunner(['--tier=all', '--filter=F1'], 'CLI Flag: --filter=F1');

// 4. Adversarial Fault Injection
console.log('\n=== ADVERSARIAL FAULT INJECTION ===');
const tier1File = path.resolve('tests/e2e/tier1-feature-coverage.test.mjs');
const originalContent = fs.readFileSync(tier1File, 'utf-8');

try {
  // Induce assertion failure in Feature 1 test
  console.log('Injecting deliberate assertion failure into Tier 1 (F1)...');
  const faultyContent = originalContent.replace(
    "assert.equal(getFileType('csv'), 'document');",
    "assert.equal(getFileType('csv'), 'deliberate_assertion_failure');"
  );
  fs.writeFileSync(tier1File, faultyContent, 'utf-8');

  // Verify failure is caught
  const faultRun = runRunner(['--tier=1'], 'Fault Injection: Expecting Failure (Exit Code 1)');
  if (faultRun.status === 1 && (faultRun.stdout.includes('FAIL') || faultRun.stderr.includes('FAIL'))) {
    console.log('✅ PASS: Runner correctly caught the induced failure and exited with code 1.');
  } else {
    console.error('❌ FAIL: Runner failed to catch the induced failure!');
  }

  // Also test bail flag with failure
  const bailFaultRun = runRunner(['--tier=1', '--bail'], 'Fault Injection with --bail: Expecting Early Termination (Exit Code 1)');
  if (bailFaultRun.status === 1) {
    console.log('✅ PASS: Runner with --bail correctly terminated on failure.');
  } else {
    console.error('❌ FAIL: Runner with --bail failed to terminate with exit code 1!');
  }

} finally {
  // Always cleanly revert
  console.log('\nCleanly reverting Tier 1 file back to original content...');
  fs.writeFileSync(tier1File, originalContent, 'utf-8');
  console.log('Reverted successfully.');
}

// 5. Verify clean recovery
const postRevertRun = runRunner(['--tier=1'], 'Post-Revert Clean Verification');
if (postRevertRun.status === 0) {
  console.log('✅ PASS: Clean recovery confirmed, Tier 1 exits code 0 with 0 failures.');
} else {
  console.error('❌ FAIL: Post-revert run failed!');
}

console.log('\n=== ALL CHALLENGER 1 VERIFICATION RUNS COMPLETED ===');
