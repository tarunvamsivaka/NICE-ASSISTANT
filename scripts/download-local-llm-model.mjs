#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const MODEL_ROOT = 'https://huggingface.co/Xenova/flan-t5-small/resolve/main/';
const FILES = [
    'config.json',
    'generation_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'special_tokens_map.json',
    'spiece.model',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
];

const DEST_BASE = path.join(root, 'public', 'models', 'Xenova', 'flan-t5-small');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function downloadFile(url, outPath, redirects = 0) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                if (redirects > 8) {
                    reject(new Error(`Too many redirects for ${url}`));
                    return;
                }
                res.resume();
                const redirectUrl = new URL(res.headers.location, url).toString();
                downloadFile(redirectUrl, outPath, redirects + 1).then(resolve).catch(reject);
                return;
            }

            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                res.resume();
                return;
            }

            ensureDir(path.dirname(outPath));
            const tmpPath = `${outPath}.tmp`;
            const file = fs.createWriteStream(tmpPath);
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    fs.renameSync(tmpPath, outPath);
                    resolve();
                });
            });
            file.on('error', (err) => {
                try { file.close(() => {}); } catch {}
                try { fs.rmSync(tmpPath, { force: true }); } catch {}
                reject(err);
            });
        });

        req.on('error', reject);
        req.setTimeout(120000, () => {
            req.destroy(new Error(`Timeout downloading ${url}`));
        });
    });
}

async function downloadWithRetry(url, outPath, attempts = 3) {
    let lastError = null;
    for (let i = 1; i <= attempts; i += 1) {
        try {
            await downloadFile(url, outPath);
            return;
        } catch (error) {
            lastError = error;
            if (i < attempts) {
                await new Promise((r) => setTimeout(r, i * 1000));
            }
        }
    }
    throw lastError;
}

async function main() {
    console.log('Downloading local LLM model assets (Xenova/flan-t5-small)...');
    ensureDir(DEST_BASE);

    for (const rel of FILES) {
        const url = MODEL_ROOT + rel;
        const outPath = path.join(DEST_BASE, rel);
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
            console.log(`- skip ${rel} (already present)`);
            continue;
        }
        console.log(`- fetch ${rel}`);
        await downloadWithRetry(url, outPath, 3);
    }

    console.log('Local LLM model download complete.');
}

main().catch((error) => {
    console.error(`download-local-llm-model: FAIL\n${error?.message || error}`);
    process.exit(1);
});
