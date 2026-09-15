const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const PORT = 5178;
const HOST = '127.0.0.1';
const AUTO_REINDEX_MS = 10 * 60 * 1000;
const ALLOWED_ORIGINS = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'capacitor://localhost',
    'http://localhost',
]);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.has(origin)) {
            return callback(null, true);
        }
        return callback(new Error('CORS_BLOCKED'));
    },
    methods: ['GET', 'POST'],
    credentials: false,
}));
app.use(express.json({ limit: '256kb' }));

// Standard directories to search
const homedir = os.homedir();
const SEARCH_DIRS = [
    path.join(homedir, 'Documents'),
    path.join(homedir, 'Desktop'),
    path.join(homedir, 'Downloads'),
    path.join(homedir, 'OneDrive', 'Documents'),
    path.join(homedir, 'OneDrive', 'Desktop'),
    path.join(homedir, 'OneDrive', 'Downloads'),
    path.join(homedir, 'OneDrive', '文档'), // Common localized Document folder in OneDrive
    __dirname // The project folder
];

const IGNORE_EXTS = new Set(['.exe', '.dll', '.so', '.dylib', '.png', '.jpg', '.jpeg', '.gif', '.mp3', '.mp4', '.wav', '.zip', '.rar', '.7z', '.tar', '.gz', '.bin', '.iso', '.msi']);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // Increased to 5MB max for PDFs

// ============================================================================
// HIGH PERFORMANCE INVERTED INDEX (Elasticsearch style)
// ============================================================================

// State
let isIndexing = false;
let indexedFileCount = 0;
const fileStore = new Map(); // path -> { id, path, name_tokens, snippet }
const invertedIndex = new Map(); // token -> Set(file_id)

const STOP_WORDS = new Set(['what', 'is', 'the', 'in', 'on', 'at', 'to', 'a', 'an', 'how', 'why', 'where', 'who', 'do', 'does', 'can', 'could', 'would', 'should', 'find', 'search', 'look', 'for', 'of', 'and', 'or', 'it', 'this', 'that']);

// Tokenizer - fast RegEx word split
function tokenize(text) {
    if (!text) return [];
    // Only keep alphanumeric words length 3-20
    const words = text.toLowerCase().split(/[^a-z0-9]+/);
    const tokens = new Set();
    for (const w of words) {
        if (w.length >= 3 && w.length <= 20 && !STOP_WORDS.has(w)) {
            tokens.add(w);
        }
    }
    return Array.from(tokens);
}

// Background asynchronous folder walker
async function walkDir(dir) {
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git') continue;

            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                // Yield to event loop
                await new Promise(r => setImmediate(r));
                await walkDir(fullPath);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                // Instead of only allowing white-listed text extensions, allow EVERYTHING EXCEPT explicit binary/media files
                if (!IGNORE_EXTS.has(ext)) {
                    await indexFile(fullPath, entry.name);
                }
            }
        }
    } catch (e) {
        // Ignore permission/read errors
    }
}

// Index a single file without blocking the event loop
async function indexFile(filePath, fileName) {
    try {
        const stat = await fs.promises.stat(filePath);
        if (stat.size > MAX_FILE_SIZE) return; // Skip huge files

        let content = '';
        const ext = path.extname(fileName).toLowerCase();

        // Binary PDF extraction
        if (ext === '.pdf') {
            const dataBuffer = await fs.promises.readFile(filePath);
            const pdfData = await pdfParse(dataBuffer);
            content = pdfData.text || '';
        } else if (ext === '.docx') {
            const dataBuffer = await fs.promises.readFile(filePath);
            const docxData = await mammoth.extractRawText({ buffer: dataBuffer });
            content = docxData.value || '';
        } else {
            // Read entire file (up to 5MB MAX_FILE_SIZE limit) for complete indexing
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
            for await (const chunk of stream) {
                content += chunk;
                // Failsafe: Stop reading if content gets insanely huge (e.g. minified JS single lines)
                if (content.length > 5 * 1024 * 1024) break;
            }
        }

        const id = indexedFileCount++;

        // Store metadata
        fileStore.set(id, {
            path: filePath,
            name: fileName,
            name_tokens: tokenize(fileName),
            preview: content.substring(0, 300).replace(/\s+/g, ' ') // tiny preview
        });

        // Add to inverted index
        const tokens = tokenize(content + " " + fileName);
        for (const token of tokens) {
            if (!invertedIndex.has(token)) {
                invertedIndex.set(token, new Set());
            }
            invertedIndex.get(token).add(id);
        }

    } catch (e) {
        // Ignore read errors
    }
}

