#!/usr/bin/env node
/**
 * Nice v1 — Release Gate  
 * Runs before APK/bundle packaging to verify build quality.
 *
 * Checks:
 * 1. Vite production build succeeds (exit 0)
 * 2. No critical import errors in bundled output
 * 3. Required src modules exist
 * 4. policy.js exports the correct API surface
 * 5. No leftover TODO/FIXME/HACK markers in critical files
 *
 * Usage: node scripts/release-gate.mjs
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let failures = 0;

function check(label, condition, detail) {
    if (condition) {
        console.log(`  ✅ ${label}`);
    } else {
        console.error(`  ❌ ${label}: ${detail || 'FAILED'}`);
        failures++;
    }
}

console.log('\n🔒 Nice v1 Release Gate\n');

// ============================
// 1. Required source files
// ============================
console.log('📁 Source modules:');
const requiredFiles = [
    'src/policy.js',
    'src/mic-arbiter.js',
    'src/assistant.js',
    'src/online.js',
    'src/search-engine.js',
    'src/embedding-worker.js',
    'src/main.js',
    'src/wake-word.js',
    'src/filesys.js',
    'src/actions.js',
];

for (const file of requiredFiles) {
    const fullPath = resolve(ROOT, file);
    check(file, existsSync(fullPath), 'File not found');
}

// ============================
// 2. Policy module API surface
// ============================
console.log('\n🔐 Policy API:');
const policyPath = resolve(ROOT, 'src/policy.js');
if (existsSync(policyPath)) {
    const policySrc = readFileSync(policyPath, 'utf-8');
    check('exports isOnlineAllowed', policySrc.includes('export function isOnlineAllowed'));
    check('exports optInToOnline', policySrc.includes('export function optInToOnline'));
    check('exports optOutOfOnline', policySrc.includes('export function optOutOfOnline'));
    check('exports offlineBlockedMessage', policySrc.includes('export function offlineBlockedMessage'));
    check('exports getPolicyState', policySrc.includes('export function getPolicyState'));
    check('offline default = true', policySrc.includes('offlineDefault: true'));
}

// ============================
// 3. No placeholder responses
// ============================
console.log('\n🚫 No placeholder/simulated responses in assistant.js:');
const assistantPath = resolve(ROOT, 'src/assistant.js');
if (existsSync(assistantPath)) {
    const asSrc = readFileSync(assistantPath, 'utf-8');
    check('No simulateFileSearch call', !asSrc.includes('simulateFileSearch('), 'still calling simulateFileSearch');
    check('No "simulated" in responses', !asSrc.includes('"simulated"'), 'found "simulated" text');
    check('Imports policy.js', asSrc.includes("from './policy.js'"), 'missing policy.js import');
    check('Has GO_ONLINE intent', asSrc.includes('GO_ONLINE'), 'missing GO_ONLINE');
    check('Has GO_OFFLINE intent', asSrc.includes('GO_OFFLINE'), 'missing GO_OFFLINE');
}

// ============================
// 4. online.js policy wiring
// ============================
console.log('\n🌐 online.js policy wiring:');
const onlinePath = resolve(ROOT, 'src/online.js');
if (existsSync(onlinePath)) {
    const onSrc = readFileSync(onlinePath, 'utf-8');
    check('Imports policy.js', onSrc.includes("from './policy.js'"), 'missing policy.js import');
    check('Gates searchWeb', onSrc.includes('isOnlineAllowed'), 'searchWeb not gated');
}

// ============================
// 5. No TODO/FIXME in critical files
// ============================
console.log('\n📝 No TODO/FIXME markers:');
const criticalFiles = ['src/policy.js', 'src/assistant.js', 'src/online.js', 'src/mic-arbiter.js'];
for (const file of criticalFiles) {
    const p = resolve(ROOT, file);
    if (existsSync(p)) {
        const src = readFileSync(p, 'utf-8');
        const todos = (src.match(/\bTODO\b|\bFIXME\b|\bHACK\b/gi) || []).length;
        check(`${file}: ${todos} markers`, todos === 0, `Found ${todos} TODO/FIXME/HACK markers`);
    }
}

// ============================
// 6. Vite production build
// ============================
console.log('\n🏗️  Vite build:');
try {
    execSync('npx vite build', { cwd: ROOT, stdio: 'pipe', timeout: 60000 });
    check('vite build exits 0', true);
} catch (e) {
    const stderr = e.stderr?.toString() || '';
    check('vite build exits 0', false, stderr.substring(0, 200));
}

// ============================
// Summary
// ============================
console.log(`\n${'─'.repeat(40)}`);
if (failures === 0) {
    console.log('🎉 All checks passed! Ready for release packaging.\n');
    process.exit(0);
} else {
    console.error(`⚠️  ${failures} check(s) failed. Fix before packaging.\n`);
    process.exit(1);
}
