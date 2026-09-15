/**
 * Nice — Zero-Copy On-Device Search Engine v3
 * 
 * Architecture: Streaming file search with BM25-lite scoring.
 * - ZERO file duplication — reads content on-demand from disk
 * - Batched parallel processing — 3 files at a time (15MB peak RAM)
 * - 60-second text cache for follow-up questions (max 5 files)
 * - Smart query understanding: contacts, patterns, definitions, topics
 * - BM25-lite scoring with proximity and coverage bonuses
 * - Works 100% offline on mobile processor
 */

import { getReadableFiles, getIndexedFileCount, autoRescanFromSavedHandle } from './filesys.js';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { embedTextWithWorker, initEmbeddingWorker } from './embedding-client.js';
import {
    hashChunkText,
    buildEmbeddingCacheKey,
    computeBlendedRerankScore,
    compareSearchResults,
    combineSearchResults,
    shouldStopSearchEarly,
    normalizeDisplayPath,
} from './retrieval-utils.js';
import { addTextVector, searchTextVectors, searchImageVectors, addImageVector } from './vector-store.js';
import { embedText as embedClipText, embedImage as embedClipImage, detectImageLabels } from './clip-engine.js';
import { ingestSearchEvidence, getKnowledgeGraphStats } from './knowledge-graph.js';

// ===== LAZY PDF LIBRARY =====
let _pdfjsLib = null;
async function getPdfjs() {
    if (!_pdfjsLib) {
        _pdfjsLib = await import('pdfjs-dist');
        _pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.mjs',
            import.meta.url
        ).toString();
    }
    return _pdfjsLib;
}

// ===== LAZY TESSERACT OCR =====
let _tesseractWorker = null;
async function getTesseractWorker() {
    if (!_tesseractWorker) {
        const Tesseract = await import('tesseract.js');
        _tesseractWorker = await Tesseract.createWorker('eng', 1, {
            workerPath: new URL('/tesseract/worker.min.js', import.meta.url).toString(),
            corePath: new URL('/tesseract/tesseract-core.wasm.js', import.meta.url).toString(),
            // Directory path can be absolute from app root; avoid unresolved build-time URL warning.
            langPath: '/tesseract/',
            cacheMethod: 'none',
        });
    }
    return _tesseractWorker;
}

// ===== LAZY DOCX PARSER =====
let _mammoth = null;
async function getMammoth() {
    if (!_mammoth) {
        _mammoth = await import('mammoth');
    }
    return _mammoth;
}

// ===== CONSTANTS =====
export const PDF_EXTS = new Set(['pdf']);
export const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff']);
export const DOCX_EXTS = new Set(['docx']);
export const XLSX_EXTS = new Set(['xlsx', 'xls']);
export const CODE_EXTENSIONS = new Set([
    'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h',
    'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'sh', 'sql'
]);
export const TEXT_EXTS = new Set([
    'txt', 'md', 'json', 'csv', 'tsv', 'html', 'css', 'js', 'xml', 'py', 'java',
    'c', 'cpp', 'h', 'log', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'env',
    'sh', 'bat', 'rtf', 'doc', 'docx', 'tex', 'rst', 'org', 'ts', 'jsx',
    'tsx', 'sql', 'r', 'rb', 'php', 'swift', 'kt', 'go', 'rs',
    'xls', 'xlsx', 'ppt', 'pptx', 'odt',
]);
const IGNORE_EXTS = new Set([
    'exe', 'dll', 'so', 'dylib', 'gif', 'mp3', 'mp4', 'wav', 'zip',
    'rar', '7z', 'tar', 'gz', 'bin', 'iso', 'msi', 'apk', 'aab',
    'woff', 'woff2', 'ttf', 'eot', 'ico', 'svg',
    'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'ogg', 'flac',
    'm4a', 'aac', 'wma', 'opus',
]);
const MAX_TEXT_FILE_SIZE = 12 * 1024 * 1024;  // 12MB
const MAX_PDF_FILE_SIZE = 40 * 1024 * 1024;   // 40MB
const MAX_IMAGE_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const SEARCH_BATCH_SIZE_NATIVE = 8;
const SEARCH_BATCH_SIZE_DESKTOP = 20;
const FILE_READ_RETRY_ATTEMPTS = 2;
const CONTENT_SCORE_THRESHOLD = 0.35;
const MAX_RESULTS = 10; // Max paragraphs returned
const URI_FETCH_TIMEOUT_MS = 12000;
const PDF_EXTRACT_TIMEOUT_MS = 24000;
const DOCX_EXTRACT_TIMEOUT_MS = 15000;
const OCR_EXTRACT_TIMEOUT_MS = 26000;
const READ_FAILURE_CACHE_TTL = 120000;
const READ_FAILURE_SKIP_THRESHOLD = 2;
const MAX_CONTENT_MATCHES_PER_FILE = 6;
const MAX_CONTENT_CANDIDATES_NATIVE_LOW = 96;
const MAX_CONTENT_CANDIDATES_NATIVE = 160;
const MAX_CONTENT_CANDIDATES_WEB = 320;
const MAX_FILENAME_CANDIDATES_NATIVE_LOW = 64;
const MAX_FILENAME_CANDIDATES_NATIVE = 120;
const MAX_FILENAME_CANDIDATES_WEB = 220;
const MAX_CONCURRENT_SEARCHES_NATIVE_LOW = 1;
const MAX_CONCURRENT_SEARCHES_NATIVE = 2;
const MAX_CONCURRENT_SEARCHES_WEB = 3;
const ANALYSIS_CACHE_TEXT_LIMIT = 220000;

// ===== STOP WORDS =====
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'and',
    'or', 'but', 'not', 'with', 'as', 'by', 'this', 'that', 'from', 'be', 'are',
    'was', 'were', 'been', 'has', 'have', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'its', 'my',
    'your', 'his', 'her', 'our', 'their', 'what', 'which', 'who', 'whom',
    'how', 'when', 'where', 'why', 'i', 'me', 'we', 'you', 'he', 'she', 'they',
    'them', 'am', 'if', 'then', 'than', 'so', 'no', 'yes', 'up', 'out', 'about',
    'tell', 'give', 'find', 'search', 'look', 'show', 'get', 'know', 'please',
    'want', 'need', 'like', 'say', 'said', 'also', 'just', 'any', 'some',
]);

// ===== SYNONYM MAP (lightweight) =====
const SYNONYMS = {
    phone: ['mobile', 'cell', 'telephone', 'contact', 'number'],
    email: ['mail', 'e-mail', 'gmail', 'yahoo', 'outlook'],
    address: ['location', 'residence', 'house', 'home', 'street'],
    schedule: ['timetable', 'class', 'lecture', 'period', 'lesson'],
    summary: ['summarize', 'overview', 'brief', 'abstract'],
    age: ['old', 'years', 'year', 'dob', 'birth', 'birthday', 'born'],
    dob: ['date', 'birth', 'birthday', 'born', 'birthdate'],
};

// ===== LIGHTWEIGHT TEXT CACHE =====
// Caches {key → {text, ts, bytes}} to avoid re-reading files across follow-up questions.
const _textCache = new Map();
let _textCacheBytes = 0;
const CACHE_TTL = 300000; // 5 min
const CACHE_MAX_NATIVE_LOW = 12;
const CACHE_MAX_NATIVE = 20;
const CACHE_MAX_WEB = 40;
const CACHE_MAX_BYTES_NATIVE_LOW = 12 * 1024 * 1024;
const CACHE_MAX_BYTES_NATIVE = 20 * 1024 * 1024;
const CACHE_MAX_BYTES_WEB = 40 * 1024 * 1024;
const CACHE_MAX_ENTRY_BYTES = 2 * 1024 * 1024;

// ===== QUERY RESULT CACHE =====
// Caches full search results for identical queries
const _queryCache = new Map();
const _entryVersionCache = new Map();
const _learningProfiles = new Map();
const _textAnalysisCache = new Map();
const _readFailureCache = new Map();
const ANALYSIS_CACHE_MAX_NATIVE_LOW = 8;
const ANALYSIS_CACHE_MAX_NATIVE = 14;
const ANALYSIS_CACHE_MAX_WEB = 28;
const ENTRY_VERSION_CACHE_TTL = 600000;
const QUERY_CACHE_TTL = 300000;
const QUERY_CACHE_MAX_NATIVE_LOW = 4;
const QUERY_CACHE_MAX_NATIVE = 8;
const QUERY_CACHE_MAX_WEB = 20;
const LEARNING_PROFILE_CACHE_MAX_NATIVE_LOW = 160;
const LEARNING_PROFILE_CACHE_MAX_NATIVE = 320;
const LEARNING_PROFILE_CACHE_MAX_WEB = 1200;
const ENTRY_VERSION_CACHE_MAX_NATIVE_LOW = 280;
const ENTRY_VERSION_CACHE_MAX_NATIVE = 640;
const ENTRY_VERSION_CACHE_MAX_WEB = 2400;
const READ_FAILURE_CACHE_MAX_NATIVE_LOW = 180;
const READ_FAILURE_CACHE_MAX_NATIVE = 360;
const READ_FAILURE_CACHE_MAX_WEB = 700;
const INDEX_UPDATED_EVENT = 'nice:index-updated';
let _ocrTaskChain = Promise.resolve();

// ===== PERSISTENT CONTENT CACHE (IndexedDB) =====
// Stores extracted file text so repeated searches avoid expensive re-reads/OCR/PDF parsing.
const CONTENT_CACHE_DB = 'nice_search_content_cache';
const CONTENT_CACHE_STORE = 'file_text_cache';
const CONTENT_CACHE_DB_VERSION = 1;
const CONTENT_CACHE_MAX_RECORDS_NATIVE_LOW = 220;
const CONTENT_CACHE_MAX_RECORDS_NATIVE = 360;
const CONTENT_CACHE_MAX_RECORDS_WEB = 900;
const CONTENT_CACHE_MAX_BYTES_NATIVE_LOW = 32 * 1024 * 1024;
const CONTENT_CACHE_MAX_BYTES_NATIVE = 64 * 1024 * 1024;
const CONTENT_CACHE_MAX_BYTES_WEB = 160 * 1024 * 1024;
const CONTENT_CACHE_PRUNE_EVERY_WRITES = 18;
const CONTENT_CACHE_MAX_ENTRY_BYTES = 2 * 1024 * 1024;
let _contentCacheDb = null;
let _contentCacheWriteCount = 0;

function getPersistentContentCacheLimits() {
    if (Capacitor.isNativePlatform()) {
        if (isLowRamDevice()) {
            return {
                maxRecords: CONTENT_CACHE_MAX_RECORDS_NATIVE_LOW,
                maxBytes: CONTENT_CACHE_MAX_BYTES_NATIVE_LOW,
            };
        }
        return {
            maxRecords: CONTENT_CACHE_MAX_RECORDS_NATIVE,
            maxBytes: CONTENT_CACHE_MAX_BYTES_NATIVE,
        };
    }
    return {
        maxRecords: CONTENT_CACHE_MAX_RECORDS_WEB,
        maxBytes: CONTENT_CACHE_MAX_BYTES_WEB,
    };
}

function getCurrentScanEpoch() {
    try {
        if (typeof localStorage === 'undefined') return '0';
        return String(localStorage.getItem('nice_last_scan_ts') || '0');
    } catch {
        return '0';
    }
}

function buildPersistentContentCacheKey(entry) {
    return `${getFileCacheToken(entry)}|${getCurrentScanEpoch()}`;
}