// Start background indexer
async function buildIndex() {
    if (isIndexing) return;
    isIndexing = true;
    const startTime = Date.now();
    console.log('[Indexer] Starting async background scan...');

    fileStore.clear();
    invertedIndex.clear();
    indexedFileCount = 0;

    for (const dir of SEARCH_DIRS) {
        if (fs.existsSync(dir)) {
            await walkDir(dir);
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Indexer] Done! Indexed ${indexedFileCount} files in ${duration}s.`);
    isIndexing = false;
}

// Execute background index immediately on boot
buildIndex();

// Re-index periodically in background to catch file changes without heavy constant disk churn
setInterval(() => {
    buildIndex();
}, AUTO_REINDEX_MS);


// ============================================================================
// SEARCH API
// ============================================================================

app.post('/api/search', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });

    console.log(`[Search API] "${query}"`);
    const queryTokens = tokenize(query);

    if (queryTokens.length === 0) {
        return res.json({ result: 'Please provide more specific keywords.' });
    }

    const t0 = performance.now();

    // 1. Retrieve Candidate Files via Set Intersection/Union
    // We start by finding all files that contain AT LEAST ONE query token
    const candidateMatchTokens = new Map(); // file_id -> Set of query tokens matched

    for (const token of queryTokens) {
        // Find matching tokens in index (exact match or prefix for long words)
        for (const [indexToken, fileSet] of invertedIndex.entries()) {
            if (indexToken === token || (token.length >= 4 && indexToken.startsWith(token))) {
                for (const fileId of fileSet) {
                    if (!candidateMatchTokens.has(fileId)) candidateMatchTokens.set(fileId, new Set());
                    candidateMatchTokens.get(fileId).add(token);
                }
            }
        }
    }

    if (candidateMatchTokens.size === 0) {
        return res.json({ result: null });
    }

    // 2. Score Candidates (BM25-lite)
    const candidates = [];
    for (const [fileId, matchedSet] of candidateMatchTokens.entries()) {
        const fileObj = fileStore.get(fileId);
        if (!fileObj) continue;

        // Base score = total unique tokens matched
        let score = matchedSet.size * 100;

        // Exact filename match tiebreaker
        const nameLower = fileObj.name.toLowerCase();
        for (const token of queryTokens) {
            if (nameLower.includes(token)) score += 5;
        }

        candidates.push({
            id: fileId,
            score: score,
            path: fileObj.path,
            name: fileObj.name,
            preview: fileObj.preview
        });
    }

    // Sort by highest token match, take top 5 to evaluate actual context density
    candidates.sort((a, b) => b.score - a.score);
    const topCandidates = candidates.slice(0, 5);

    const matchedParagraphs = [];

    for (const candidate of topCandidates) {
        try {
            if (!fs.existsSync(candidate.path)) continue;

            let content = '';
            if (candidate.path.toLowerCase().endsWith('.pdf')) {
                const dataBuffer = fs.readFileSync(candidate.path);
                const pdfData = await pdfParse(dataBuffer);
                content = pdfData.text;
            } else if (candidate.path.toLowerCase().endsWith('.docx')) {
                const dataBuffer = fs.readFileSync(candidate.path);
                const docxData = await mammoth.extractRawText({ buffer: dataBuffer });
                content = docxData.value;
            } else {
                content = fs.readFileSync(candidate.path, 'utf8');
            }

            // Split file content strictly into logical paragraphs (using double newlines)
            // or failing that, arbitrary long chunks, but attempting to respect sentence structure.
            let paragraphs = [];
            if (content.length > 50000 && !content.includes('\n')) {
                // Failsafe for monolithic minified files, split by periods
                paragraphs = content.split(/(?<=\.)\s+/);
            } else {
                // Split by two or more newlines to represent a paragraph break
                paragraphs = content.split(/\n\s*\n/);
                // If it's a badly formatted PDF (only single newlines everywhere), fallback
                if (paragraphs.length < 3) {
                    paragraphs = content.split('\n');

                    // Try to re-combine single lines into logical sentences
                    const combined = [];
                    let current = "";
                    for (let p of paragraphs) {
                        current += " " + p.trim();
                        if (current.endsWith('.') || current.endsWith(':') || current.length > 200) {
                            combined.push(current.trim());
                            current = "";
                        }
                    }
                    if (current.length > 0) combined.push(current.trim());
                    paragraphs = combined;
                }
            }

            // Evaluate each paragraph natively
            for (let i = 0; i < paragraphs.length; i++) {
                const paragraphText = paragraphs[i];
                if (paragraphText.length < 15) continue; // Skip tiny headers

                const lowerText = paragraphText.toLowerCase();
                let uniqueTokensInChunk = 0;
                let frequencyScore = 0;

                for (const token of queryTokens) {
                    if (lowerText.includes(token)) {
                        uniqueTokensInChunk++;
                        frequencyScore += lowerText.split(token).length - 1;
                    }
                }

                // Threshold: Only consider paragraphs that contain a significant portion of our intended keywords
                const threshold = Math.max(1, Math.min(queryTokens.length - 1, 3));
                if (uniqueTokensInChunk >= threshold) {
                    const chunkScore = (uniqueTokensInChunk * 100) + frequencyScore;
                    matchedParagraphs.push({
                        path: candidate.path,
                        score: chunkScore,
                        snippet: paragraphText.trim()
                    });
                }
            }
        } catch (e) {
            console.error('[Search API] Warning: could not read snippet from file', e);
        }
    }

    // Fallback if no deep reading worked but we have a filename match
    if (matchedParagraphs.length === 0 && topCandidates.length > 0) {
        matchedParagraphs.push({
            path: topCandidates[0].path,
            score: topCandidates[0].score,
            snippet: topCandidates[0].preview
        });
    }

    // Sort all gathered paragraphs globally by their intrinsic density score
    matchedParagraphs.sort((a, b) => b.score - a.score);

    // De-duplication (limit to top 10 best paragraphs across all files to avoid massive wall-of-text)
    const finalFormattedParagraphs = [];

    for (const match of matchedParagraphs.slice(0, 10)) {
        // Build output string with an embedded hidden path anchor for the Assistant UI to parse
        const fileLine = `📁 **Found in: ${path.basename(match.path)}**\n\n> ${match.snippet}\n\n`;
        const pathLine = `_Location:_ \`${match.path}\`\n\n`;
        const actionLine = `<button class="action-btn" onclick="document.getElementById('commandInput').value='Open file ${path.basename(match.path)}'; document.getElementById('sendBtn').click();">📂 Open File</button>`;
        finalFormattedParagraphs.push(fileLine + pathLine + actionLine);
    }

    let formattedAnswer = finalFormattedParagraphs.length > 0
        ? finalFormattedParagraphs.join('\n\n---\n\n')
        : 'Result not found.';

    res.json({ result: formattedAnswer });
});

// Re-index endpoint
app.post('/api/reindex', (req, res) => {
    buildIndex(); // runs async
    res.json({ success: true, message: "Started background re-index" });
});

// Status endpoint
app.get('/api/status', (req, res) => {
    res.json({
        filesIndexed: indexedFileCount,
        isIndexing: isIndexing,
        ramUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    });
});

process.on('exit', (code) => console.log(`[Process] Exiting with code: ${code}`));
process.on('uncaughtException', (err) => console.error('[Process] Uncaught:', err));

app.use((err, req, res, next) => {
    if (err && err.message === 'CORS_BLOCKED') {
        return res.status(403).json({ error: 'Origin is not allowed to access local offline backend.' });
    }
    return next(err);
});

app.listen(PORT, HOST, () => {
    console.log(`[Nice] Local offline backend started on http://${HOST}:${PORT}`);
});
