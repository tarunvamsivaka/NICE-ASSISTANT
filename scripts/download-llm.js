import fs from 'fs';
import path from 'path';
import https from 'https';

const MODEL_ID = 'mlc-ai/SmolLM2-135M-Instruct-q4f16_1-MLC';
const OUT_DIR = path.join(process.cwd(), 'public', 'models', 'SmolLM2-135M-Instruct-q4f16_1-MLC');

const FILES = [
    'mlc-chat-config.json',
    'ndarray-cache.json',
    'params_shard_0.bin',
    'params_shard_1.bin',
    'params_shard_2.bin',
    'tokenizer.json',
    'tokenizer_config.json'
];

import { pipeline } from 'stream/promises';

async function downloadFile(filename) {
    const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${filename}`;
    const outPath = path.join(OUT_DIR, filename);

    if (fs.existsSync(outPath)) {
        console.log(`Skipping ${filename} (already exists)`);
        return;
    }

    console.log(`Downloading ${filename}...`);
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to download ${filename}: ${res.status} ${res.statusText}`);
    }

    const fileStream = fs.createWriteStream(outPath);
    await pipeline(res.body, fileStream);
}

async function main() {
    if (!fs.existsSync(OUT_DIR)) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
    }

    for (const file of FILES) {
        try {
            await downloadFile(file);
        } catch (e) {
            console.error(`Error downloading ${file}:`, e.message);
            // Wait and retry once
            console.log('Retrying...');
            await new Promise(r => setTimeout(r, 2000));
            await downloadFile(file);
        }
    }
    console.log('All model files downloaded successfully!');
}

main().catch(console.error);