async function openContentCacheDb() {
    if (_contentCacheDb) return _contentCacheDb;
    _contentCacheDb = await new Promise((resolve, reject) => {
        const req = indexedDB.open(CONTENT_CACHE_DB, CONTENT_CACHE_DB_VERSION);
        req.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CONTENT_CACHE_STORE)) {
                db.createObjectStore(CONTENT_CACHE_STORE, { keyPath: 'cacheKey' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return _contentCacheDb;
}

async function getPersistedFileText(cacheKey) {
    if (!cacheKey) return null;
    try {
        const db = await openContentCacheDb();
        return await new Promise((resolve) => {
            const tx = db.transaction(CONTENT_CACHE_STORE, 'readonly');
            const req = tx.objectStore(CONTENT_CACHE_STORE).get(cacheKey);
            req.onsuccess = () => {
                const text = req.result?.text;
                resolve((typeof text === 'string' && text.length > 0) ? text : null);
            };
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

async function prunePersistedContentCache() {
    try {
        const db = await openContentCacheDb();
        const records = await new Promise((resolve) => {
            const tx = db.transaction(CONTENT_CACHE_STORE, 'readonly');
            const req = tx.objectStore(CONTENT_CACHE_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });

        if (!records.length) return;

        const limits = getPersistentContentCacheLimits();
        const currentEpoch = getCurrentScanEpoch();
        const sorted = [...records].sort((a, b) => Number(b?.ts || 0) - Number(a?.ts || 0));

        let kept = 0;
        let keptBytes = 0;
        const toDelete = [];

        for (const record of sorted) {
            const recordEpoch = String(record?.scanEpoch || '0');
            const recordBytes = Math.max(0, Number(record?.bytes || 0));

            const keep = recordEpoch === currentEpoch
                && kept < limits.maxRecords
                && (keptBytes + recordBytes) <= limits.maxBytes;

            if (keep) {
                kept += 1;
                keptBytes += recordBytes;
            } else if (record?.cacheKey) {
                toDelete.push(record.cacheKey);
            }
        }

        if (!toDelete.length) return;
        await new Promise((resolve) => {
            const tx = db.transaction(CONTENT_CACHE_STORE, 'readwrite');
            const store = tx.objectStore(CONTENT_CACHE_STORE);
            for (const cacheKey of toDelete) {
                store.delete(cacheKey);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch {
        // Best-effort maintenance only.
    }
}

async function setPersistedFileText(cacheKey, text) {
    if (!cacheKey || typeof text !== 'string' || text.trim().length === 0) return;

    const bytes = estimateTextBytes(text);
    if (bytes > CONTENT_CACHE_MAX_ENTRY_BYTES) return;

    try {
        const db = await openContentCacheDb();
        await new Promise((resolve) => {
            const tx = db.transaction(CONTENT_CACHE_STORE, 'readwrite');
            tx.objectStore(CONTENT_CACHE_STORE).put({
                cacheKey,
                text,
                bytes,
                ts: Date.now(),
                scanEpoch: getCurrentScanEpoch(),
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });

        _contentCacheWriteCount += 1;
        if ((_contentCacheWriteCount % CONTENT_CACHE_PRUNE_EVERY_WRITES) === 0) {
            void prunePersistedContentCache();
        }
    } catch {
        // Persistent cache writes are best-effort only.
    }
}

async function clearPersistedContentCache() {
    try {
        const db = await openContentCacheDb();
        await new Promise((resolve) => {
            const tx = db.transaction(CONTENT_CACHE_STORE, 'readwrite');
            tx.objectStore(CONTENT_CACHE_STORE).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch {
        // Ignore cache clear failures.
    }
}

// ===== EMBEDDING CACHE (IndexedDB) =====
const EMBEDDING_DB = 'nice_search_embeddings';
const EMBEDDING_STORE = 'chunk_embeddings';
const EMBEDDING_DB_VERSION = 1;
let _embeddingDb = null;

async function openEmbeddingDb() {
    if (_embeddingDb) return _embeddingDb;
    _embeddingDb = await new Promise((resolve, reject) => {
        const req = indexedDB.open(EMBEDDING_DB, EMBEDDING_DB_VERSION);
        req.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(EMBEDDING_STORE)) {
                db.createObjectStore(EMBEDDING_STORE, { keyPath: 'cacheKey' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return _embeddingDb;
}

async function getCachedChunkEmbedding(cacheKey) {
    try {
        const db = await openEmbeddingDb();
        return await new Promise((resolve) => {
            const tx = db.transaction(EMBEDDING_STORE, 'readonly');
            const req = tx.objectStore(EMBEDDING_STORE).get(cacheKey);
            req.onsuccess = () => resolve(req.result?.vector || null);
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

async function setCachedChunkEmbedding(cacheKey, vector) {
    try {
        const db = await openEmbeddingDb();
        await new Promise((resolve) => {
            const tx = db.transaction(EMBEDDING_STORE, 'readwrite');
            tx.objectStore(EMBEDDING_STORE).put({
                cacheKey,
                vector,
                ts: Date.now(),
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch {
        // Cache writes are best-effort only.
    }
}

function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

function resultIdentity(result) {
    return `${result.fileId || ''}|${result.fileName}|${result.path}|${result.chunkIndex || 0}|${hashChunkText(result.paragraph || '')}`;
}

function getFileIdentity(entry) {
    return entry.id || `${entry.path || ''}/${entry.name || ''}`;
}

function buildLearningProfileFromText(text) {
    const tokens = tokenize((text || '').substring(0, 12000)).filter(t => t.length > 2);
    if (tokens.length === 0) {
        return { keywords: [] };
    }

    const freq = new Map();
    for (const token of tokens) {
        freq.set(token, (freq.get(token) || 0) + 1);
    }

    const keywords = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 14)
        .map(([word]) => word);

    return { keywords };
}

function rememberFileLearningProfile(entry, fileVersion, text) {
    if (!text || text.trim().length < 10) return;
    const fileId = getFileIdentity(entry);
    const existing = _learningProfiles.get(fileId);
    if (existing?.version === fileVersion) return;

    const profile = buildLearningProfileFromText(text);
    if (_learningProfiles.has(fileId)) {
        _learningProfiles.delete(fileId);
    }
    _learningProfiles.set(fileId, {
        version: fileVersion,
        keywords: profile.keywords,
    });
    pruneMapToLimit(_learningProfiles, getAdaptiveCacheCaps().learningProfileMax);
}

function isLowRamDevice() {
    const memory = typeof navigator !== 'undefined' ? Number(navigator.deviceMemory) : NaN;
    const cores = typeof navigator !== 'undefined' ? Number(navigator.hardwareConcurrency) : NaN;
    return (Number.isFinite(memory) && memory > 0 && memory <= 4)
        || (Number.isFinite(cores) && cores > 0 && cores <= 4);
}

function getTextCacheLimits() {
    if (Capacitor.isNativePlatform()) {
        if (isLowRamDevice()) {
            return {
                maxEntries: CACHE_MAX_NATIVE_LOW,
                maxBytes: CACHE_MAX_BYTES_NATIVE_LOW,
            };
        }
        return {
            maxEntries: CACHE_MAX_NATIVE,
            maxBytes: CACHE_MAX_BYTES_NATIVE,
        };
    }

    return {
        maxEntries: CACHE_MAX_WEB,
        maxBytes: CACHE_MAX_BYTES_WEB,
    };
}

function getAdaptiveCacheCaps() {
    if (Capacitor.isNativePlatform()) {
        if (isLowRamDevice()) {
            return {
                analysisCacheMax: ANALYSIS_CACHE_MAX_NATIVE_LOW,
                queryCacheMax: QUERY_CACHE_MAX_NATIVE_LOW,
                learningProfileMax: LEARNING_PROFILE_CACHE_MAX_NATIVE_LOW,
                entryVersionMax: ENTRY_VERSION_CACHE_MAX_NATIVE_LOW,
                readFailureMax: READ_FAILURE_CACHE_MAX_NATIVE_LOW,
            };
        }
        return {
            analysisCacheMax: ANALYSIS_CACHE_MAX_NATIVE,
            queryCacheMax: QUERY_CACHE_MAX_NATIVE,
            learningProfileMax: LEARNING_PROFILE_CACHE_MAX_NATIVE,
            entryVersionMax: ENTRY_VERSION_CACHE_MAX_NATIVE,
            readFailureMax: READ_FAILURE_CACHE_MAX_NATIVE,
        };
    }

    return {
        analysisCacheMax: ANALYSIS_CACHE_MAX_WEB,
        queryCacheMax: QUERY_CACHE_MAX_WEB,
        learningProfileMax: LEARNING_PROFILE_CACHE_MAX_WEB,
        entryVersionMax: ENTRY_VERSION_CACHE_MAX_WEB,
        readFailureMax: READ_FAILURE_CACHE_MAX_WEB,
    };
}

function pruneMapToLimit(map, maxEntries) {
    const limit = Math.max(1, Number(maxEntries) || 1);
    while (map.size > limit) {
        const oldest = map.keys().next().value;
        if (!oldest) break;
        map.delete(oldest);
    }
}

function estimateTextBytes(text) {
    return Math.max(0, String(text || '').length * 2);
}

function deleteCachedTextEntry(key, entry) {
    _textCache.delete(key);
    _textCacheBytes = Math.max(0, _textCacheBytes - Number(entry?.bytes || 0));
}

function touchCachedText(key, entry) {
    _textCache.delete(key);
    _textCache.set(key, entry);
}

function getCachedText(key) {
    const entry = _textCache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.ts < CACHE_TTL) {
        entry.ts = Date.now();
        touchCachedText(key, entry);
        return entry.text;
    }

    deleteCachedTextEntry(key, entry);
    return null;
}

function setCachedText(key, text) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return;

    const bytes = estimateTextBytes(text);
    if (bytes > CACHE_MAX_ENTRY_BYTES) return;

    const existing = _textCache.get(key);
    if (existing) {
        deleteCachedTextEntry(key, existing);
    }

    const limits = getTextCacheLimits();
    _textCache.set(key, { text, ts: Date.now(), bytes });
    _textCacheBytes += bytes;

    while (_textCache.size > limits.maxEntries || _textCacheBytes > limits.maxBytes) {
        const oldest = _textCache.keys().next().value;
        if (!oldest) break;
        deleteCachedTextEntry(oldest, _textCache.get(oldest));
    }
}

function buildContentVersion(text, entry) {
    const fileKey = getFileIdentity(entry);
    if (!text || text.trim().length === 0) {
        return getCachedEntryVersion(fileKey) || '0';
    }

    const normalized = String(text);
    const head = normalized.substring(0, 768);
    const tail = normalized.substring(Math.max(0, normalized.length - 768));
    const version = `${normalized.length}:${hashChunkText(`${head}|${tail}`)}`;
    setCachedEntryVersion(fileKey, version);
    return version;
}

function getTextAnalysisCacheKey(entry, fileVersion, text) {
    const fileKey = getFileIdentity(entry);
    if (fileVersion && fileVersion !== '0') return `${fileKey}|${fileVersion}`;
    const normalized = String(text || '');
    return `${fileKey}|${normalized.length}:${hashChunkText(normalized.substring(0, 512))}`;
}

function getCachedTextAnalysis(entry, text, fileVersion) {
    if (!text) return null;

    const normalized = String(text);
    // Avoid caching very large analysis payloads that can pressure low-memory devices.
    if (normalized.length > ANALYSIS_CACHE_TEXT_LIMIT) {
        return {
            lowerText: normalized.toLowerCase(),
            paragraphs: splitIntoParagraphs(normalized, entry?.ext, entry?.name),
        };
    }

    const cacheKey = getTextAnalysisCacheKey(entry, fileVersion, text);
    const existing = _textAnalysisCache.get(cacheKey);
    if (existing) {
        // LRU touch.
        _textAnalysisCache.delete(cacheKey);
        _textAnalysisCache.set(cacheKey, existing);
        return existing;
    }

    const analysis = {
        lowerText: normalized.toLowerCase(),
        paragraphs: splitIntoParagraphs(normalized, entry?.ext, entry?.name),
    };
    _textAnalysisCache.set(cacheKey, analysis);

    while (_textAnalysisCache.size > getAdaptiveCacheCaps().analysisCacheMax) {
        const oldest = _textAnalysisCache.keys().next().value;
        if (!oldest) break;
        _textAnalysisCache.delete(oldest);
    }

    return analysis;
}

function getCachedEntryVersion(key) {
    const cached = _entryVersionCache.get(key);
    if (!cached) return null;

    // Backward compatibility if an old build stored plain strings.
    if (typeof cached === 'string') {
        _entryVersionCache.set(key, { version: cached, ts: Date.now() });
        return cached;
    }

    if (Date.now() - cached.ts < ENTRY_VERSION_CACHE_TTL) {
        return cached.version;
    }

    _entryVersionCache.delete(key);
    return null;
}

function setCachedEntryVersion(key, version) {
    if (_entryVersionCache.has(key)) {
        _entryVersionCache.delete(key);
    }
    _entryVersionCache.set(key, {
        version: String(version || '0'),
        ts: Date.now(),
    });
    pruneMapToLimit(_entryVersionCache, getAdaptiveCacheCaps().entryVersionMax);
}

function getFileCacheToken(entry) {
    return entry.id || `${entry.path || ''}/${entry.name || ''}`;
}

function buildIndexSignature(files) {
    if (!files || files.length === 0) return '0|none|none';

    const lastScan = (typeof localStorage !== 'undefined' && localStorage.getItem('nice_last_scan')) || 'none';
    const sampleCount = Math.min(files.length, 64);
    const step = Math.max(1, Math.floor(files.length / sampleCount));
    const sampledTokens = [];

    for (let i = 0; i < files.length && sampledTokens.length < sampleCount; i += step) {
        sampledTokens.push(getFileCacheToken(files[i]));
    }

    if (sampledTokens[sampledTokens.length - 1] !== getFileCacheToken(files[files.length - 1])) {
        sampledTokens.push(getFileCacheToken(files[files.length - 1]));
    }

    return `${files.length}|${lastScan}|${hashChunkText(sampledTokens.join('|'))}`;
}

function buildQueryCacheKey({ query, normalizedOpts, indexSignature }) {
    const queryType = query?.type || 'TOPIC';
    const queryOperation = query?.operation || 'answer';
    const queryTarget = String(query?.target || '').trim().toLowerCase();
    const keywords = [...new Set(query?.keywords || [])].sort().join('|');

    return [
        normalizedOpts.useEmbeddingsRerank ? 'rerank' : 'bm25',
        normalizedOpts.includeFilenameFallback,
        normalizedOpts.forceFullScan ? 'full' : 'early',
        queryType,
        queryOperation,
        queryTarget,
        keywords,
        indexSignature,
    ].join('|');
}

// ===== CONVERSATION CONTEXT =====
const _contextHistory = [];
const MAX_CONTEXT = 3;

function addToContext(question, keywords) {
    _contextHistory.push({ question, keywords, ts: Date.now() });
    if (_contextHistory.length > MAX_CONTEXT) _contextHistory.shift();
}

function getLastContext() {
    return _contextHistory.length > 0 ? _contextHistory[_contextHistory.length - 1] : null;
}

// ===================================================================
// 1. TOKENIZER — Fast, reusable across query + document
// ===================================================================

function tokenize(text) {
    return text.toLowerCase()
        .replace(/[^a-z0-9@.+\-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

function extractKeywords(text) {
    return String(text || '')
        .replace(/[^\w\s@.+\-]/g, ' ')
        .split(/\s+/)
        .map(token => token.trim())
        .filter(token => {
            if (!token) return false;
            if (STOP_WORDS.has(token.toLowerCase())) return false;
            if (token.length > 2) return true;
            // Keep short but important tokens like "AI", "HR", "UPI", "2FA", "Q1".
            return /[A-Z]/.test(token) || /\d/.test(token);
        })
        .map(token => token.toLowerCase());
}

function isSearchSignalToken(token) {
    const value = String(token || '').trim();
    if (!value) return false;
    if (/\d/.test(value)) return true;
    return value.length > 1;
}

function escapeRegExp(value) {
    return String(value || '').replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function countKeywordHits(lowerText, keyword) {
    const kw = String(keyword || '').toLowerCase().trim();
    if (!isSearchSignalToken(kw)) return 0;

    const escaped = escapeRegExp(kw);
    const exactRegex = new RegExp('\\b' + escaped + '\\b', 'g');
    const exactMatches = lowerText.match(exactRegex);
    if (exactMatches && exactMatches.length > 0) {
        return exactMatches.length;
    }

    // Allow substring fallback only for long tokens to avoid noisy partial matches.
    if (kw.length >= 6) {
        let hits = 0;
        let idx = 0;
        while ((idx = lowerText.indexOf(kw, idx)) !== -1) {
            hits += 1;
            idx += kw.length;
        }
        return hits;
    }

    return 0;
}

function getPreparedKeywordMeta(query = {}) {
    if (Array.isArray(query._keywordMeta)) return query._keywordMeta;

    const keywordPool = normalizeKeywordVariants(query.keywords || []).filter(isSearchSignalToken);
    const uniq = [...new Set(keywordPool)];
    const prepared = uniq.map((kw) => ({
        token: kw,
        regex: new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'g'),
        allowSubstring: kw.length >= 6,
    }));

    query._keywordMeta = prepared;
    return prepared;
}

function countKeywordHitsPrepared(lowerText, meta) {
    if (!lowerText || !meta) return 0;
    meta.regex.lastIndex = 0;
    const exactMatches = lowerText.match(meta.regex);
    if (exactMatches && exactMatches.length > 0) {
        return exactMatches.length;
    }

    if (meta.allowSubstring) {
        let hits = 0;
        let idx = 0;
        while ((idx = lowerText.indexOf(meta.token, idx)) !== -1) {
            hits += 1;
            idx += meta.token.length;
        }
        return hits;
    }

    return 0;
}

function countMatchedQueryKeywords(text, keywords = []) {
    const lowerText = String(text || '').toLowerCase();
    if (!lowerText) return 0;

    let matched = 0;
    for (const kw of keywords) {
        if (countKeywordHits(lowerText, kw) > 0) matched += 1;
    }
    return matched;
}

function hasStrongQuerySignal(text, query = {}) {
    const source = String(text || '');
    if (!source.trim()) return false;
    const sourceLower = source.toLowerCase();

    if (query?.type === 'AGE_LOOKUP' || query?.type === 'DOB_LOOKUP') {
        if (AGE_INLINE_PATTERN.test(source)) return true;
        if (DOB_SIGNAL_PATTERN.test(source) && DATE_PATTERN.test(source)) return true;
    }

    const keywordPool = [...new Set(normalizeKeywordVariants(query.keywords || []).filter(isSearchSignalToken))];
    const targetPhrase = String(query.target || query.raw || '').toLowerCase().trim();
    if (targetPhrase.length >= 4 && sourceLower.includes(targetPhrase)) {
        return true;
    }

    const strictPool = [...new Set(
        extractKeywords(query.target || query.raw || '')
            .map(kw => kw.toLowerCase().trim())
            .filter(isSearchSignalToken),
    )];
    const fallbackPool = strictPool.length > 0
        ? strictPool
        : (keywordPool.length > 0 ? keywordPool : extractKeywords(query.target || query.raw || ''));

    if (fallbackPool.length === 0) {
        return source.trim().length > 0;
    }

    const matched = countMatchedQueryKeywords(source, fallbackPool);
    let minimumHits = 1;
    if (fallbackPool.length >= 5) minimumHits = 3;
    else if (fallbackPool.length >= 3) minimumHits = 2;
    minimumHits = Math.min(minimumHits, fallbackPool.length);
    return matched >= minimumHits;
}
function normalizeKeywordVariants(keywords) {
    const expanded = new Set();
    for (const kw of keywords || []) {
        const token = String(kw || '').toLowerCase().trim();
        if (!isSearchSignalToken(token)) continue;
        expanded.add(token);
        if (token.endsWith('ies') && token.length > 3) expanded.add(`${token.slice(0, -3)}y`);
        if (token.endsWith('es') && token.length > 3) expanded.add(token.slice(0, -2));
        if (token.endsWith('s') && token.length > 3) expanded.add(token.slice(0, -1));
        if (token.endsWith('ed') && token.length > 4) expanded.add(token.slice(0, -2));
        if (token.endsWith('ing') && token.length > 5) expanded.add(token.slice(0, -3));
    }
    return [...expanded];
}

/** Expand keywords with synonyms for broader matching */
function expandWithSynonyms(keywords) {
    const expanded = new Set(normalizeKeywordVariants(keywords));
    for (const kw of keywords) {
        if (SYNONYMS[kw]) {
            for (const syn of SYNONYMS[kw]) expanded.add(syn);
        }
        // Also check if kw is a synonym of something
        for (const [root, syns] of Object.entries(SYNONYMS)) {
            if (syns.includes(kw)) expanded.add(root);
        }
    }
    return [...expanded];
}

function detectQuestionOperation(question) {
    const q = (question || '').toLowerCase();
    if (/\b(total|sum|overall|combined|in total)\b/.test(q)) return 'total';
    if (/how\s+many|number\s+of|\bcount\b/.test(q)) return 'count';
    if (/\b(list|show all|which|what are)\b/.test(q)) return 'list';
    if (/\b(compare|difference|versus|vs)\b/.test(q)) return 'compare';
    if (/\b(summary|summarize|overview|brief)\b/.test(q)) return 'summary';
    if (/how\s+to|\bsteps?\b|\bprocedure\b|\binstructions?\b/.test(q)) return 'procedure';
    if (/^who\b/.test(q)) return 'person';
    if (/^when\b/.test(q)) return 'time';
    if (/^where\b/.test(q)) return 'location';
    if (/^why\b/.test(q)) return 'reason';
    if (/^what\s+(is|are)\b/.test(q)) return 'definition';
    return 'answer';
}

function normalizeQuestionText(question) {
    return String(question || '')
        .replace(/^(please|could you|can you|would you|kindly)\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeSubjectText(text) {
    return String(text || '')
        .replace(/[?.,!]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// ===================================================================
// 2. QUERY PARSER — Understand user intent
// ===================================================================

function parseQuery(question) {
    const normalizedQuestion = normalizeQuestionText(question);
    const q = normalizedQuestion.toLowerCase().trim();
    const operation = detectQuestionOperation(normalizedQuestion);

    // --- Age/DOB queries ---
    if (/\b(?:how\s+old\s+am\s+i|what(?:'s| is)\s+my\s+(?:current\s+)?age|my\s+(?:current\s+)?age)\b/i.test(q)) {
        return {
            type: 'AGE_LOOKUP',
            target: 'my current age',
            subject: 'me',
            subjectIsSelf: true,
            keywords: expandWithSynonyms(['age', 'dob', 'birth', 'birthday', 'born']),
            operation: 'answer',
            raw: normalizedQuestion,
        };
    }

    if (/\b(?:what(?:'s| is)\s+my\s+(?:date\s+of\s+birth|dob|birthday)|when\s+was\s+i\s+born|my\s+(?:date\s+of\s+birth|dob|birthday))\b/i.test(q)) {
        return {
            type: 'DOB_LOOKUP',
            target: 'my date of birth',
            subject: 'me',
            subjectIsSelf: true,
            keywords: expandWithSynonyms(['dob', 'date', 'birth', 'birthday', 'born']),
            operation: 'answer',
            raw: normalizedQuestion,
        };
    }

    const howOldMatch = q.match(/\bhow\s+old\s+is\s+(.+?)(?:\?|$)/i)
        || q.match(/\bage\s+of\s+(.+?)(?:\?|$)/i);
    if (howOldMatch) {
        const subject = normalizeSubjectText(howOldMatch[1]);
        const subjectTokens = extractKeywords(subject);
        return {
            type: 'AGE_LOOKUP',
            target: 'age of ' + (subject || 'person'),
            subject: subject || 'person',
            subjectIsSelf: false,
            keywords: expandWithSynonyms([...subjectTokens, 'age', 'dob', 'birth', 'born']),
            operation: 'answer',
            raw: normalizedQuestion,
        };
    }

    const dobSubjectMatch = q.match(/\bwhen\s+was\s+(.+?)\s+born(?:\?|$)/i)
        || q.match(/\b(?:dob|date\s+of\s+birth|birthday)\s+(?:of|for)\s+(.+?)(?:\?|$)/i);
    if (dobSubjectMatch) {
        const subject = normalizeSubjectText(dobSubjectMatch[1]);
        const subjectTokens = extractKeywords(subject);
        return {
            type: 'DOB_LOOKUP',
            target: 'date of birth of ' + (subject || 'person'),
            subject: subject || 'person',
            subjectIsSelf: false,
            keywords: expandWithSynonyms([...subjectTokens, 'dob', 'date', 'birth', 'birthday', 'born']),
            operation: 'answer',
            raw: normalizedQuestion,
        };
    }

    // --- Contact/Person queries ---
    const contactMatch = q.match(
        /(?:what(?:'s| is)|find|get|show|give|tell)\s+(?:me\s+)?(.+?)(?:'s|'s)?\s*(?:phone|mobile|cell|number|email|mail|address|contact)/i
    ) || q.match(
        /(?:phone|mobile|email|contact|address|number)\s+(?:of|for)\s+(.+)/i
    ) || q.match(
        /(.+?)(?:'s|'s)\s+(?:phone|mobile|cell|number|email|mail|address|contact)/i
    );
    if (contactMatch) {
        const person = contactMatch[1].trim().replace(/^(the|my|a)\s+/i, '');
        return {
            type: 'CONTACT', target: person,
            keywords: expandWithSynonyms([...person.split(/\s+/).filter(w => w.length > 1), 'phone', 'email', 'contact']),
            patterns: [
                /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/g,
                /[\w.+-]+@[\w-]+\.[\w.]+/g,
            ],
            operation,
            raw: normalizedQuestion,
        };
    }

    // --- ID patterns (Aadhaar, PAN, etc.) ---
    if (/aadhaar|aadhar|uid/i.test(q)) {
        return {
            type: 'PATTERN', target: 'Aadhaar', keywords: ['aadhaar', 'aadhar', 'uid'],
            patterns: [/\b\d{4}\s?\d{4}\s?\d{4}\b/g], operation, raw: normalizedQuestion
        };
    }
    if (/\bpan\b.*(?:number|card)/i.test(q) || /(?:number|card).*\bpan\b/i.test(q)) {
        return {
            type: 'PATTERN', target: 'PAN', keywords: ['pan'],
            patterns: [/\b[A-Z]{5}\d{4}[A-Z]\b/gi], operation, raw: normalizedQuestion
        };
    }

    // --- Schedule queries ---
    const dayWords = /today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next/i;
    if (/timetable|schedule|class|lecture|period/i.test(q) && dayWords.test(q)) {
        return { type: 'SCHEDULE', target: 'schedule', keywords: expandWithSynonyms(extractKeywords(q)), operation, raw: normalizedQuestion };
    }

    // --- Definition / "what is" queries ---
    const whatIsMatch = q.match(/(?:what\s+(?:is|are)|define|meaning\s+of)\s+(.+)/i);
    if (whatIsMatch) {
        const term = whatIsMatch[1].replace(/\?$/, '').trim();
        return {
            type: 'DEFINITION', target: term,
            keywords: expandWithSynonyms(extractKeywords(term)), operation: 'definition', raw: normalizedQuestion
        };
    }

    // --- General topic / keyword queries ---
    const topicMatch = q.match(
        /(?:tell|explain|describe|about|information|info|detail|summarize|summary)\s+(?:me\s+)?(?:about\s+)?(.+)/i
    );
    const keywords = extractKeywords(normalizedQuestion);

    return {
        type: 'TOPIC',
        target: topicMatch ? topicMatch[1].trim() : normalizedQuestion,
        keywords: expandWithSynonyms(keywords.length > 0 ? keywords : normalizedQuestion.split(/\s+/).filter(w => w.length > 2)),
        operation,
        raw: normalizedQuestion,
    };
}

/** Enhance vague follow-up queries with context */
function enhanceWithContext(query) {
    const last = getLastContext();
    if (!last) return query;
    const isFollowUp = /^(more|tell me more|what else|anything else|and|also|continue|go on|details|elaborate)/i.test(query.raw);
    if (isFollowUp && last.keywords.length > 0) {
        query.keywords = [...new Set([...query.keywords, ...last.keywords])];
        if (!query.target || query.target === query.raw) query.target = last.question;
    }
    return query;
}

function getCapacitorDirectory(entry) {
    return entry.capacitorDirectory || Directory.ExternalStorage;
}

function getMaxSearchableFileSize(ext) {
    const lowered = String(ext || '').toLowerCase();
    if (PDF_EXTS.has(lowered)) return MAX_PDF_FILE_SIZE;
    if (IMG_EXTS.has(lowered)) return MAX_IMAGE_FILE_SIZE;
    if (DOCX_EXTS.has(lowered)) return MAX_TEXT_FILE_SIZE;
    return MAX_TEXT_FILE_SIZE;
}

function getSearchBatchSize(queue = []) {
    const hasHeavyFiles = queue.some(entry => {
        const ext = String(entry?.ext || '').toLowerCase();
        return PDF_EXTS.has(ext) || IMG_EXTS.has(ext);
    });

    const deviceMemory = typeof navigator !== 'undefined' ? Number(navigator.deviceMemory) : NaN;
    const cpuCores = typeof navigator !== 'undefined' ? Number(navigator.hardwareConcurrency) : NaN;
    const lowEndDevice =
        (Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4)
        || (Number.isFinite(cpuCores) && cpuCores > 0 && cpuCores <= 4);

    if (Capacitor.isNativePlatform()) {
        if (lowEndDevice) {
            return hasHeavyFiles ? 3 : 6;
        }
        return hasHeavyFiles ? 5 : SEARCH_BATCH_SIZE_NATIVE;
    }

    if (lowEndDevice) {
        return hasHeavyFiles ? Math.max(8, SEARCH_BATCH_SIZE_DESKTOP - 7) : Math.max(10, SEARCH_BATCH_SIZE_DESKTOP - 5);
    }
    return hasHeavyFiles ? Math.max(12, SEARCH_BATCH_SIZE_DESKTOP - 2) : SEARCH_BATCH_SIZE_DESKTOP;
}

function getSearchCandidateCaps() {
    if (Capacitor.isNativePlatform()) {
        if (isLowRamDevice()) {
            return {
                contentCap: MAX_CONTENT_CANDIDATES_NATIVE_LOW,
                filenameCap: MAX_FILENAME_CANDIDATES_NATIVE_LOW,
            };
        }
        return {
            contentCap: MAX_CONTENT_CANDIDATES_NATIVE,
            filenameCap: MAX_FILENAME_CANDIDATES_NATIVE,
        };
    }
    return {
        contentCap: MAX_CONTENT_CANDIDATES_WEB,
        filenameCap: MAX_FILENAME_CANDIDATES_WEB,
    };
}

function trimMatchesByScore(matches, limit) {
    if (!Array.isArray(matches)) return;
    const maxItems = Math.max(1, Number(limit) || 1);
    if (matches.length <= maxItems) return;
    matches.sort((a, b) => {
        const aScore = Number(a?.score) || 0;
        const bScore = Number(b?.score) || 0;
        if (aScore !== bScore) return bScore - aScore;
        return String(a?.fileName || '').localeCompare(String(b?.fileName || ''));
    });
    matches.length = maxItems;
}

function shouldKeepContentMatch(score, paragraph, query) {
    const numericScore = Number(score) || 0;

    if (query?.type === 'AGE_LOOKUP' || query?.type === 'DOB_LOOKUP') {
        if (AGE_INLINE_PATTERN.test(paragraph)) return true;
        if (DOB_SIGNAL_PATTERN.test(paragraph) && DATE_PATTERN.test(paragraph)) return true;
    }

    if (numericScore >= CONTENT_SCORE_THRESHOLD && hasStrongQuerySignal(paragraph, query)) return true;

    const keywords = normalizeKeywordVariants(query?.keywords || []).filter(isSearchSignalToken);
    if (keywords.length === 0) return numericScore > 0;

    const matched = countMatchedQueryKeywords(paragraph, keywords);
    if (matched === 0) return false;

    const minimumHits = keywords.length > 4 ? 2 : 1;
    if (matched < minimumHits) return false;

    return numericScore >= 0.12;
}

function extractNeedleSnippet(text, needle, radius = 220) {
    const source = String(text || '');
    const target = String(needle || '').trim().toLowerCase();
    if (!source || !target || target.length < 2) return null;

    const lowerSource = source.toLowerCase();
    const idx = lowerSource.indexOf(target);
    if (idx < 0) return null;

    const start = Math.max(0, idx - radius);
    const end = Math.min(source.length, idx + target.length + radius);
    return source.substring(start, end).trim();
}

function decodeBase64ToBlob(base64Data, mimeType) {
    if (!base64Data || typeof base64Data !== 'string') return null;
    if (typeof atob !== 'function') return null;

    const payload = base64Data.includes(',')
        ? base64Data.substring(base64Data.indexOf(',') + 1)
        : base64Data;

    try {
        const binary = atob(payload.replace(/\s+/g, ''));
        const chunkSize = 8192;
        const chunks = [];

        for (let offset = 0; offset < binary.length; offset += chunkSize) {
            const slice = binary.slice(offset, offset + chunkSize);
            const bytes = new Uint8Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                bytes[i] = slice.charCodeAt(i);
            }
            chunks.push(bytes);
        }

        return new Blob(chunks, { type: mimeType });
    } catch {
        return null;
    }
}

async function withTimeout(promiseLike, timeoutMs, label = 'operation') {
    const safeTimeoutMs = Math.max(1, Number(timeoutMs) || 1);
    let timeoutId = null;
    try {
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`${label}_timeout`));
            }, safeTimeoutMs);
        });
        return await Promise.race([promiseLike, timeoutPromise]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

async function fetchWithTimeout(url, options = {}) {
    const {
        timeoutMs = URI_FETCH_TIMEOUT_MS,
        ...fetchOptions
    } = options || {};

    const controller = new AbortController();
    let timeoutId = null;
    try {
        timeoutId = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || URI_FETCH_TIMEOUT_MS));
        return await fetch(url, {
            ...fetchOptions,
            signal: controller.signal,
        });
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

async function delayMs(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

async function yieldToMainThread(extraDelayMs = 0) {
    if (typeof requestAnimationFrame === 'function') {
        await new Promise(resolve => requestAnimationFrame(() => resolve()));
        if (extraDelayMs > 0) await delayMs(extraDelayMs);
        return;
    }
    await delayMs(Math.max(0, Number(extraDelayMs) || 0));
}

function getReadFailureCacheKey(entry) {
    return String(entry?.id || `${entry?.path || ''}/${entry?.name || ''}`);
}

function shouldSkipReadAttempt(entry) {
    const key = getReadFailureCacheKey(entry);
    if (!key) return false;
    const cached = _readFailureCache.get(key);
    if (!cached) return false;

    if ((Date.now() - cached.ts) > READ_FAILURE_CACHE_TTL) {
        _readFailureCache.delete(key);
        return false;
    }

    return Number(cached.count || 0) >= READ_FAILURE_SKIP_THRESHOLD;
}

function noteReadFailure(entry) {
    const key = getReadFailureCacheKey(entry);
    if (!key) return;
    const previous = _readFailureCache.get(key);
    if (_readFailureCache.has(key)) {
        _readFailureCache.delete(key);
    }
    _readFailureCache.set(key, {
        count: Math.min(10, Number(previous?.count || 0) + 1),
        ts: Date.now(),
    });
    pruneMapToLimit(_readFailureCache, getAdaptiveCacheCaps().readFailureMax);
}

function clearReadFailure(entry) {
    const key = getReadFailureCacheKey(entry);
    if (!key) return;
    _readFailureCache.delete(key);
}

function queueOcrTask(task) {
    const runTask = async () => task();
    const queued = _ocrTaskChain.then(runTask, runTask);
    _ocrTaskChain = queued.catch(() => { });
    return queued;
}

function getMaxConcurrentSearches() {
    if (Capacitor.isNativePlatform()) {
        return isLowRamDevice() ? MAX_CONCURRENT_SEARCHES_NATIVE_LOW : MAX_CONCURRENT_SEARCHES_NATIVE;
    }
    return MAX_CONCURRENT_SEARCHES_WEB;
}

async function readFileTextWithRetry(entry, attempts = FILE_READ_RETRY_ATTEMPTS) {
    if (shouldSkipReadAttempt(entry)) {
        return null;
    }

    const maxAttempts = Math.max(1, Number(attempts) || 1);
    let hadFailure = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const text = await readFileText(entry);
        if (text && text.trim().length > 0) {
            clearReadFailure(entry);
            return text;
        }
        hadFailure = true;

        if (attempt < maxAttempts) {
            await delayMs(70 * attempt);
        }
    }

    if (hadFailure) {
        noteReadFailure(entry);
    }
    return null;
}

// ===================================================================
// 3. FILE READER — Streaming, zero-copy, RAM-efficient
// ===================================================================

async function readFileText(entry) {
    const runtimeCacheKey = entry.name + '|' + (entry.path || '');
    const persistentCacheKey = buildPersistentContentCacheKey(entry);
    const cached = getCachedText(runtimeCacheKey);
    if (cached) return cached;

    const persisted = await getPersistedFileText(persistentCacheKey);
    if (persisted && persisted.trim().length > 0) {
        setCachedText(runtimeCacheKey, persisted);
        return persisted;
    }

    try {
        let text = null;
        const ext = (entry.ext || '').toLowerCase();
        const maxFileSize = getMaxSearchableFileSize(ext);

        // --- Native Capacitor (Android APK) ---
        if (entry.capacitorPath) {
            const directory = getCapacitorDirectory(entry);
            try {
                const stat = await Filesystem.stat({ path: entry.capacitorPath, directory });
                if (Number(stat?.size || 0) > maxFileSize) return null;
            } catch { /* can't stat, try reading anyway */ }

            if (PDF_EXTS.has(ext)) {
                text = await _readCapacitorPdf(entry);
            } else if (IMG_EXTS.has(ext)) {
                text = await _readCapacitorImage(entry, ext);
            } else if (DOCX_EXTS.has(ext)) {
                text = await _readCapacitorDocx(entry);
            } else if (XLSX_EXTS.has(ext)) {
                text = await _readCapacitorXlsx(entry);
            } else if (!IGNORE_EXTS.has(ext)) {
                text = await _readCapacitorText(entry);
            }
        }
        // --- Web File API (Desktop browser) ---
        else {
            let file = null;
            if (entry.handle) {
                file = await entry.handle.getFile();
            } else if (entry.file) {
                file = entry.file;
            } else {
                return null;
            }

            if (Number(file?.size || 0) > maxFileSize) return null;

            if (PDF_EXTS.has(ext)) {
                text = await extractPdfText(file);
            } else if (IMG_EXTS.has(ext)) {
                text = await extractImageText(file);
            } else if (DOCX_EXTS.has(ext)) {
                text = await extractDocxText(file);
            } else if (XLSX_EXTS.has(ext)) {
                text = await extractXlsxText(await file.arrayBuffer(), entry.name);
            } else if (!IGNORE_EXTS.has(ext)) {
                text = await withTimeout(file.text(), URI_FETCH_TIMEOUT_MS, 'file_text_read').catch(() => null);
            }
        }

        if (text && text.trim().length > 0) {
            setCachedText(runtimeCacheKey, text);
            void setPersistedFileText(persistentCacheKey, text);
            return text;
        }

        return null;
    } catch (e) {
        console.warn(`[Nice] readFileText failed for "${entry.name}":`, e.message || e);
        return null;
    }
}
/** Read a text file on Android — try Filesystem.readFile, fallback to getUri + fetch */
async function _readCapacitorText(entry) {
    const directory = getCapacitorDirectory(entry);
    // Method 1: Direct Filesystem.readFile with utf8 encoding
    try {
        const result = await Filesystem.readFile({
            path: entry.capacitorPath,
            directory,
            encoding: 'utf8'
        });
        if (result.data && typeof result.data === 'string' && result.data.length > 0) {
            return result.data;
        }
    } catch (e) {
        console.warn(`[Nice] Direct read failed for "${entry.name}", trying URI fallback:`, e.message || e);
    }

    // Method 2: getUri + Capacitor.convertFileSrc + fetch (Android 11+ fallback)
    try {
        const uriResult = await Filesystem.getUri({
            path: entry.capacitorPath,
            directory
        });
        if (uriResult.uri) {
            const webUrl = Capacitor.convertFileSrc(uriResult.uri);
            const response = await fetchWithTimeout(webUrl, {
                timeoutMs: URI_FETCH_TIMEOUT_MS,
                cache: 'no-store',
            });
            if (response.ok) {
                const text = await withTimeout(response.text(), URI_FETCH_TIMEOUT_MS, 'text_fetch_decode');
                if (text && text.length > 0) return text;
            }
        }
    } catch (e2) {
        console.warn(`[Nice] URI fallback also failed for "${entry.name}":`, e2.message || e2);
    }

    return null;
}

async function readImageBlob(entry) {
    try {
        const extLower = String(entry.ext || '').toLowerCase();
        if (entry.capacitorPath) {
            const directory = getCapacitorDirectory(entry);
            const result = await Filesystem.readFile({ path: entry.capacitorPath, directory });
            const mime = getMimeTypeForEntry(entry) || `image/${extLower || 'jpeg'}`;
            return decodeBase64ToBlob(result?.data, mime);
        }
        if (entry.file instanceof File || entry.file instanceof Blob) {
            return entry.file;
        }
        if (entry.handle?.getFile) {
            return await entry.handle.getFile();
        }
    } catch {
        return null;
    }
    return null;
}

/** Read a PDF file on Android */
async function _readCapacitorPdf(entry) {
    const directory = getCapacitorDirectory(entry);
    let blob = null;
    try {
        const result = await Filesystem.readFile({
            path: entry.capacitorPath,
            directory
        });
        blob = decodeBase64ToBlob(result?.data, 'application/pdf');
    } catch (e) {
        console.warn(`[Nice] Direct PDF read failed for "${entry.name}", trying URI fallback:`, e.message || e);
    }

    if (!blob) {
        try {
            const uriResult = await Filesystem.getUri({
                path: entry.capacitorPath,
                directory,
            });
            if (uriResult.uri) {
                const webUrl = Capacitor.convertFileSrc(uriResult.uri);
                const response = await fetchWithTimeout(webUrl, {
                    cache: 'no-store',
                    timeoutMs: URI_FETCH_TIMEOUT_MS,
                });
                if (response.ok) {
                    blob = await withTimeout(response.blob(), URI_FETCH_TIMEOUT_MS, 'pdf_blob_fetch');
                }
            }
        } catch (e2) {
            console.warn(`[Nice] URI PDF fallback failed for "${entry.name}":`, e2.message || e2);
        }
    }

    if (!blob) {
        return null;
    }

    return await withTimeout(
        extractPdfText(new File([blob], entry.name, { type: 'application/pdf' })),
        PDF_EXTRACT_TIMEOUT_MS,
        'pdf_extract',
    ).catch(() => null);
}
async function _readCapacitorDocx(entry) {
    const directory = getCapacitorDirectory(entry);
    let blob = null;

    try {
        const result = await Filesystem.readFile({
            path: entry.capacitorPath,
            directory
        });
        blob = decodeBase64ToBlob(result?.data, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } catch (e) {
        console.warn(`[Nice] Direct DOCX read failed for "${entry.name}", trying URI fallback:`, e.message || e);
    }

    if (!blob) {
        try {
            const uriResult = await Filesystem.getUri({
                path: entry.capacitorPath,
                directory,
            });
            if (uriResult.uri) {
                const webUrl = Capacitor.convertFileSrc(uriResult.uri);
                const response = await fetchWithTimeout(webUrl, {
                    cache: 'no-store',
                    timeoutMs: URI_FETCH_TIMEOUT_MS,
                });
                if (response.ok) {
                    blob = await withTimeout(response.blob(), URI_FETCH_TIMEOUT_MS, 'docx_blob_fetch');
                }
            }
        } catch (e2) {
            console.warn(`[Nice] URI DOCX fallback failed for "${entry.name}":`, e2.message || e2);
        }
    }

    if (!blob) return null;
    return await withTimeout(extractDocxText(blob), DOCX_EXTRACT_TIMEOUT_MS, 'docx_extract').catch(() => null);
}

/** Read an XLSX spreadsheet on Android */
async function _readCapacitorXlsx(entry) {
    const directory = getCapacitorDirectory(entry);
    let blob = null;

    try {
        const result = await Filesystem.readFile({
            path: entry.capacitorPath,
            directory,
        });
        blob = decodeBase64ToBlob(result?.data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) {
        console.warn(`[Nice] Direct XLSX read failed for "${entry.name}", trying URI fallback:`, e?.message || e);
    }

    if (!blob) {
        try {
            const uriResult = await Filesystem.getUri({
                path: entry.capacitorPath,
                directory,
            });
            if (uriResult.uri) {
                const webUrl = Capacitor.convertFileSrc(uriResult.uri);
                const response = await fetchWithTimeout(webUrl, {
                    cache: 'no-store',
                    timeoutMs: URI_FETCH_TIMEOUT_MS,
                });
                if (response.ok) {
                    blob = await withTimeout(response.blob(), URI_FETCH_TIMEOUT_MS, 'xlsx_blob_fetch');
                }
            }
        } catch (e2) {
            console.warn(`[Nice] URI XLSX fallback failed for "${entry.name}":`, e2?.message || e2);
        }
    }

    if (!blob) return null;
    return await withTimeout(extractXlsxText(blob, entry.name), URI_FETCH_TIMEOUT_MS, 'xlsx_extract').catch(() => null);
}

/** Read an image file on Android for OCR */
async function _readCapacitorImage(entry, ext) {
    const directory = getCapacitorDirectory(entry);
    const mimeByExt = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        bmp: 'image/bmp',
        heic: 'image/heic',
        heif: 'image/heif',
        tif: 'image/tiff',
        tiff: 'image/tiff',
    };
    const mimeType = mimeByExt[(ext || '').toLowerCase()] || 'image/jpeg';
    let blob = null;
    try {
        const result = await Filesystem.readFile({
            path: entry.capacitorPath,
            directory
        });
        blob = decodeBase64ToBlob(result?.data, mimeType);
    } catch (e) {
        console.warn(`[Nice] Direct image read failed for "${entry.name}", trying URI fallback:`, e.message || e);
    }

    if (!blob) {
        try {
            const uriResult = await Filesystem.getUri({
                path: entry.capacitorPath,
                directory,
            });
            if (uriResult.uri) {
                const webUrl = Capacitor.convertFileSrc(uriResult.uri);
                const response = await fetchWithTimeout(webUrl, {
                    cache: 'no-store',
                    timeoutMs: URI_FETCH_TIMEOUT_MS,
                });
                if (response.ok) {
                    blob = await withTimeout(response.blob(), URI_FETCH_TIMEOUT_MS, 'image_blob_fetch');
                }
            }
        } catch (e2) {
            console.warn(`[Nice] URI image fallback failed for "${entry.name}":`, e2.message || e2);
        }
    }

    if (!blob) {
        return null;
    }

    return await withTimeout(extractImageText(blob), OCR_EXTRACT_TIMEOUT_MS, 'ocr_extract').catch(() => null);
}
async function extractDocxText(fileOrBlob) {
    try {
        const mammoth = await getMammoth();
        const source = fileOrBlob instanceof Blob ? fileOrBlob : new Blob([fileOrBlob]);
        const arrayBuffer = await source.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        const text = (result?.value || '').trim();
        return text.length > 0 ? text : null;
    } catch (e) {
        console.warn('[Nice] DOCX extraction failed:', e?.message || e);
        return null;
    }
}

async function extractPdfText(file) {
    let pdf = null;
    try {
        const pdfjsLib = await getPdfjs();
        const buffer = await withTimeout(file.arrayBuffer(), URI_FETCH_TIMEOUT_MS, 'pdf_arraybuffer');
        pdf = await withTimeout(pdfjsLib.getDocument({ data: buffer }).promise, PDF_EXTRACT_TIMEOUT_MS, 'pdf_open');
        const parts = [];
        const pageCount = Math.min(pdf.numPages, 140);
        const startedAt = Date.now();

        for (let i = 1; i <= pageCount; i++) {
            if ((Date.now() - startedAt) > PDF_EXTRACT_TIMEOUT_MS) break;

            const page = await withTimeout(pdf.getPage(i), 4000, 'pdf_page');
            const content = await withTimeout(page.getTextContent(), 4000, 'pdf_text');
            parts.push(content.items.map(item => item.str).join(' '));
            if (typeof page.cleanup === 'function') {
                page.cleanup();
            }
            if (i % 4 === 0) {
                await yieldToMainThread(0);
            }
        }

        return parts.join('\n');
    } catch {
        return null;
    } finally {
        if (pdf && typeof pdf.destroy === 'function') {
            try {
                pdf.destroy();
            } catch {
                // Ignore PDF worker cleanup failures.
            }
        }
    }
}

export async function extractImageText(blobOrFile) {
    return queueOcrTask(async () => {
        try {
            const worker = await getTesseractWorker();
            const recognition = await withTimeout(
                worker.recognize(blobOrFile),
                OCR_EXTRACT_TIMEOUT_MS,
                'ocr_recognize',
            );
            const text = (recognition?.data?.text || '').trim();
            // Only return if OCR extracted meaningful text (not noise)
            if (text.length > 5) {
                console.log(`[Nice] OCR extracted ${text.length} chars from image: ${text.substring(0, 50)}...`);
                return text;
            }
            return null;
        } catch (e) {
            if (String(e?.message || '').includes('ocr_recognize_timeout') && _tesseractWorker) {
                try {
                    await _tesseractWorker.terminate();
                } catch {
                    // Ignore teardown failures.
                }
                _tesseractWorker = null;
            }
            console.warn('[Nice] OCR failed for image:', e);
            return null;
        }
    });
}

export async function extractAttachedFileText(file) {
    if (!file) return null;
    const name = String(file.name || '');
    const ext = (name.split('.').pop() || '').toLowerCase();

    if (PDF_EXTS.has(ext)) {
        return await extractPdfText(file);
    }
    if (IMG_EXTS.has(ext)) {
        return await extractImageText(file);
    }
    if (DOCX_EXTS.has(ext)) {
        return await extractDocxText(file);
    }
    if (XLSX_EXTS.has(ext)) {
        return await extractXlsxText(await file.arrayBuffer(), file.name);
    }

    if (typeof file.text === 'function') {
        try {
            const text = await withTimeout(file.text(), URI_FETCH_TIMEOUT_MS, 'attached_file_text');
            return text && text.trim().length > 0 ? text : null;
        } catch {
            return null;
        }
    }

    return null;
}

async function getEntryVersion(entry) {
    const key = entry.id || `${entry.path || ''}/${entry.name || ''}`;
    const cachedVersion = getCachedEntryVersion(key);
    if (cachedVersion) return cachedVersion;

    let version = '0';
    try {
        if (entry.file?.lastModified) {
            version = String(entry.file.lastModified);
        } else if (entry.handle?.getFile) {
            const file = await entry.handle.getFile();
            version = String(file.lastModified || file.size || 0);
        } else if (entry.capacitorPath) {
            const directory = getCapacitorDirectory(entry);
            const stat = await Filesystem.stat({
                path: entry.capacitorPath,
                directory,
            });
            version = String(stat.mtime || stat.ctime || stat.size || 0);
        }
    } catch {
        version = '0';
    }

    setCachedEntryVersion(key, version);
    return version;
}

async function rerankResultsWithEmbeddings(results, query, opts) {
    const bm25CandidateLimit = Math.max(1, opts.bm25CandidateLimit || 40);
    const rerankTopK = Math.max(1, opts.rerankTopK || 8);
    const progressCb = typeof opts.progressCb === 'function' ? opts.progressCb : null;

    if (!results || results.length < 2) return null;

    try {
        await initEmbeddingWorker();
    } catch (error) {
        console.warn('[Nice] Embedding worker init failed, using BM25 only:', error?.message || error);
        return null;
    }

    const sortedByBm25 = [...results].sort((a, b) => b.score - a.score);
    const topScore = Number(sortedByBm25[0]?.score || 0);
    const secondScore = Number(sortedByBm25[1]?.score || 0);
    const queryTokenCount = extractKeywords(query?.target || query?.raw || '').length;
    if (topScore >= 8 && secondScore > 0 && topScore >= (secondScore * 2.2)) {
        return sortedByBm25;
    }
    if (queryTokenCount <= 1 && topScore >= 6) {
        return sortedByBm25;
    }

    const adaptiveCandidateCap = Capacitor.isNativePlatform()
        ? (isLowRamDevice() ? 10 : 16)
        : 28;
    const cappedLimit = Math.max(2, Math.min(bm25CandidateLimit, adaptiveCandidateCap));
    const candidates = sortedByBm25.slice(0, Math.min(cappedLimit, sortedByBm25.length));
    if (candidates.length < 2) return null;

    const queryText = query.raw || query.target || query.keywords.join(' ');
    let queryVector = null;
    try {
        queryVector = await embedTextWithWorker(queryText.substring(0, 1200));
    } catch (error) {
        console.warn('[Nice] Query embedding failed, using BM25 only:', error?.message || error);
        return null;
    }

    // Optional vector-store boost for previously embedded chunks (saves re-embedding work)
    let vectorStoreHits = [];
    try {
        vectorStoreHits = await searchTextVectors(queryVector, Math.max(4, rerankTopK));
    } catch {
        vectorStoreHits = [];
    }

    const maxBm25 = Math.max(...candidates.map(c => c.score || 0), 1);

    const dedupeHashes = new Set(
        candidates.map(c => c.chunkHash || hashChunkText(c.paragraph || ''))
    );
    for (const hit of vectorStoreHits) {
        const paraHash = hashChunkText(hit.paragraph || '');
        if (dedupeHashes.has(paraHash)) continue;
        dedupeHashes.add(paraHash);
        candidates.push({
            paragraph: hit.paragraph || '',
            score: (hit.score || 0.4) * maxBm25,
            matchType: 'content',
            fileName: hit.fileName || 'snippet',
            path: hit.path || '',
            fileId: hit.id || '',
            fileVersion: 'vs',
            chunkIndex: -7,
            chunkHash: paraHash,
        });
    }

    const reranked = [];
    let processed = 0;
    let nextCandidateIndex = 0;
    const webCores = (typeof navigator !== 'undefined')
        ? Number(navigator.hardwareConcurrency)
        : 0;
    const rerankConcurrency = Capacitor.isNativePlatform()
        ? (isLowRamDevice() ? 1 : 2)
        : (Number.isFinite(webCores) && webCores > 0
            ? Math.max(2, Math.min(5, Math.floor(webCores / 2)))
            : 3);
    const workerCount = Math.max(1, Math.min(rerankConcurrency, candidates.length));

    const processCandidate = async (candidate, index) => {
        try {
            const cacheKey = buildEmbeddingCacheKey({
                fileId: candidate.fileId || '',
                fileVersion: candidate.fileVersion || '0',
                chunkIndex: candidate.chunkIndex,
                chunkHash: candidate.chunkHash,
                paragraph: candidate.paragraph || '',
            });
            let chunkVector = await getCachedChunkEmbedding(cacheKey);
            if (!chunkVector) {
                chunkVector = await embedTextWithWorker((candidate.paragraph || '').substring(0, 1200));
                await setCachedChunkEmbedding(cacheKey, chunkVector);
            }
            // Persist to encrypted vector store for future instant retrieval.
            try {
                await addTextVector(cacheKey, chunkVector, {
                    fileName: candidate.fileName || '',
                    path: candidate.path || '',
                    paragraph: (candidate.paragraph || '').substring(0, 600),
                    fileId: candidate.fileId || '',
                    chunkIndex: candidate.chunkIndex,
                });
            } catch {
                // Vector-store persistence is best-effort.
            }

            const semantic = cosineSimilarity(queryVector, chunkVector);
            const blended = computeBlendedRerankScore({
                bm25Score: candidate.score || 0,
                maxBm25,
                semanticSimilarity: semantic,
            });

            reranked.push({
                ...candidate,
                rerankScore: blended,
            });
        } catch {
            // Skip candidates that fail semantic embedding and keep BM25 remainder.
        } finally {
            processed += 1;
            if (progressCb) progressCb('rerank', processed, candidates.length, candidate.fileName);
            if ((index % 3) === 2) {
                await yieldToMainThread(opts.fullScanThrottleMs);
            }
        }
    };

    const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
            const index = nextCandidateIndex;
            nextCandidateIndex += 1;
            if (index >= candidates.length) return;
            const candidate = candidates[index];
            await processCandidate(candidate, index);
        }
    });

    await Promise.allSettled(workers);

    if (reranked.length < 2) return null;

    const rerankedTop = reranked
        .sort((a, b) => b.rerankScore - a.rerankScore)
        .slice(0, Math.min(rerankTopK, reranked.length));

    const usedIds = new Set(rerankedTop.map(resultIdentity));
    const remainder = sortedByBm25.filter(item => !usedIds.has(resultIdentity(item)));
    return [...rerankedTop, ...remainder];
}

// ===================================================================
// 4. BM25-LITE SCORER — Paragraph-level ranking
// ===================================================================

/**
 * Score a chunk of text against query keywords using BM25-lite.
 * Returns 0 if no match, higher = better.
 */
function scoreChunk(chunkText, query) {
    const chunkLower = chunkText.toLowerCase();
    const chunkLen = Math.max(1, chunkText.trim().split(/\s+/).length);
    if (chunkLen < 3) return 0;
    const keywordMeta = getPreparedKeywordMeta(query);
    if (keywordMeta.length === 0) return 0;

    const avgDocLen = 200; // Assumed average paragraph length
    const k1 = 1.5;
    const b = 0.75;

    let totalScore = 0;
    let matchedKeywords = 0;
    let totalHits = 0;

    for (const meta of keywordMeta) {
        const tf = countKeywordHitsPrepared(chunkLower, meta);
        if (tf <= 0) continue;

        matchedKeywords++;
        totalHits += tf;

        // BM25 term score: tf * (k1 + 1) / (tf + k1 * (1 - b + b * docLen/avgDocLen))
        const normLen = 1 - b + b * (chunkLen / avgDocLen);
        const termScore = (tf * (k1 + 1)) / (tf + k1 * normLen);
        totalScore += termScore;
    }

    if (matchedKeywords === 0) return 0;

    // Coverage bonus: what fraction of query keywords matched?
    const coverage = matchedKeywords / keywordMeta.length;
    totalScore *= (1 + coverage); // Up to 2x boost for full coverage

    // Proximity bonus: if multiple keywords appear close together
    if (matchedKeywords >= 2) {
        const positions = [];
        for (const meta of keywordMeta) {
            const pos = chunkLower.indexOf(meta.token);
            if (pos >= 0) positions.push(pos);
        }
        if (positions.length >= 2) {
            positions.sort((a, b) => a - b);
            const span = positions[positions.length - 1] - positions[0];
            if (span < 200) totalScore *= 1.5; // Keywords within 200 chars
            if (span < 100) totalScore *= 1.3; // Even closer
        }
    }

    // Pattern matching bonus (contact info, IDs) 
    if (query.patterns) {
        for (const pattern of query.patterns) {
            pattern.lastIndex = 0;
            if (pattern.test(chunkText)) {
                totalScore += 10; // Large bonus for pattern matches
            }
        }
    }

    return totalScore;
}

// ===================================================================
// 5. DOCUMENT PARSERS & SECTION-AWARE CHUNKERS (M1)
// ===================================================================

/**
 * Cross-platform raw deflate decompressor.
 * Uses Web Streams DecompressionStream in browser/Capacitor, and node:zlib in Node.js test environments.
 */
export async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'undefined') {
        try {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            const buffer = await new Response(stream).arrayBuffer();
            return new Uint8Array(buffer);
        } catch {
            // Stream decompression failed; try Node zlib fallback
        }
    }
    if (typeof process !== 'undefined' && process.versions?.node) {
        try {
            const mod = 'node:zlib';
            const zlib = await import(/* @vite-ignore */ mod);
            return new Uint8Array(zlib.inflateRawSync(bytes));
        } catch {
            // Node zlib unavailable
        }
    }
    throw new Error('Deflate decompression unsupported in current runtime environment.');
}

/**
 * Parse Central Directory and Local Headers from an ArrayBuffer ZIP archive.
 */
export function readZipEntries(buffer) {
    if (!buffer || buffer.byteLength < 22) {
        return { entries: new Map(), bytes: new Uint8Array(0) };
    }
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const entries = new Map();

    // 1. Scan for End of Central Directory (EOCD) signature 0x06054b50 (PK\x05\x06)
    let eocdOffset = -1;
    const minSearch = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= minSearch; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }

    if (eocdOffset !== -1) {
        const totalEntries = view.getUint16(eocdOffset + 10, true);
        const cdSize = view.getUint32(eocdOffset + 12, true);
        const cdOffset = view.getUint32(eocdOffset + 16, true);

        let pos = cdOffset;
        for (let i = 0; i < totalEntries && pos < cdOffset + cdSize; i++) {
            if (pos + 46 > bytes.length) break;
            if (view.getUint32(pos, true) !== 0x02014b50) break;

            const method = view.getUint16(pos + 10, true);
            const compressedSize = view.getUint32(pos + 20, true);
            const uncompressedSize = view.getUint32(pos + 24, true);
            const fileNameLen = view.getUint16(pos + 28, true);
            const extraLen = view.getUint16(pos + 30, true);
            const commentLen = view.getUint16(pos + 32, true);
            const localHeaderOffset = view.getUint32(pos + 42, true);

            if (pos + 46 + fileNameLen > bytes.length) break;
            const fileNameBytes = bytes.subarray(pos + 46, pos + 46 + fileNameLen);
            const fileName = new TextDecoder('utf-8').decode(fileNameBytes);

            if (localHeaderOffset + 30 <= bytes.length) {
                const localFileNameLen = view.getUint16(localHeaderOffset + 26, true);
                const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
                const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

                entries.set(fileName.replace(/\\/g, '/').toLowerCase(), {
                    originalName: fileName,
                    method,
                    compressedSize,
                    uncompressedSize,
                    dataOffset,
                });
            }

            pos += 46 + fileNameLen + extraLen + commentLen;
        }
    } else {
        // Fallback: Scan local file headers (0x04034b50, PK\x03\x04)
        let pos = 0;
        while (pos + 30 <= bytes.length) {
            if (view.getUint32(pos, true) !== 0x04034b50) break;

            const flags = view.getUint16(pos + 6, true);
            const method = view.getUint16(pos + 8, true);
            const compressedSize = view.getUint32(pos + 18, true);
            const uncompressedSize = view.getUint32(pos + 22, true);
            const fileNameLen = view.getUint16(pos + 26, true);
            const extraLen = view.getUint16(pos + 28, true);

            if (pos + 30 + fileNameLen > bytes.length) break;
            const fileNameBytes = bytes.subarray(pos + 30, pos + 30 + fileNameLen);
            const fileName = new TextDecoder('utf-8').decode(fileNameBytes);
            const dataOffset = pos + 30 + fileNameLen + extraLen;

            entries.set(fileName.replace(/\\/g, '/').toLowerCase(), {
                originalName: fileName,
                method,
                compressedSize,
                uncompressedSize,
                dataOffset,
            });

            if ((flags & 0x08) !== 0 && compressedSize === 0) break;
            pos = dataOffset + compressedSize;
        }
    }

    return { entries, bytes };
}

/**
 * Extract and decompress a specific text file from a parsed ZIP.
 */
export async function extractZipTextFile(zip, relativePath) {
    if (!zip || !zip.entries) return null;
    const key = relativePath.replace(/^\//, '').replace(/\\/g, '/').toLowerCase();
    const entry = zip.entries.get(key);
    if (!entry) return null;

    if (entry.dataOffset + entry.compressedSize > zip.bytes.length) {
        return null;
    }

    const slice = zip.bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
    if (entry.method === 0) {
        return new TextDecoder('utf-8').decode(slice);
    }
    if (entry.method === 8) {
        try {
            const decompressed = await inflateRaw(slice);
            return new TextDecoder('utf-8').decode(decompressed);
        } catch {
            return null;
        }
    }
    return null;
}

export function decodeXmlEntities(str) {
    if (!str) return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function parseSharedStrings(xml) {
    if (!xml) return [];
    const strings = [];
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let siMatch;
    while ((siMatch = siRegex.exec(xml)) !== null) {
        const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tMatch;
        let full = '';
        while ((tMatch = tRegex.exec(siMatch[1])) !== null) {
            full += tMatch[1];
        }
        strings.push(decodeXmlEntities(full));
    }
    return strings;
}

export function parseWorkbookSheets(xml) {
    if (!xml) return [{ name: 'Sheet1', id: '1', sheetFile: 'worksheets/sheet1.xml' }];
    const sheets = [];
    const sheetRegex = /<sheet\b([^>]*)\/?>/g;
    let match;
    while ((match = sheetRegex.exec(xml)) !== null) {
        const attrs = match[1];
        const nameMatch = attrs.match(/\bname="([^"]+)"/);
        const sheetIdMatch = attrs.match(/\bsheetId="([^"]+)"/);
        const rIdMatch = attrs.match(/\b(?:r:id|id)="([^"]+)"/);

        const name = nameMatch ? decodeXmlEntities(nameMatch[1]) : `Sheet${sheets.length + 1}`;
        const id = sheetIdMatch ? sheetIdMatch[1] : String(sheets.length + 1);
        const rId = rIdMatch ? rIdMatch[1] : `rId${id}`;

        sheets.push({
            name,
            id,
            rId,
            sheetFile: `worksheets/sheet${id}.xml`,
        });
    }
    return sheets.length > 0 ? sheets : [{ name: 'Sheet1', id: '1', sheetFile: 'worksheets/sheet1.xml' }];
}

export function colLettersToIndex(colStr) {
    if (!colStr) return 0;
    const upper = String(colStr).toUpperCase();
    let index = 0;
    for (let i = 0; i < upper.length; i++) {
        const code = upper.charCodeAt(i);
        if (code >= 65 && code <= 90) {
            index = index * 26 + (code - 64);
        }
    }
    return Math.max(0, index - 1);
}

export function parseWorksheetRows(xml, sharedStrings = []) {
    if (!xml) return [];
    const rows = [];
    const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(xml)) !== null) {
        const rowContent = rowMatch[1];
        const cells = [];
        const cRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
        let cMatch;

        while ((cMatch = cRegex.exec(rowContent)) !== null) {
            const attrs = cMatch[1] || cMatch[3] || '';
            const body = cMatch[2] || '';

            const rMatch = attrs.match(/\br="([A-Za-z]+)(\d+)"/);
            const colIdx = rMatch ? colLettersToIndex(rMatch[1]) : cells.length;

            const tMatch = attrs.match(/\bt="([a-z]+)"/);
            const type = tMatch ? tMatch[1] : 'n';

            let val = '';
            const vMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
            if (vMatch) {
                val = vMatch[1];
            } else {
                const isMatch = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
                if (isMatch) {
                    const tValMatch = isMatch[1].match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
                    if (tValMatch) val = tValMatch[1];
                }
            }

            let cellValue = '';
            if (type === 's') {
                const idx = parseInt(val, 10);
                cellValue = (sharedStrings && sharedStrings[idx] !== undefined) ? sharedStrings[idx] : '';
            } else if (type === 'b') {
                cellValue = val === '1' ? 'TRUE' : (val === '0' ? 'FALSE' : val);
            } else if (type === 'inlineStr' || type === 'str') {
                cellValue = decodeXmlEntities(val);
            } else {
                cellValue = decodeXmlEntities(val);
            }

            while (cells.length < colIdx) {
                cells.push('');
            }
            cells[colIdx] = String(cellValue || '').trim();
        }

        if (cells.some(c => c !== '')) {
            rows.push(cells);
        }
    }
    return rows;
}

/**
 * Delimiter auto-detector for delimited text.
 */
export function detectDelimiter(text, ext = '') {
    const extLower = String(ext || '').toLowerCase();
    if (extLower === 'tsv' || extLower === 'tab') return '\t';

    const lines = String(text || '').split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, 5);
    if (lines.length === 0) return extLower === 'tsv' ? '\t' : ',';

    const counts = { ',': 0, '\t': 0, ';': 0, '|': 0 };
    for (const line of lines) {
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (!inQuotes && counts[ch] !== undefined) {
                counts[ch]++;
            }
        }
    }

    if (extLower === 'csv') {
        return counts[';'] > counts[','] ? ';' : ',';
    }

    let bestDelim = ',';
    let maxCount = 0;
    for (const [delim, count] of Object.entries(counts)) {
        if (count > maxCount) {
            maxCount = count;
            bestDelim = delim;
        }
    }
    return maxCount > 0 ? bestDelim : ',';
}

/**
 * RFC 4180 compliant CSV / TSV parser.
 */
export function parseCsv(text, delimiter = ',') {
    if (!text || typeof text !== 'string') return [];

    const cleanText = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const delim = delimiter || ',';
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;
    let rowHadQuotes = false;
    let hasPendingField = false;
    const len = cleanText.length;

    for (let i = 0; i < len; i++) {
        const char = cleanText[i];
        const nextChar = i + 1 < len ? cleanText[i + 1] : '';

        if (inQuotes) {
            hasPendingField = true;
            if (char === '"') {
                if (nextChar === '"') {
                    currentField += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                currentField += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
                rowHadQuotes = true;
                hasPendingField = true;
            } else if (char === delim) {
                currentRow.push(currentField.trim());
                currentField = '';
                hasPendingField = true;
            } else if (char === '\r') {
                if (nextChar === '\n') i++;
                currentRow.push(currentField.trim());
                currentField = '';
                if (currentRow.some(c => c.length > 0) || rowHadQuotes) {
                    rows.push(currentRow);
                }
                currentRow = [];
                rowHadQuotes = false;
                hasPendingField = false;
            } else if (char === '\n') {
                currentRow.push(currentField.trim());
                currentField = '';
                if (currentRow.some(c => c.length > 0) || rowHadQuotes) {
                    rows.push(currentRow);
                }
                currentRow = [];
                rowHadQuotes = false;
                hasPendingField = false;
            } else {
                hasPendingField = true;
                currentField += char;
            }
        }
    }

    if (hasPendingField || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        if (currentRow.some(c => c.length > 0) || rowHadQuotes) {
            rows.push(currentRow);
        }
    }

    return rows;
}

/**
 * Header-preserving tabular chunker.
 * Formats row groups with headers: [Table: fileName > sheetName] Header1: Val1 | Header2: Val2\nHeader1: Val3 | Header2: Val4
 */
export function chunkTabularData(rowsOrText, fileName = 'table.csv', sheetName = '', options = {}) {
    let rows;
    if (typeof rowsOrText === 'string') {
        const delim = options.delimiter || detectDelimiter(rowsOrText, fileName);
        rows = parseCsv(rowsOrText, delim);
    } else if (Array.isArray(rowsOrText)) {
        rows = rowsOrText;
    } else {
        return [];
    }

    if (!rows || rows.length === 0) return [];

    let headerIdx = 0;
    while (headerIdx < rows.length && rows[headerIdx].filter(c => String(c).trim().length > 0).length < 2) {
        headerIdx++;
    }
    if (headerIdx >= rows.length) headerIdx = 0;

    const rawHeaders = rows[headerIdx] || [];
    const headers = rawHeaders.map((h, i) => {
        const clean = String(h || '').trim();
        return clean || `Column_${i + 1}`;
    });

    const dataRows = rows.slice(headerIdx + 1);
    const prefix = sheetName ? `[Table: ${fileName} > ${sheetName}]` : `[Table: ${fileName}]`;

    if (dataRows.length === 0) {
        return [`${prefix} ${headers.map(h => `${h}: (empty)`).join(' | ')}`];
    }

    const maxRowsPerChunk = Math.max(1, Math.min(5, Number(options.maxRowsPerChunk) || 4));
    const maxTotalChunks = Number(options.maxTotalChunks) || 500;
    const chunks = [];
    let currentChunkRows = [];

    for (let r = 0; r < dataRows.length && chunks.length < maxTotalChunks; r++) {
        const row = dataRows[r];
        const fields = [];

        for (let c = 0; c < Math.max(headers.length, row.length); c++) {
            const header = c < headers.length ? headers[c] : `Column_${c + 1}`;
            const val = (row[c] !== undefined && row[c] !== null) ? String(row[c]).trim().replace(/[\r\n]+/g, ' ') : '';
            if (val.length > 0) {
                fields.push(`${header}: ${val}`);
            }
        }

        if (fields.length > 0) {
            currentChunkRows.push(fields.join(' | '));
        }

        if (currentChunkRows.length >= maxRowsPerChunk) {
            const firstRow = `${prefix} ${currentChunkRows[0]}`;
            const chunkText = [firstRow, ...currentChunkRows.slice(1)].join('\n');
            chunks.push(chunkText);
            currentChunkRows = [];
        }
    }

    if (currentChunkRows.length > 0 && chunks.length < maxTotalChunks) {
        const firstRow = `${prefix} ${currentChunkRows[0]}`;
        const chunkText = [firstRow, ...currentChunkRows.slice(1)].join('\n');
        chunks.push(chunkText);
    }

    return chunks;
}

/**
 * Zero-dependency OpenXML (.xlsx) parser extracting workbook sheet names,
 * shared string pool, and cell coordinates into structured header-preserving chunks.
 */
export async function extractXlsxText(fileOrBlobOrBuffer, fileName = 'spreadsheet.xlsx') {
    try {
        let buffer;
        if (fileOrBlobOrBuffer instanceof ArrayBuffer) {
            buffer = fileOrBlobOrBuffer;
        } else if (fileOrBlobOrBuffer instanceof Uint8Array) {
            buffer = fileOrBlobOrBuffer.buffer.slice(
                fileOrBlobOrBuffer.byteOffset,
                fileOrBlobOrBuffer.byteOffset + fileOrBlobOrBuffer.byteLength
            );
        } else if (fileOrBlobOrBuffer && typeof fileOrBlobOrBuffer.arrayBuffer === 'function') {
            buffer = await fileOrBlobOrBuffer.arrayBuffer();
        } else {
            return null;
        }

        if (!buffer || buffer.byteLength < 30) return null;

        const zip = readZipEntries(buffer);
        if (zip.entries.size === 0) return null;

        // 1. Shared Strings Table
        const sharedStringsXml = await extractZipTextFile(zip, 'xl/sharedStrings.xml');
        const sharedStrings = parseSharedStrings(sharedStringsXml);

        // 2. Workbook & Sheets
        const workbookXml = await extractZipTextFile(zip, 'xl/workbook.xml');
        const sheets = parseWorkbookSheets(workbookXml);

        // 3. Relationships map
        const relsXml = await extractZipTextFile(zip, 'xl/_rels/workbook.xml.rels');
        const relMap = new Map();
        if (relsXml) {
            const relRegex = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g;
            let relMatch;
            while ((relMatch = relRegex.exec(relsXml)) !== null) {
                relMap.set(relMatch[1], relMatch[2]);
            }
        }

        const sheetOutputs = [];

        for (let i = 0; i < sheets.length; i++) {
            const sheet = sheets[i];
            let sheetPath = relMap.get(sheet.rId);
            if (sheetPath) {
                sheetPath = sheetPath.startsWith('xl/') ? sheetPath : `xl/${sheetPath}`;
            } else {
                sheetPath = `xl/${sheet.sheetFile}`;
            }

            let sheetXml = await extractZipTextFile(zip, sheetPath);
            if (!sheetXml) {
                sheetXml = await extractZipTextFile(zip, `xl/worksheets/sheet${i + 1}.xml`);
            }
            if (!sheetXml) continue;

            const rows = parseWorksheetRows(sheetXml, sharedStrings);
            if (rows.length > 0) {
                const chunks = chunkTabularData(rows, fileName, sheet.name);
                if (chunks && chunks.length > 0) {
                    sheetOutputs.push(chunks.join('\n\n'));
                }
            }
        }

        return sheetOutputs.length > 0 ? sheetOutputs.join('\n\n') : null;
    } catch (e) {
        console.warn(`[Nice] XLSX extraction failed for "${fileName}":`, e?.message || e);
        return null;
    }
}

/**
 * Splits Markdown text into section-aware chunks preserving heading hierarchy,
 * fenced code blocks, and markdown tables intact.
 */
export function splitMarkdownIntoSections(text, fileName = '') {
    if (!text || typeof text !== 'string') return [];
    const normalized = text.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    const chunks = [];
    const headingStack = []; // [{ level: number, title: string }]
    let currentBlock = [];
    let inCodeFence = false;
    let inTable = false;
    let codeFenceMarker = '';
    let codeFenceLength = 0;

    function getBreadcrumb() {
        if (headingStack.length === 0) {
            return fileName ? `[Document: ${fileName}]` : '';
        }
        return `[Section: ${headingStack.map(h => h.title).join(' > ')}]`;
    }

    function flushBlock() {
        if (currentBlock.length === 0) return;
        const blockText = currentBlock.join('\n').trim();
        currentBlock = [];
        if (blockText.length === 0) return;

        const breadcrumb = getBreadcrumb();
        const chunk = breadcrumb ? `${breadcrumb}\n${blockText}` : blockText;
        chunks.push(chunk);
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // 1. Code Fence Detection
        const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
        if (fenceMatch) {
            if (!inCodeFence) {
                flushBlock();
                inCodeFence = true;
                codeFenceMarker = fenceMatch[2].charAt(0);
                codeFenceLength = fenceMatch[2].length;
                currentBlock.push(line);
                continue;
            } else if (fenceMatch[2].charAt(0) === codeFenceMarker && fenceMatch[2].length >= codeFenceLength) {
                currentBlock.push(line);
                inCodeFence = false;
                flushBlock();
                continue;
            }
        }

        if (inCodeFence) {
            currentBlock.push(line);
            continue;
        }

        // 2. Heading Detection: # to ######
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            flushBlock();
            const level = headingMatch[1].length;
            const title = headingMatch[2].replace(/[#\s]+$/, '').trim();

            while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
                headingStack.pop();
            }
            headingStack.push({ level, title });
            continue;
        }

        // 3. Table Detection
        const isTableLine = /^\s*\|.*\|\s*$/.test(line);
        if (isTableLine) {
            if (!inTable) {
                flushBlock();
                inTable = true;
            }
            currentBlock.push(line);
            continue;
        } else if (inTable) {
            inTable = false;
            flushBlock();
        }

        // 4. Blank line paragraph boundary
        if (trimmed.length === 0) {
            if (currentBlock.length > 0) {
                const currentLen = currentBlock.join('\n').length;
                if (currentLen >= 200) {
                    flushBlock();
                } else {
                    currentBlock.push(line);
                }
            }
            continue;
        }

        currentBlock.push(line);
    }

    flushBlock();

    if (chunks.length === 0 && text.trim().length > 0) {
        return [text.trim().substring(0, 1200)];
    }

    return chunks;
}

/**
 * Recursively flattens a JSON object/array into key-value dot-paths.
 */
export function flattenJsonToDotPaths(val, prefix = '', depth = 0, maxDepth = 12) {
    if (depth > maxDepth) {
        return [`${prefix}: [Max Depth Exceeded]`];
    }
    if (val === null) return [`${prefix}: null`];
    if (typeof val !== 'object') {
        return [`${prefix}: ${JSON.stringify(val)}`];
    }

    const lines = [];
    if (Array.isArray(val)) {
        if (val.length === 0) return [`${prefix}: []`];
        const allPrimitives = val.every(item => item === null || typeof item !== 'object');
        if (allPrimitives && val.length <= 10) {
            return [`${prefix}: ${JSON.stringify(val)}`];
        }
        for (let i = 0; i < Math.min(val.length, 500); i++) {
            const itemPath = prefix ? `${prefix}[${i}]` : `[${i}]`;
            lines.push(...flattenJsonToDotPaths(val[i], itemPath, depth + 1, maxDepth));
        }
    } else {
        const entries = Object.entries(val);
        if (entries.length === 0) return [`${prefix}: {}`];
        for (const [key, child] of entries) {
            const childPath = prefix ? `${prefix}.${key}` : key;
            lines.push(...flattenJsonToDotPaths(child, childPath, depth + 1, maxDepth));
        }
    }
    return lines;
}

/**
 * Chunks a JSON string into semantic dot-path blocks.
 */
export function chunkJson(text, fileName = '') {
    if (!text || typeof text !== 'string') return [];
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return text.split(/\n\s*\n/).filter(p => p.trim().length > 10);
    }

    const dotPaths = flattenJsonToDotPaths(parsed);
    if (dotPaths.length === 0) return [];

    const chunks = [];
    const targetLinesPerChunk = 8;
    const baseBanner = fileName ? `[JSON: ${fileName}]` : '[JSON]';

    for (let i = 0; i < dotPaths.length; i += targetLinesPerChunk) {
        const slice = dotPaths.slice(i, i + targetLinesPerChunk);
        chunks.push(`${baseBanner}\n${slice.join('\n')}`);
    }

    return chunks;
}

/**
 * Chunks code files by function/class/block boundaries.
 */
export function chunkCodeFile(text, fileName = '', language = '') {
    if (!text || typeof text !== 'string') return [];
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const chunks = [];
    let currentBlock = [];
    let currentBlockName = 'Header';
    const baseBanner = fileName ? `[Code: ${fileName}]` : '[Code]';

    const FUNCTION_REGEX = /^(?:\s*)(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:\s*)(?:export\s+)?class\s+(\w+)|^(?:\s*)(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|^(?:\s*)(?:def|class)\s+(\w+)|^(?:\s*)(?:pub\s+)?(?:fn|struct|impl)\s+(\w+)|^(?:\s*)func\s+(?:\(.*?\)\s*)?(\w+)/;

    function flushBlock() {
        if (currentBlock.length === 0) return;
        const blockContent = currentBlock.join('\n').trim();
        currentBlock = [];
        if (blockContent.length < 15) return;
        if (currentBlockName === 'Header' && blockContent.length < 60) return;
        chunks.push(`${baseBanner} > ${currentBlockName}\n${blockContent}`);
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(FUNCTION_REGEX);

        if (match) {
            const identifier = match[1] || match[2] || match[3] || match[4] || match[5] || match[6] || 'Block';
            if (currentBlock.join('\n').trim().length >= 15) {
                flushBlock();
            }
            currentBlockName = identifier;
        }

        currentBlock.push(line);

        if (currentBlock.join('\n').length > 1200) {
            flushBlock();
            currentBlockName = `${currentBlockName} (cont.)`;
        }
    }

    flushBlock();
    return chunks.length > 0 ? chunks : [text.substring(0, 1000)];
}

/**
 * Upgraded paragraph splitter supporting tabular, markdown, JSON, and source code formats.
 */
export function splitIntoParagraphs(text, fileType = '', fileName = '') {
    if (!text || typeof text !== 'string') return [];

    const ext = String(fileType || (fileName.includes('.') ? fileName.split('.').pop() : '')).toLowerCase();

    // Tabular formats: CSV, TSV, or explicit tabular type
    if (ext === 'csv' || ext === 'tsv' || fileType === 'tabular') {
        const tabularChunks = chunkTabularData(text, fileName, '', { delimiter: ext === 'tsv' ? '\t' : undefined });
        if (tabularChunks && tabularChunks.length > 0) {
            return tabularChunks;
        }
    }

    // Markdown formats
    if (ext === 'md' || ext === 'markdown' || fileType === 'markdown') {
        const mdChunks = splitMarkdownIntoSections(text, fileName);
        if (mdChunks && mdChunks.length > 0) {
            return mdChunks;
        }
    }

    // JSON formats
    if (ext === 'json' || fileType === 'json') {
        const jsonChunks = chunkJson(text, fileName);
        if (jsonChunks && jsonChunks.length > 0) {
            return jsonChunks;
        }
    }

    // Code formats
    if (CODE_EXTENSIONS.has(ext) || fileType === 'code') {
        const codeChunks = chunkCodeFile(text, fileName, ext);
        if (codeChunks && codeChunks.length > 0) {
            return codeChunks;
        }
    }

    // Spreadsheet formats (pre-formatted chunks separated by double newlines)
    if (ext === 'xlsx' || ext === 'xls') {
        const paras = text.split(/\n\s*\n|\r\n\s*\r\n/).filter(p => p.trim().length > 0);
        if (paras.length > 0) return paras;
    }

    // Double-newline paragraphs first
    let paras = text.split(/\n\s*\n|\r\n\s*\r\n/).filter(p => p.trim().length > 20);
    if (paras.length > 1) return paras;

    // Single newlines — group into blocks of 5 lines
    const lines = text.split(/\n/).filter(l => l.trim().length > 0);
    if (lines.length > 3) {
        const blocks = [];
        for (let i = 0; i < lines.length; i += 5) {
            blocks.push(lines.slice(i, Math.min(i + 5, lines.length)).join('\n'));
        }
        return blocks;
    }

    // Sentence-based splitting
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);
    if (sentences.length > 1) {
        const windows = [];
        for (let i = 0; i < sentences.length; i += 2) {
            windows.push(sentences.slice(i, Math.min(i + 3, sentences.length)).join(' '));
        }
        return windows;
    }

    // Last resort: fixed-size chunks
    const chunks = [];
    for (let i = 0; i < text.length; i += 400) {
        chunks.push(text.substring(i, Math.min(i + 500, text.length)));
    }
    return chunks;
}

// ===================================================================
// 6. FILE PRIORITIZER — Search likely files first
// ===================================================================

function prioritizeFiles(files, query) {
    const kwSet = new Set(query.keywords.map(k => k.toLowerCase()));
    const scored = files.map(f => {
        const nameLower = f.name.toLowerCase();
        let priority = 0;

        // Boost files whose name matches query keywords
        for (const kw of kwSet) {
            if (nameLower.includes(kw)) priority += 3;
        }

        // Boost by query type
        if (query.type === 'CONTACT' && /contact|phone|address|email|people|directory/i.test(nameLower)) priority += 5;
        if (query.type === 'SCHEDULE' && /schedule|timetable|class|lecture|calendar/i.test(nameLower)) priority += 5;

        // Learned profile boost from past content reads.
        const fileId = getFileIdentity(f);
        const profile = _learningProfiles.get(fileId);
        if (profile?.keywords?.length) {
            for (const kw of kwSet) {
                if (profile.keywords.includes(kw)) priority += 2;
            }
        }

        // Boost text-readable formats over others
        const ext = (f.ext || '').toLowerCase();
        if (TEXT_EXTS.has(ext) || PDF_EXTS.has(ext)) priority += 1;
        if (ext === 'pdf') priority += 1; // PDFs often have rich content

        return { ...f, _priority: priority };
    });
    scored.sort((a, b) => b._priority - a._priority);
    return scored;
}

// ===================================================================
// 7. RESULT FORMATTER — Rich answers with file paths
// ===================================================================

function highlightKeywords(text, keywords) {
    let result = text;
    for (const kw of keywords) {
        const regex = new RegExp(`\\b(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi');
        result = result.replace(regex, '**$1**');
    }
    return result;
}

const DATE_PATTERN = /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?)\b/i;
const VALUE_PATTERN = /\b(?:[$\u20AC\u00A3\u20B9])?\d+(?:[.,]\d+)?\b/;
const LOCATION_PATTERN = /\b(address|located|location|city|state|country|street|road|avenue|district|area|campus|building|room)\b/i;
const DOB_SIGNAL_PATTERN = /\b(?:dob|date\s+of\s+birth|birth\s*date|birthday|born)\b/i;
const AGE_INLINE_PATTERN = /\b(?:age|aged)\s*[:\-]?\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:years?\s*old|yrs?\s*old|y\/o|yo)\b/i;
const DOB_CANDIDATE_PATTERN = /\b(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4})\b/gi;
const MONTH_LOOKUP = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
};

function inferQuestionMode(query = {}) {
    const q = String(query.raw || query.target || '').trim().toLowerCase();
    const operation = query.operation || '';

    if (query.type === 'AGE_LOOKUP') return 'age';
    if (query.type === 'DOB_LOOKUP') return 'dob';

    if (operation === 'total' || operation === 'count') return 'count';
    if (operation === 'list') return 'list';
    if (operation === 'summary') return 'summary';
    if (operation === 'compare') return 'compare';
    if (operation === 'procedure') return 'procedure';
    if (operation === 'time') return 'time';
    if (operation === 'location') return 'location';
    if (operation === 'person') return 'person';
    if (operation === 'definition') return 'definition';
    if (operation === 'reason') return 'reason';

    if (/\b(how\s+old|current\s+age|my\s+age)\b/i.test(q)) return 'age';
    if (/\b(dob|date\s+of\s+birth|birthday|born)\b/i.test(q)) return 'dob';
    if (/^(what\s+is|define|meaning\s+of)/i.test(q)) return 'definition';
    if (/^who\b/i.test(q)) return 'person';
    if (/^when\b/i.test(q)) return 'time';
    if (/^where\b/i.test(q)) return 'location';
    if (/^how\s+(many|much)\b/i.test(q) || /\b(total|count)\b/i.test(q)) return 'count';
    if (/^(list|which|what\s+are)\b/i.test(q) || /\b(all|items)\b/i.test(q)) return 'list';
    if (/^how\s+(to|do|can)\b/i.test(q)) return 'procedure';
    return 'general';
}

function getPrimaryQuerySubject(query = {}) {
    let subject = String(query?.target || query?.raw || '')
        .toLowerCase()
        .trim();

    subject = subject
        .replace(/^(what\s+is|what\s+are|define|meaning\s+of)\s+/i, '')
        .replace(/^(the|a|an)\s+/i, '')
        .trim();

    const tokens = extractKeywords(subject).filter(isSearchSignalToken);
    if (tokens.length === 0) return '';
    return tokens.slice(0, 6).join(' ');
}

function queryWantsAimLine(query = {}) {
    const raw = String(query?.raw || query?.target || '').toLowerCase();
    if (/\b(?:aim|objective)\b/.test(raw)) return true;
    return (query?.keywords || []).some(token => /^(aim|objective)$/.test(String(token || '').toLowerCase()));
}

function extractNumericQueryTokens(query = {}) {
    return [...new Set(
        [
            ...extractKeywords(query?.target || query?.raw || ''),
            ...(Array.isArray(query?.keywords) ? query.keywords : []),
        ]
            .map(token => String(token || '').trim().toLowerCase())
            .filter(token => /^\d{1,4}$/.test(token)),
    )];
}

function scoreSentenceForQuery(sentence, query, mode = 'general') {
    if (!sentence) return 0;
    const lower = sentence.toLowerCase();
    let score = 0;

    for (const kw of query.keywords || []) {
        const escaped = escapeRegExp(kw);
        const pattern = new RegExp('\\b' + escaped + '\\b', 'i');
        if (pattern.test(lower)) score += 2;
    }

    if ((query.target || '').trim()) {
        const target = query.target.toLowerCase().trim();
        if (target && lower.includes(target)) score += 3;
    }

    if (mode === 'definition') {
        const subject = getPrimaryQuerySubject(query);
        if (subject && lower.includes(subject)) score += 2.5;
        if (subject) {
            if (lower.includes(`${subject} is`) || lower.includes(`${subject} are`)) score += 3.5;
            if (lower.includes(`${subject} means`) || lower.includes(`${subject} refers to`)) score += 3;
        }
    }

    if (mode === 'time' && DATE_PATTERN.test(sentence)) score += 2.5;
    if (mode === 'location' && LOCATION_PATTERN.test(sentence)) score += 2.5;
    if (mode === 'count' && VALUE_PATTERN.test(sentence)) score += 2;
    if (mode === 'person' && /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/.test(sentence)) score += 1.5;
    if (mode === 'definition' && /\b(is|are|means|refers to)\b/i.test(sentence)) score += 1.5;
    if (mode === 'procedure' && /\b(step|first|then|next|finally)\b/i.test(sentence)) score += 1.5;
    if (mode === 'age' && AGE_INLINE_PATTERN.test(sentence)) score += 3;
    if (mode === 'age' && DOB_SIGNAL_PATTERN.test(sentence) && DATE_PATTERN.test(sentence)) score += 2.5;
    if (mode === 'dob' && DATE_PATTERN.test(sentence)) score += 2;
    if (mode === 'dob' && DOB_SIGNAL_PATTERN.test(sentence)) score += 2.5;

    const numericTokens = extractNumericQueryTokens(query);
    if (numericTokens.length > 0) {
        for (const token of numericTokens) {
            const tokenPattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
            if (tokenPattern.test(sentence)) score += 2;
        }
    }

    if (queryWantsAimLine(query)) {
        if (/\b(?:aim|objective)\b/i.test(sentence)) score += 3.5;
        if (/^\s*(?:aim|objective)\s*[:\-]/i.test(sentence)) score += 1.2;
    }

    if (/[0-9]/.test(lower)) score += 0.5;
    if (sentence.length >= 35 && sentence.length <= 220) score += 0.75;
    if (sentence.length > 280) score -= 0.5;

    return score;
}

function extractCandidateSentences(paragraph) {
    const normalized = (paragraph || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    const sentences = normalized
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length >= 20);
    return sentences.length > 0 ? sentences : [normalized.substring(0, 240)];
}

function pickBestEvidenceSentence(paragraph, query, mode) {
    const sentences = extractCandidateSentences(paragraph);
    if (sentences.length === 0) return '';

    const signaled = sentences.filter(sentence => hasStrongQuerySignal(sentence, query));
    let candidates = signaled.length > 0 ? signaled : sentences;
    if (queryWantsAimLine(query)) {
        const aimCandidates = candidates.filter(sentence => /\b(?:aim|objective)\b/i.test(sentence));
        if (aimCandidates.length > 0) {
            candidates = aimCandidates;
        }
        const numericTokens = extractNumericQueryTokens(query);
        if (numericTokens.length > 0) {
            const experimentAligned = candidates.filter((sentence) =>
                numericTokens.some((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i').test(sentence)),
            );
            if (experimentAligned.length > 0) {
                candidates = experimentAligned;
            }
        }
    }

    let bestSentence = candidates[0];
    let bestScore = scoreSentenceForQuery(bestSentence, query, mode);

    for (let i = 1; i < candidates.length; i++) {
        const candidate = candidates[i];
        const score = scoreSentenceForQuery(candidate, query, mode);
        if (score > bestScore) {
            bestSentence = candidate;
            bestScore = score;
        }
    }

    return bestSentence;
}

function getMinimumEvidenceSentenceScore(query = {}, mode = 'general') {
    if (query?.type === 'AGE_LOOKUP' || query?.type === 'DOB_LOOKUP' || mode === 'age' || mode === 'dob') {
        return 2.5;
    }

    const strictKeywords = extractKeywords(query?.target || query?.raw || '');
    if (strictKeywords.length >= 5) return 3.2;
    if (strictKeywords.length >= 3) return 2.7;
    if (strictKeywords.length >= 2) return 2.2;
    return 1.5;
}

function getStrictQueryTokens(query = {}) {
    return [...new Set(
        extractKeywords(query?.target || query?.raw || '')
            .map(token => String(token || '').toLowerCase().trim())
            .filter(isSearchSignalToken),
    )];
}

function countCoveredQueryTokens(text, tokens = []) {
    const source = String(text || '').toLowerCase();
    if (!source || !Array.isArray(tokens) || tokens.length === 0) return 0;

    let hits = 0;
    for (const token of tokens) {
        const escaped = escapeRegExp(token);
        const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
        if (pattern.test(source)) hits += 1;
    }
    return hits;
}

function parseNumericToken(token) {
    if (!token) return null;
    const cleaned = token
        .replace(/[$₹€,?\s]/g, '')
        .replace(/[^\d.\-]/g, '');
    if (!cleaned) return null;
    const value = Number.parseFloat(cleaned);
    return Number.isFinite(value) ? value : null;
}

function normalizeYearNumber(year) {
    const numericYear = Number(year);
    if (!Number.isFinite(numericYear)) return null;
    if (numericYear >= 100) return numericYear;
    return numericYear >= 40 ? (1900 + numericYear) : (2000 + numericYear);
}

function buildValidDate(year, month, day) {
    if (![year, month, day].every(Number.isFinite)) return null;
    if (year < 1900 || year > new Date().getFullYear() + 1) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year
        || (date.getMonth() + 1) !== month
        || date.getDate() !== day
    ) {
        return null;
    }

    return date;
}

function parseDateCandidate(candidate) {
    const cleaned = String(candidate || '')
        .replace(/,/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned) return null;

    const numeric = cleaned.match(/^(\d{1,4})[\/.-](\d{1,2})[\/.-](\d{1,4})$/);
    if (numeric) {
        const p1 = Number(numeric[1]);
        const p2 = Number(numeric[2]);
        const p3 = Number(numeric[3]);

        if (numeric[1].length === 4) {
            return buildValidDate(p1, p2, p3);
        }

        const year = normalizeYearNumber(p3);
        if (!year) return null;

        const dayMonth = buildValidDate(year, p2, p1);
        const monthDay = buildValidDate(year, p1, p2);

        if (dayMonth && monthDay) return dayMonth;
        return dayMonth || monthDay;
    }

    const dayMonthName = cleaned.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{2,4})$/);
    if (dayMonthName) {
        const day = Number(dayMonthName[1]);
        const month = MONTH_LOOKUP[dayMonthName[2].toLowerCase()];
        const year = normalizeYearNumber(dayMonthName[3]);
        if (!month || !year) return null;
        return buildValidDate(year, month, day);
    }

    const monthNameDay = cleaned.match(/^([a-zA-Z]+)\s+(\d{1,2})\s+(\d{2,4})$/);
    if (monthNameDay) {
        const month = MONTH_LOOKUP[monthNameDay[1].toLowerCase()];
        const day = Number(monthNameDay[2]);
        const year = normalizeYearNumber(monthNameDay[3]);
        if (!month || !year) return null;
        return buildValidDate(year, month, day);
    }

    const parsed = new Date(cleaned);
    if (!Number.isNaN(parsed.getTime())) {
        return buildValidDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
    }

    return null;
}

function computeCurrentAgeFromDob(dobDate, now = new Date()) {
    if (!(dobDate instanceof Date) || Number.isNaN(dobDate.getTime())) return null;
    if (dobDate > now) return null;

    let age = now.getFullYear() - dobDate.getFullYear();
    const monthDiff = now.getMonth() - dobDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dobDate.getDate())) {
        age -= 1;
    }

    if (!Number.isFinite(age) || age < 0 || age > 120) return null;
    return age;
}

function extractExplicitAgeFromText(text) {
    const sourceText = String(text || '');
    const match = sourceText.match(AGE_INLINE_PATTERN);
    if (!match) return null;

    const value = Number(match[1] || match[2]);
    if (!Number.isFinite(value) || value <= 0 || value > 120) return null;
    return Math.round(value);
}

function extractDobDateFromText(text) {
    const sourceText = String(text || '');
    if (!sourceText.trim()) return null;

    const candidates = [];
    DOB_CANDIDATE_PATTERN.lastIndex = 0;
    let match;

    while ((match = DOB_CANDIDATE_PATTERN.exec(sourceText)) !== null) {
        const parsedDate = parseDateCandidate(match[0]);
        if (!parsedDate) continue;

        const age = computeCurrentAgeFromDob(parsedDate);
        if (age === null) continue;

        candidates.push(parsedDate);
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.getTime() - b.getTime());
    return candidates[0];
}

function formatDateForAnswer(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

function getAgeSubjectLabels(query = {}) {
    if (query.subjectIsSelf || !query.subject || /^me$/i.test(query.subject)) {
        return { subject: 'you', possessive: 'your' };
    }

    const subject = normalizeSubjectText(query.subject);
    if (!subject) return { subject: 'this person', possessive: "this person's" };

    const possessive = subject.endsWith('s') ? (subject + "'") : (subject + "'s");
    return { subject, possessive };
}

function synthesizeAgeOrDobAnswer(evidence, query = {}) {
    if (!Array.isArray(evidence) || evidence.length === 0) return '';

    const labels = getAgeSubjectLabels(query);
    const now = new Date();
    let bestAge = null;
    let bestDob = null;

    for (const item of evidence) {
        const candidateTexts = [item.sentence, item.paragraph]
            .map(value => String(value || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean);

        for (const candidateText of candidateTexts) {
            const baseScore = Number(item.score) || 0;
            const hasDobSignal = DOB_SIGNAL_PATTERN.test(candidateText);

            const explicitAge = extractExplicitAgeFromText(candidateText);
            if (explicitAge !== null) {
                const ageScore = baseScore + 2 + (hasDobSignal ? 0.5 : 0);
                if (!bestAge || ageScore > bestAge.score) {
                    bestAge = {
                        age: explicitAge,
                        score: ageScore,
                        fileName: item.fileName,
                    };
                }
            }

            const dobDate = extractDobDateFromText(candidateText);
            if (dobDate) {
                let dobScore = baseScore + (hasDobSignal ? 2.5 : 0.8);
                if (query.subject && candidateText.toLowerCase().includes(query.subject.toLowerCase())) {
                    dobScore += 0.8;
                }

                if (!bestDob || dobScore > bestDob.score) {
                    bestDob = {
                        dob: dobDate,
                        score: dobScore,
                        fileName: item.fileName,
                    };
                }
            }
        }
    }

    if (query.type === 'DOB_LOOKUP') {
        if (bestDob) {
            return 'Based on your files, ' + labels.possessive + ' date of birth appears to be **' + formatDateForAnswer(bestDob.dob) + '**.';
        }
        if (bestAge) {
            return 'I found ' + labels.possessive + ' age in your files as **' + bestAge.age + ' years**, but no explicit date of birth entry.';
        }
        return '';
    }

    if (query.type === 'AGE_LOOKUP') {
        if (bestAge) {
            return 'Based on your files, ' + labels.possessive + ' current age is **' + bestAge.age + ' years**.';
        }
        if (bestDob) {
            const computedAge = computeCurrentAgeFromDob(bestDob.dob, now);
            if (Number.isFinite(computedAge)) {
                const copula = query.subjectIsSelf ? 'are' : 'is';
                return 'Based on ' + labels.possessive + ' date of birth **' + formatDateForAnswer(bestDob.dob) + '** found in your files, ' + labels.subject + ' ' + copula + ' **' + computedAge + ' years** old (as of ' + formatDateForAnswer(now) + ').';
            }
        }
    }

    return '';
}

function synthesizeAnswerText(evidence, mode, query = {}) {
    if (evidence.length === 0) return '';

    if (query.type === 'AGE_LOOKUP' || query.type === 'DOB_LOOKUP' || mode === 'age' || mode === 'dob') {
        const ageOrDobAnswer = synthesizeAgeOrDobAnswer(evidence, query);
        if (ageOrDobAnswer) return ageOrDobAnswer;
    }

    if (queryWantsAimLine(query)) {
        const exactAim = evidence.find(item => /^\s*(?:aim|objective)\s*[:\-]/i.test(item.sentence))
            || evidence.find(item => /\b(?:aim|objective)\b/i.test(item.sentence));
        if (exactAim) return exactAim.sentence;
    }

    if (mode === 'list') {
        const items = evidence
            .slice(0, 5)
            .map(item => `- ${item.sentence}`)
            .join('\n');
        return `I found these relevant items:\n${items}`;
    }

    if (mode === 'count') {
        const values = [];
        for (const item of evidence) {
            const matches = item.sentence.match(/\b(?:[$\u20AC\u00A3\u20B9])?\d+(?:[.,]\d+)?\b/g);
            if (matches) values.push(...matches);
        }
        if (query.operation === 'total') {
            const numeric = values
                .map(parseNumericToken)
                .filter(v => Number.isFinite(v) && v >= 0);
            if (numeric.length > 0 && numeric.length <= 20) {
                const total = numeric.reduce((sum, v) => sum + v, 0);
                const rounded = Math.round(total * 100) / 100;
                return `From the values mentioned in your files, the computed total is **${rounded}**.`;
            }
        }
        const uniqueValues = [...new Set(values)].slice(0, 4);
        if (uniqueValues.length > 0) {
            return `Based on your files, the key values I found are: ${uniqueValues.join(', ')}. ${evidence[0].sentence}`;
        }
    }

    if (mode === 'time') {
        const dated = evidence.find(item => DATE_PATTERN.test(item.sentence));
        if (dated) return dated.sentence;
    }

    if (mode === 'location') {
        const located = evidence.find(item => LOCATION_PATTERN.test(item.sentence));
        if (located) return located.sentence;
    }

    if (mode === 'compare') {
        const first = evidence[0]?.sentence || '';
        const second = evidence[1]?.sentence || '';
        if (first && second) {
            return `I found two main points to compare:\n- ${first}\n- ${second}`;
        }
    }

    if (mode === 'summary') {
        const summary = evidence.slice(0, 3).map(item => item.sentence).join(' ');
        return `Summary from your files: ${summary}`;
    }

    if (mode === 'procedure') {
        const steps = evidence
            .slice(0, 4)
            .map((item, idx) => `${idx + 1}. ${item.sentence}`)
            .join('\n');
        if (steps) return `Steps I found in your files:\n${steps}`;
    }

    const combined = evidence.slice(0, 3).map(item => item.sentence).join(' ');
    return combined.length > 560 ? `${combined.substring(0, 557).trimEnd()}...` : combined;
}

function computeOfflineConfidence(evidence = [], query = {}) {
    if (!Array.isArray(evidence) || evidence.length === 0) return 0;
    const maxScore = Math.max(...evidence.map(item => Number(item.score) || 0), 0.01);
    const topScore = Number(evidence[0]?.score || 0);
    const topNormalized = Math.min(1, topScore / maxScore);

    const keyTokens = normalizeKeywordVariants(query?.keywords || []).filter(Boolean);
    let covered = 0;
    const joinedEvidence = evidence.slice(0, 4).map(item => String(item.sentence || '').toLowerCase()).join(' ');
    for (const token of keyTokens) {
        if (joinedEvidence.includes(token.toLowerCase())) covered += 1;
    }
    const coverage = keyTokens.length > 0 ? (covered / keyTokens.length) : 1;
    const depthBoost = Math.min(1, evidence.length / 4);
    const score = (topNormalized * 0.45) + (coverage * 0.4) + (depthBoost * 0.15);
    return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

function buildContextualAnswerSection(contentRows, query) {
    if (!contentRows || contentRows.length === 0) return null;

    const mode = inferQuestionMode(query);
    const evidence = [];
    const seenSentence = new Set();
    const minSentenceScore = getMinimumEvidenceSentenceScore(query, mode);
    const strictTokens = getStrictQueryTokens(query);

    for (const row of contentRows.slice(0, 8)) {
        if (!hasStrongQuerySignal(row.paragraph, query)) continue;
        const sentence = pickBestEvidenceSentence(row.paragraph, query, mode);
        if (!sentence) continue;

        const normalized = sentence.replace(/\s+/g, ' ').trim();
        if (!normalized) continue;
        const sentenceScore = scoreSentenceForQuery(normalized, query, mode);
        if (sentenceScore < minSentenceScore) continue;

        const dedupeKey = normalized.toLowerCase();
        if (seenSentence.has(dedupeKey)) continue;
        seenSentence.add(dedupeKey);

        evidence.push({
            fileName: row.fileName,
            path: row.path || '',
            sentence: normalized,
            paragraph: row.paragraph || normalized,
            score: Number.isFinite(row.rerankScore) ? row.rerankScore : (row.score || 0),
            sentenceScore,
        });
    }

    if (evidence.length === 0) return null;

    evidence.sort((a, b) => b.score - a.score);
    const synthesized = synthesizeAnswerText(evidence, mode, query);
    if (!synthesized) return null;
    const confidence = computeOfflineConfidence(evidence, query);

    const sourceLines = evidence
        .slice(0, 3)
        .map((item, idx) => {
            const normalizedPath = normalizeDisplayPath(item.path, item.fileName);
            const location = normalizedPath ? `${normalizedPath}/${item.fileName}` : item.fileName;
            const sentence = item.sentence.length > 180 ? `${item.sentence.substring(0, 177)}...` : item.sentence;
            return `[${idx + 1}] ${item.fileName} @ ${location}: ${sentence}`;
        })
        .join('\n');

    const strictKeywordCount = extractKeywords(query?.target || query?.raw || '').length;
    const requiredConfidence = strictKeywordCount >= 4 ? 58 : 45;
    const topSentenceScore = Number(evidence[0]?.sentenceScore || 0);
    const synthesizedCoverageHits = countCoveredQueryTokens(synthesized, strictTokens);
    const evidenceCoverageHits = countCoveredQueryTokens(evidence[0]?.sentence || '', strictTokens);
    const requiredCoverageHits = strictTokens.length >= 4 ? 2 : (strictTokens.length >= 2 ? 1 : 0);
    const coverageWeak = requiredCoverageHits > 0
        && synthesizedCoverageHits < requiredCoverageHits
        && evidenceCoverageHits < requiredCoverageHits;
    const shouldSuppressSynthesis = confidence < requiredConfidence
        || topSentenceScore < minSentenceScore
        || coverageWeak;

    if (shouldSuppressSynthesis) {
        const closest = evidence[0]?.sentence || '';
        return {
            text: [
                '**Answer (generated offline from local files)**',
                'I found related local evidence, but I cannot verify a precise final answer yet.',
                closest ? `Closest verified evidence: ${highlightKeywords(closest, query.keywords || [])}` : '',
                '',
                `**Confidence:** ${confidence}%`,
                '',
                '**Evidence Used**',
                sourceLines,
            ].filter(Boolean).join('\n'),
            synthesized: closest || '',
            evidence,
            confidence,
        };
    }

    return {
        text: [
            '**Answer (generated offline from local files)**',
            highlightKeywords(synthesized, query.keywords || []),
            '',
            `**Confidence:** ${confidence}%`,
            '',
            '**Evidence Used**',
            sourceLines,
        ].join('\n'),
        synthesized,
        evidence,
        confidence,
    };
}

function formatResults(results, query) {
    if (results.length === 0) return null;

    const sortedResults = [...results].sort(compareSearchResults);
    const top = sortedResults.slice(0, 8);

    // Contact-specific formatting
    if (query.type === 'CONTACT') {
        const phones = [];
        const emails = [];
        const sources = new Set();

        for (const r of top) {
            const text = r.paragraph;
            const phoneMatches = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/g);
            if (phoneMatches) phones.push(...phoneMatches);
            const emailMatches = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g);
            if (emailMatches) emails.push(...emailMatches);
            sources.add(r.fileName);
        }

        if (phones.length > 0 || emails.length > 0) {
            let answer = `Here's what I found for **${query.target}**:\n\n`;
            if (phones.length > 0) answer += `Phone: ${[...new Set(phones)].join(', ')}\n`;
            if (emails.length > 0) answer += `Email: ${[...new Set(emails)].join(', ')}\n`;
            answer += `\n_Found in: ${[...sources].join(', ')}_`;
            return answer;
        }
    }

    // Pattern-specific formatting
    if (query.type === 'PATTERN') {
        const matches = [];
        const sources = new Set();
        for (const r of top) {
            if (query.patterns) {
                for (const pattern of query.patterns) {
                    pattern.lastIndex = 0;
                    const m = r.paragraph.match(pattern);
                    if (m) { matches.push(...m); sources.add(r.fileName); }
                }
            }
        }
        if (matches.length > 0) {
            return `Here's the **${query.target}** information I found:\n\n${[...new Set(matches)].join(', ')}\n\n_Found in: ${[...sources].join(', ')}_`;
        }
    }

    const toBlocks = (rows) => {
        const seen = new Set();
        const blocks = [];

        for (const row of rows) {
            const rawText = row.matchType === 'filename'
                ? `File: ${row.fileName} (matched by filename)`
                : (row.paragraph || '');
            const cleanText = rawText.replace(/\s+/g, ' ').trim().substring(0, 500);
            if (!cleanText) continue;

            const dedupeKey = `${row.fileName}|${cleanText.substring(0, 80)}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            const highlighted = highlightKeywords(cleanText, query.keywords);
            const fileLine = `File: **${row.fileName}**`;
            const normalizedPath = normalizeDisplayPath(row.path, row.fileName);
            const pathLine = normalizedPath ? `\nPath: _${normalizedPath}/${row.fileName}_` : '';

            // Carry metadata so the opener can jump to the exact chunk without re-searching.
            const openParams = new URLSearchParams();
            if (row.fileId) openParams.set('id', String(row.fileId));
            openParams.set('name', String(row.fileName || ''));
            if (row.chunkHash) openParams.set('chunk', row.chunkHash);
            if (Number.isFinite(row.chunkIndex)) openParams.set('chunkIndex', String(row.chunkIndex));
            const needle = (query.target || query.raw || '').trim();
            if (needle) openParams.set('q', needle.substring(0, 160));
            const snippetForLink = cleanText.substring(0, 420);
            if (snippetForLink) openParams.set('snippet', snippetForLink.replace(/\s+/g, ' '));
            const openUrl = `/__nice_open_file__?${openParams.toString()}`;
            const openHint = `\n[Open this file in app](${openUrl})\n_Hint: say "open file ${row.fileName}" to view this file_`;

            blocks.push(`${fileLine}${pathLine}\n\n> ${highlighted}${openHint}`);
        }

        return blocks;
    };

    const contentRows = sortedResults.filter(r => r.matchType !== 'filename').slice(0, 8);
    const filenameRows = sortedResults.filter(r => r.matchType === 'filename').slice(0, 5);
    const contextualAnswer = buildContextualAnswerSection(contentRows, query);

    const contentBlocks = toBlocks(contentRows);
    const filenameBlocks = toBlocks(filenameRows);

    if (contentBlocks.length === 0 && filenameBlocks.length === 0) return null;

    const header = query.type === 'DEFINITION'
        ? `**${query.target}**\n\n`
        : `Here's what I found about **${query.target}**:\n\n`;

    const sections = [];
    if (contextualAnswer) {
        sections.push(contextualAnswer.text);
        try {
            ingestSearchEvidence({
                question: query.raw || query.target || '',
                answer: contextualAnswer.synthesized || '',
                confidence: contextualAnswer.confidence || 0,
                evidence: contextualAnswer.evidence || [],
            });
        } catch {
            // Graph writes are best-effort only.
        }
    }
    if (contentBlocks.length > 0) {
        sections.push(contentBlocks.join('\n\n---\n\n'));
    }
    if (filenameBlocks.length > 0) {
        const filenameSection = contentBlocks.length > 0
            ? `**Filename Matches**\n\n${filenameBlocks.join('\n\n---\n\n')}`
            : filenameBlocks.join('\n\n---\n\n');
        sections.push(filenameSection);
    }

    return header + sections.join('\n\n---\n\n');
}

// ===================================================================
// 8. MAIN SEARCH API — Batched parallel, zero-copy
// ===================================================================

let _searchSequence = 0;
let _searchCancelGeneration = 0;
const _activeSearchSessions = new Set();
const _cancelledSearchSessions = new Set();
let _activeSearchSlotCount = 0;
const _searchSlotWaiters = [];

async function acquireSearchSlot(progressCb = null) {
    const maxConcurrent = Math.max(1, getMaxConcurrentSearches());
    if (_activeSearchSlotCount < maxConcurrent) {
        _activeSearchSlotCount += 1;
        return;
    }

    if (typeof progressCb === 'function') {
        progressCb('queued', _searchSlotWaiters.length + 1, maxConcurrent, {
            text: 'Search queue is busy, waiting for an available slot...',
        });
    }

    await new Promise(resolve => {
        _searchSlotWaiters.push(resolve);
    });
    _activeSearchSlotCount += 1;
}

function releaseSearchSlot() {
    _activeSearchSlotCount = Math.max(0, _activeSearchSlotCount - 1);
    const next = _searchSlotWaiters.shift();
    if (next) next();
}

function beginSearchSession() {
    const searchId = `search-${Date.now()}-${++_searchSequence}`;
    const cancelGeneration = _searchCancelGeneration;
    _activeSearchSessions.add(searchId);
    return { searchId, cancelGeneration };
}

function isSearchCancelled(searchId, cancelGeneration) {
    return _cancelledSearchSessions.has(searchId) || cancelGeneration !== _searchCancelGeneration;
}

function endSearchSession(searchId) {
    _activeSearchSessions.delete(searchId);
    _cancelledSearchSessions.delete(searchId);
}

/**
 * Search through all files for an answer.
 * - Auto-grants file access if none indexed
 * - Processes files in batches of 3 (RAM-efficient)
 * - Returns formatted answer with file paths
 */
export async function searchForAnswer(question, opts = {}) {
    const forceFullScan = typeof opts === 'function' ? true : opts.forceFullScan !== false;
    const normalizedOpts = typeof opts === 'function'
        ? {
            useEmbeddingsRerank: true,
            bm25CandidateLimit: 40,
            rerankTopK: 8,
            fullScanThrottleMs: 1,
            includeFilenameFallback: 'always',
            forceFullScan,
            progressCb: opts,
        }
        : {
            useEmbeddingsRerank: opts.useEmbeddingsRerank !== false,
            bm25CandidateLimit: opts.bm25CandidateLimit || 40,
            rerankTopK: opts.rerankTopK || 8,
            fullScanThrottleMs: Math.max(0, Number(opts.fullScanThrottleMs || 0)),
            includeFilenameFallback: ['always', 'ifNoContent', 'never'].includes(opts.includeFilenameFallback)
                ? opts.includeFilenameFallback
                : 'always',
            forceFullScan,
            progressCb: typeof opts.progressCb === 'function' ? opts.progressCb : null,
        };

    let query = parseQuery(question);
    query = enhanceWithContext(query);
    // Precompile regex/keyword metadata once per query to reduce per-paragraph overhead.
    getPreparedKeywordMeta(query);
    let files = getReadableFiles();

    // If no readable files, check if we have indexed files at all
    if (files.length === 0) {
        // Don't auto-pop file picker during search — guide user instead
        const indexed = getIndexedFileCount();
        if (indexed > 0) {
            // Files are indexed but missing handles/capacitorPath — need rescan
            try {
                const rescan = await autoRescanFromSavedHandle();
                if (rescan.success) {
                    files = getReadableFiles();
                }
            } catch { /* rescan failed */ }
        }

        if (files.length === 0) {
            return 'I do not have access to your files yet. Say **"scan my files"** to grant access, then ask me again.';
        }
    }

    // Search every indexed/readable file for complete coverage.
    // Content extraction still only runs for supported formats, while other formats
    // can contribute filename matches and total scan visibility.
    const searchable = [...files];

    if (searchable.length === 0) {
        return 'I found files but none are readable documents. Try saying **"scan my files"** to re-index.';
    }

    // Prioritize files whose names match the query
    const prioritized = prioritizeFiles(searchable, query);

    await acquireSearchSlot(normalizedOpts.progressCb);
    const { searchId, cancelGeneration } = beginSearchSession();

    const contentMatches = [];
    const filenameMatches = [];
    let filesSearched = 0;
    let highConfidenceFound = false;
    let unreadableFiles = 0;
    let lastPreviewTs = 0;
    let lastScanProgressTs = 0;

    try {
        // --- QUERY CACHE CHECK ---
        // If the exact same keywords have been searched recently, return instantly
        const indexSignature = buildIndexSignature(searchable);
        const cacheKey = buildQueryCacheKey({
            query,
            normalizedOpts,
            indexSignature,
        });
        if (_queryCache.has(cacheKey)) {
            const cached = _queryCache.get(cacheKey);
            if (Date.now() - cached.ts < QUERY_CACHE_TTL) {
                console.log('[Nice] Search served from query cache instantly');
                return formatResults(cached.results, query);
            }
            _queryCache.delete(cacheKey);
        }

    // PRE-FILTERING: Prioritize files whose names match keywords, but NEVER drop files
    let searchQueue = [...prioritized];
    if (query.keywords.length > 0) {
        const nameMatches = searchQueue.filter(f =>
            query.keywords.some(kw => f.nameLower.includes(kw.toLowerCase()))
        );
        const others = searchQueue.filter(f => !nameMatches.includes(f));

        // Search matches first, then others (guaranteeing no files are lost)
        searchQueue = [...nameMatches, ...others];
    }

    // Adaptive worker pool: keep concurrency bounded on Android/heavy files while
    // avoiding batch barriers that delay completion on mixed-size files.
    const BATCH_SIZE = getSearchBatchSize(searchQueue);
    const normalizedKeywordList = [...new Set(
        getPreparedKeywordMeta(query)
            .map(meta => String(meta?.token || '').toLowerCase().trim())
            .filter(isSearchSignalToken),
    )];
    const targetNeedle = String(query.target || query.raw || '').toLowerCase().trim();

    if (normalizedOpts.progressCb) {
        normalizedOpts.progressCb('start', 0, searchQueue.length, {
            query: query.target || query.raw,
        });
    }

    const workerCount = Math.max(1, Math.min(BATCH_SIZE, searchQueue.length));
    const candidateCaps = getSearchCandidateCaps();
    const contentCandidateCap = Math.max(
        normalizedOpts.bm25CandidateLimit * 3,
        candidateCaps.contentCap,
    );
    const filenameCandidateCap = candidateCaps.filenameCap;
    let nextQueueIndex = 0;

    const maybeEmitProgress = (activeFileName = '') => {
        if (!normalizedOpts.progressCb) return;
        const now = Date.now();
        const isComplete = filesSearched >= searchQueue.length;
        if (isComplete || (now - lastScanProgressTs) > 180) {
            lastScanProgressTs = now;
            normalizedOpts.progressCb('scan', filesSearched, searchQueue.length, activeFileName);
        }
    };

    const maybeEmitPreview = () => {
        if (!normalizedOpts.progressCb || contentMatches.length === 0) return;
        const now = Date.now();
        if (now - lastPreviewTs <= 700) return;

        lastPreviewTs = now;
        const previewMatch = contentMatches.reduce((best, current) => {
            if (!best) return current;
            return (current.score || 0) > (best.score || 0) ? current : best;
        }, null);
        if (!previewMatch?.paragraph) return;

        const previewText = previewMatch.paragraph.substring(0, 180).trim();
        normalizedOpts.progressCb('preview', filesSearched, searchQueue.length, {
            text: `Found a strong match in **${previewMatch.fileName}**\n\n> ${previewText}${previewMatch.paragraph.length > 180 ? '...' : ''}`,
        });
    };

    const processEntry = async (entry) => {
        if (isSearchCancelled(searchId, cancelGeneration)) return null;

        const text = await readFileTextWithRetry(entry);
        if (!text) unreadableFiles++;
        const fileVersion = buildContentVersion(text, entry);
        rememberFileLearningProfile(entry, fileVersion, text);
        const analysis = text ? getCachedTextAnalysis(entry, text, fileVersion) : null;

        const matches = [];

        // --- Filename-based fallback ---
        // If content can't be read, still match by filename.
        const nameLower = (entry.nameLower || entry.name.toLowerCase());
        const nameWithoutExt = nameLower.replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' ');
        let nameScore = 0;
        for (const kw of query.keywords) {
            if (nameWithoutExt.includes(kw.toLowerCase())) nameScore += 3;
            else if (nameLower.includes(kw.toLowerCase())) nameScore += 2;
        }
        if (normalizedOpts.includeFilenameFallback !== 'never' && nameScore > 0) {
            matches.push({
                paragraph: `File: **${entry.name}** (matched by filename)`,
                score: nameScore,
                matchType: 'filename',
                fileName: entry.name,
                path: entry.path || '',
                fileId: entry.id || `${entry.path || ''}/${entry.name || ''}`,
                fileVersion,
                chunkIndex: -1,
                chunkHash: hashChunkText(entry.name || ''),
            });
        }

        // --- Content-based search ---
        if (text && text.trim().length >= 10) {
            // Fast precheck: if query tokens are absent in full text, skip expensive paragraph scoring.
            const lowerText = analysis?.lowerText || text.toLowerCase();
            const paragraphs = analysis?.paragraphs || splitIntoParagraphs(text, entry?.ext, entry?.name);
            const hasKeywordSignal = normalizedKeywordList.length === 0
                || normalizedKeywordList.some(kw => lowerText.includes(kw));
            const hasTargetSignal = targetNeedle.length > 1 ? lowerText.includes(targetNeedle) : false;

            if (hasKeywordSignal || hasTargetSignal) {
                let hasContentMatch = false;
                let contentMatchCount = 0;

                for (let paraIndex = 0; paraIndex < paragraphs.length; paraIndex++) {
                    const para = paragraphs[paraIndex];
                    if (para.length < 15) continue;

                    const paraLower = para.toLowerCase();
                    const paraKeywordSignal = normalizedKeywordList.length === 0
                        || normalizedKeywordList.some(kw => paraLower.includes(kw));
                    const paraTargetSignal = targetNeedle.length > 1 ? paraLower.includes(targetNeedle) : false;
                    if (!paraKeywordSignal && !paraTargetSignal) continue;

                    const score = scoreChunk(para, query);
                    if (shouldKeepContentMatch(score, para, query)) {
                        matches.push({
                            paragraph: para.trim().substring(0, 600),
                            score: Math.max(score, CONTENT_SCORE_THRESHOLD),
                            matchType: 'content',
                            fileName: entry.name,
                            path: entry.path || '',
                            fileId: entry.id || `${entry.path || ''}/${entry.name || ''}`,
                            fileVersion,
                            chunkIndex: paraIndex,
                            chunkHash: hashChunkText(para),
                        });
                        hasContentMatch = true;
                        contentMatchCount += 1;
                        if (contentMatchCount >= MAX_CONTENT_MATCHES_PER_FILE) break;
                    }

                    if (paraIndex > 0 && (paraIndex % 24) === 0) {
                        await yieldToMainThread(normalizedOpts.fullScanThrottleMs);
                    }
                }

                if (!hasContentMatch) {
                    const fallbackKeyword = normalizedKeywordList.find(kw => lowerText.includes(kw));
                    const fallbackNeedle = fallbackKeyword || query.target || query.raw;
                    const snippet = extractNeedleSnippet(text, fallbackNeedle);

                    if (snippet && hasStrongQuerySignal(snippet, query)) {
                        matches.push({
                            paragraph: snippet.substring(0, 600),
                            score: CONTENT_SCORE_THRESHOLD,
                            matchType: 'content',
                            fileName: entry.name,
                            path: entry.path || '',
                            fileId: entry.id || `${entry.path || ''}/${entry.name || ''}`,
                            fileVersion,
                            chunkIndex: -2,
                            chunkHash: hashChunkText(snippet),
                        });
                    }
                }
            }
        }

        return matches;
    };

    const runWorker = async () => {
        while (nextQueueIndex < searchQueue.length) {
            if (isSearchCancelled(searchId, cancelGeneration)) return;
            if (shouldStopSearchEarly({
                forceFullScan: normalizedOpts.forceFullScan,
                highConfidenceFound,
                batchStart: filesSearched,
                batchSize: workerCount,
            })) return;

            const currentIndex = nextQueueIndex;
            nextQueueIndex += 1;
            if (currentIndex >= searchQueue.length) return;

            const entry = searchQueue[currentIndex];
            let matches = null;
            try {
                matches = await processEntry(entry);
            } catch {
                matches = null;
            }

            filesSearched += 1;

            if (Array.isArray(matches)) {
                for (const match of matches) {
                    if (match.matchType === 'filename') {
                        filenameMatches.push(match);
                        if (filenameMatches.length > (filenameCandidateCap * 2)) {
                            trimMatchesByScore(filenameMatches, filenameCandidateCap);
                        }
                        continue;
                    }
                    contentMatches.push(match);
                    if (match.score >= 8) highConfidenceFound = true;
                    if (contentMatches.length > (contentCandidateCap * 2)) {
                        trimMatchesByScore(contentMatches, contentCandidateCap);
                    }
                }
            }

            maybeEmitProgress(entry?.name || '');
            maybeEmitPreview();

            if ((filesSearched % workerCount) === 0) {
                await yieldToMainThread(normalizedOpts.fullScanThrottleMs);
            }
        }
    };

    await Promise.allSettled(
        Array.from({ length: workerCount }, () => runWorker()),
    );

    trimMatchesByScore(contentMatches, contentCandidateCap);
    trimMatchesByScore(filenameMatches, filenameCandidateCap);

    await yieldToMainThread(normalizedOpts.fullScanThrottleMs);

    let rankedContentResults = contentMatches;
    if (normalizedOpts.useEmbeddingsRerank && contentMatches.length > 1) {
        const reranked = await rerankResultsWithEmbeddings(contentMatches, query, normalizedOpts);
        if (reranked && reranked.length > 0) {
            rankedContentResults = reranked;
        }
    }

    const strictContentResults = rankedContentResults.filter(result => hasStrongQuerySignal(result.paragraph, query));
    if (strictContentResults.length > 0) {
        rankedContentResults = strictContentResults;
    }

    const finalResults = combineSearchResults({
        contentResults: rankedContentResults,
        filenameResults: filenameMatches,
        includeFilenameFallback: normalizedOpts.includeFilenameFallback,
    });

    // Save to query cache for instant follow-ups.
    // Skip caching partial/unstable passes where files were unreadable and only filename matches were returned.
    const shouldCacheResult = finalResults.length > 0 && rankedContentResults.length > 0;

    if (shouldCacheResult) {
        const queryCacheMax = getAdaptiveCacheCaps().queryCacheMax;
        if (_queryCache.size >= queryCacheMax) {
            const oldest = _queryCache.keys().next().value;
            _queryCache.delete(oldest);
        }
        const compactResults = finalResults
            .slice(0, MAX_RESULTS + 2)
            .map(row => ({
                ...row,
                paragraph: String(row?.paragraph || '').substring(0, 600),
            }));
        _queryCache.set(cacheKey, { results: compactResults, ts: Date.now() });
    }

    // Format the raw chunk extracts
    const formattedRawChunks = formatResults(finalResults, query);

    if (formattedRawChunks) {
        if (normalizedOpts.progressCb) {
            normalizedOpts.progressCb('done', filesSearched, searchQueue.length, {
                contentHits: rankedContentResults.length,
                filenameHits: filenameMatches.length,
            });
        }
        addToContext(query.target, query.keywords);

        // Return synthesized answer + evidence blocks
        const reliabilityNote = unreadableFiles > 0
            ? `\n\n_Note: ${unreadableFiles} files were unreadable in this pass. Re-running search can recover additional matches._`
            : '';

        const indexedTotal = Number(getIndexedFileCount()) || files.length;
        return formattedRawChunks + `\n\n_Searched ${filesSearched} files (indexed total: ${indexedTotal})_` + reliabilityNote;
    }

        if (normalizedOpts.progressCb) {
            normalizedOpts.progressCb('done', filesSearched, searchQueue.length, {
                contentHits: rankedContentResults.length,
                filenameHits: filenameMatches.length,
            });
        }
        const indexedTotal = Number(getIndexedFileCount()) || files.length;
        return `I searched through **${filesSearched} files** (indexed total: **${indexedTotal}**) but could not find information about "${query.target}". Try:
- Being more specific
- Using different keywords
- Make sure relevant files are accessible on your device.`;
    } finally {
        endSearchSession(searchId);
        releaseSearchSlot();
    }
}

/**
 * Warm the local "learned profile" cache by reading indexed files once.
 * This keeps the assistant ready for broader follow-up questions offline.
 */
export async function warmupSearchKnowledge(opts = {}) {
    const progressCb = typeof opts.progressCb === 'function' ? opts.progressCb : null;
    const maxFiles = Number.isFinite(opts.maxFiles) ? Math.max(1, opts.maxFiles) : Infinity;
    const files = getReadableFiles().filter(f => {
        const ext = (f.ext || '').toLowerCase();
        return !IGNORE_EXTS.has(ext);
    });

    const targets = files.slice(0, maxFiles);
    let processed = 0;
    let learned = 0;
    let embedded = 0;
    let imageEmbedded = 0;

    for (const entry of targets) {
        if (progressCb) progressCb('learn', processed + 1, targets.length, entry.name);
        try {
            const before = _learningProfiles.get(getFileIdentity(entry))?.version;
            const text = await readFileTextWithRetry(entry);
            const fileVersion = buildContentVersion(text, entry);
            rememberFileLearningProfile(entry, fileVersion, text);
            const after = _learningProfiles.get(getFileIdentity(entry))?.version;
            if (after && after !== before) learned++;

            // Pre-embed a few top paragraphs for instant future retrieval (best-effort).
            if (text && text.length > 200) {
                const analysis = getCachedTextAnalysis(entry, text, fileVersion);
                const paras = (analysis?.paragraphs || splitIntoParagraphs(text)).slice(0, 12);
                for (let i = 0; i < paras.length; i++) {
                    const para = paras[i];
                    if (!para || para.length < 20) continue;
                    try {
                        const vec = await embedTextWithWorker(para.substring(0, 512));
                        const key = buildEmbeddingCacheKey({
                            fileId: entry.id || getFileIdentity(entry),
                            fileVersion,
                            chunkIndex: i,
                            chunkHash: hashChunkText(para),
                            paragraph: para,
                        });
                        await addTextVector(key, vec, {
                            fileName: entry.name,
                            path: entry.path || '',
                            paragraph: para.substring(0, 600),
                            fileId: entry.id || getFileIdentity(entry),
                            chunkIndex: i,
                        });
                        embedded++;
                    } catch {
                        // Skip embedding failures silently to keep warmup fast.
                    }
                }
            } else if (entry.ext && IMG_EXTS.has(String(entry.ext || '').toLowerCase())) {
                try {
                    const blob = await readImageBlob(entry);
                    if (blob) {
                        const vec = await embedClipImage(blob);
                        const key = getFileIdentity(entry);
                        let labels = [];
                        try {
                            labels = await detectImageLabels(blob, { max: 6, threshold: 0.72 });
                        } catch { /* ignore detection failures */ }
                        await addImageVector(key, vec, {
                            fileName: entry.name,
                            path: entry.path || '',
                            fileId: entry.id || key,
                            labels,
                        });
                        imageEmbedded++;
                    }
                } catch {
                    // ignore failures
                }
            }
        } catch {
            // Best-effort warmup: skip unreadable files.
        }
        processed++;
        if (processed % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1));
        }
    }

    return {
        processed,
        learned,
        totalSearchable: files.length,
        cachedProfiles: _learningProfiles.size,
        embedded,
        imageEmbedded,
    };
}

// ===============================================================
// IMAGE SEARCH (CLIP)
// ===============================================================
export async function searchImages(queryText) {
    const query = String(queryText || '').trim();
    if (!query) return 'Please provide what you want to find in your images.';

    try {
        const qVec = await embedClipText(query.substring(0, 256));
        const hits = await searchImageVectors(qVec, 12);
        if (!hits || hits.length === 0) {
            return `No similar images found for "${query}". Try different keywords.`;
        }

        const blocks = hits.map(hit => {
            const openParams = new URLSearchParams();
            if (hit.id) openParams.set('id', String(hit.id));
            if (hit.fileName) openParams.set('name', hit.fileName);
            const url = `/__nice_open_file__?${openParams.toString()}`;
            const pathLine = hit.path ? `\nPath: _${normalizeDisplayPath(hit.path, hit.fileName)}/${hit.fileName}_` : '';
            const labelsLine = (hit.labels && hit.labels.length)
                ? `\nLabels: ${hit.labels.map(l => typeof l === 'string' ? l : l.label).slice(0, 5).join(', ')}`
                : '';
            return `File: **${hit.fileName}**${pathLine}${labelsLine}\n\n[Open image](${url})`;
        }).join('\n\n---\n\n');

        return `Here are similar images for **${query}**:\n\n${blocks}`;
    } catch (e) {
        return `I couldn't run image search right now: ${e?.message || 'unknown error'}`;
    }
}

export function cancelSearch(searchId = null) {
    if (searchId) {
        const key = String(searchId);
        if (_activeSearchSessions.has(key)) {
            _cancelledSearchSessions.add(key);
        }
        return;
    }

    // Cancel all active searches while allowing new sessions to start immediately.
    _searchCancelGeneration += 1;
    for (const activeId of _activeSearchSessions) {
        _cancelledSearchSessions.add(activeId);
    }
}

export function invalidateSearchCaches() {
    _queryCache.clear();
    _entryVersionCache.clear();
    _textCache.clear();
    _textCacheBytes = 0;
    _textAnalysisCache.clear();
    _learningProfiles.clear();
    _readFailureCache.clear();
    void clearPersistedContentCache();
}

let _indexUpdateListenerInstalled = false;
function bindIndexUpdateListener() {
    if (_indexUpdateListenerInstalled || typeof window === 'undefined') return;
    window.addEventListener(INDEX_UPDATED_EVENT, () => {
        invalidateSearchCaches();
    });
    _indexUpdateListenerInstalled = true;
}

bindIndexUpdateListener();

export function getSearchStatus() {
    const files = getReadableFiles();
    const searchable = files.filter(f => {
        const ext = (f.ext || '').toLowerCase();
        return !IGNORE_EXTS.has(ext);
    });
    const kg = getKnowledgeGraphStats();

    if (files.length === 0) {
        return `**Search Engine Ready**\n- No files indexed yet\n- Ask a question to trigger scanning and retrieval\n- Zero-copy on-demand reading\n- Knowledge graph facts: ${kg.facts}`;
    }

    return `**Search Engine Ready**\n- ${files.length} files indexed\n- ${searchable.length} searchable candidates\n- Learned profiles: ${_learningProfiles.size}\n- Stage A: BM25-lite retrieval\n- Stage B: embedding rerank (when enabled)\n- Offline answer synthesis from evidence chunks\n- Knowledge graph facts: ${kg.facts}\n- Knowledge graph nodes: ${kg.nodes}`;
}

export function hasSearchableFiles() {
    const files = getReadableFiles();
    return files.some(f => {
        const ext = (f.ext || '').toLowerCase();
        return !IGNORE_EXTS.has(ext);
    });
}

/**
 * Extracts the full raw text of a specific file by name
 * Used by the offline LLM for Document Summarization
 */
export async function extractFullFileText(filename) {
    const files = getReadableFiles();
    const queryLower = filename.toLowerCase();

    // Find highest confidence match
    const match = files.find(f => f.name.toLowerCase() === queryLower) ||
        files.find(f => f.name.toLowerCase().includes(queryLower));

    if (!match) return null;

    try {
        const text = await readFileTextWithRetry(match);
        return text || null;
    } catch (e) {
        console.warn(`[Nice] Error extracting full text for ${filename}:`, e);
        return null;
    }
}






