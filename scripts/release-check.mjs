#!/usr/bin/env node

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const REQUIRED_MODEL_ASSETS = [
    'public/models/Xenova/all-MiniLM-L6-v2/config.json',
    'public/models/Xenova/all-MiniLM-L6-v2/tokenizer.json',
    'public/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx',
    'public/models/Xenova/whisper-tiny.en/config.json',
    'public/models/Xenova/whisper-tiny.en/tokenizer.json',
    'public/models/Xenova/whisper-tiny.en/onnx/encoder_model_quantized.onnx',
    'public/models/Xenova/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx',
    'public/models/Xenova/flan-t5-small/config.json',
    'public/models/Xenova/flan-t5-small/generation_config.json',
    'public/models/Xenova/flan-t5-small/tokenizer.json',
    'public/models/Xenova/flan-t5-small/tokenizer_config.json',
    'public/models/Xenova/flan-t5-small/special_tokens_map.json',
    'public/models/Xenova/flan-t5-small/spiece.model',
    'public/models/Xenova/flan-t5-small/onnx/encoder_model_quantized.onnx',
    'public/models/Xenova/flan-t5-small/onnx/decoder_model_merged_quantized.onnx',
];

const TEST_COMMANDS = [
    ['Parser test suite', ['node', 'tests/test-all.mjs']],
    ['Policy/runtime hardening tests', ['node', 'tests/policy-runtime.test.mjs']],
    ['Retrieval rerank tests', ['node', 'tests/retrieval-utils.test.mjs']],
    ['Conversation module tests', ['node', 'tests/conversation-responder.test.mjs']],
    ['Search hardening tests', ['node', 'tests/search-engine-hardening.test.mjs']],
    ['Offline brain hardening tests', ['node', 'tests/offline-brain-hardening.test.mjs']],
    ['Next features hardening tests', ['node', 'tests/next-features-hardening.test.mjs']],
    ['Stability forecast tests', ['node', 'tests/stability-forecast.test.mjs']],
    ['Embedding worker lifecycle tests', ['node', 'tests/embedding-client.test.mjs']],
    ['Platform hardening tests', ['node', 'tests/platform-hardening.test.mjs']],
    ['Device automations (M2)', ['node', 'tests/device-automation.test.mjs']],
    ['Document parsers (M1)', ['node', 'tests/document-parsers.test.mjs']],
    ['E2E full regression test suite', ['node', 'tests/e2e/runner.mjs']],
];

function resolveFromRoot(relativePath) {
    return path.resolve(root, relativePath);
}

function fail(message) {
    console.error(`\nrelease-check: FAIL\n${message}`);
    process.exit(1);
}

function checkRequiredAssets() {
    console.log('Checking required local model assets...');
    const missing = [];

    for (const relativePath of REQUIRED_MODEL_ASSETS) {
        const absolutePath = resolveFromRoot(relativePath);
        if (!existsSync(absolutePath)) {
            missing.push(`${relativePath} (missing)`);
            continue;
        }
        const size = statSync(absolutePath).size;
        if (size <= 0) {
            missing.push(`${relativePath} (empty file)`);
        }
    }

    if (missing.length > 0) {
        fail(`Missing required model assets:\n- ${missing.join('\n- ')}`);
    }
    console.log('Model asset check: ok');
}

function runCommand(label, [command, ...args]) {
    console.log(`\n${label}...`);
    const result = spawnSync(command, args, {
        cwd: root,
        stdio: 'inherit',
        shell: false,
    });

    if (result.status !== 0) {
        fail(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
    }
}

function runBuild() {
    runCommand('Production build', ['node', 'node_modules/vite/bin/vite.js', 'build']);
}

function main() {
    console.log('Running Nice v1 release quality gate...');
    checkRequiredAssets();

    for (const [label, cmd] of TEST_COMMANDS) {
        runCommand(label, cmd);
    }

    runBuild();
    console.log('\nrelease-check: PASS');
}

main();
