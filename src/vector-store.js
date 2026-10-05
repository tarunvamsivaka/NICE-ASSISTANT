/**
 * Nice - Local Vector Store (IndexedDB-backed)
 * Stores/searches embedding vectors with encrypted-at-rest payloads.
 */

import { decryptObject, encryptObject } from './secure-store.js';

const DB_NAME = 'nice_vectors';
const DB_VERSION = 1;
const TEXT_STORE = 'text_vectors';
const IMAGE_STORE = 'image_vectors';
const VECTOR_SECURE_KEY_ID = 'vector_store_v1';

let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        if (db) {
            resolve(db);
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(TEXT_STORE)) {
                database.createObjectStore(TEXT_STORE, { keyPath: 'id' });
            }
            if (!database.objectStoreNames.contains(IMAGE_STORE)) {
                database.createObjectStore(IMAGE_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => {
            db = req.result;
            resolve(db);
        };
        req.onerror = () => reject(req.error);
    });
}

async function buildEncryptedRecord(id, vector, metadata = {}) {
    const payload = {
        vector: Array.isArray(vector) ? vector : Array.from(vector || []),
        metadata,
    };
    const encrypted = await encryptObject(payload, { keyId: VECTOR_SECURE_KEY_ID });
    return {
        id,
        schema: 2,
        payload: encrypted,
        updatedAt: Date.now(),
    };
}

async function decodeRecord(record) {
    if (!record) return null;

    // Backward compatibility with v1 plain storage.
    if (Array.isArray(record.vector)) {
        return record;
    }

    if (!record.payload) return null;
    const decoded = await decryptObject(record.payload, { keyId: VECTOR_SECURE_KEY_ID });
    if (!decoded || !Array.isArray(decoded.vector)) return null;

    return {
        id: record.id,
        vector: decoded.vector,
        ...(decoded.metadata || {}),
    };
}

// ⚡ Bolt: Optimized cosine similarity using loop unrolling (batching by 4)
// and combined Math.sqrt call for significant performance boost on large arrays.
function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return 0;
    const len = a.length;
    if (len !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    let i = 0;
    // Loop unrolling: process 4 elements at a time to reduce loop overhead
    for (; i <= len - 4; i += 4) {
        const a0 = a[i], b0 = b[i];
        const a1 = a[i+1], b1 = b[i+1];
        const a2 = a[i+2], b2 = b[i+2];
        const a3 = a[i+3], b3 = b[i+3];

        dot += a0 * b0 + a1 * b1 + a2 * b2 + a3 * b3;
        normA += a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
        normB += b0 * b0 + b1 * b1 + b2 * b2 + b3 * b3;
    }

    // Handle remaining elements
    for (; i < len; i++) {
        const ai = a[i], bi = b[i];
        dot += ai * bi;
        normA += ai * ai;
        normB += bi * bi;
    }

    // Combine square roots: Math.sqrt(A) * Math.sqrt(B) === Math.sqrt(A * B)
    const denom = Math.sqrt(normA * normB);
    return denom === 0 ? 0 : dot / denom;
}

export async function addTextVector(id, vector, metadata) {
    const database = await openDB();
    const record = await buildEncryptedRecord(id, vector, metadata);
    return new Promise((resolve, reject) => {
        const tx = database.transaction(TEXT_STORE, 'readwrite');
        tx.objectStore(TEXT_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function addImageVector(id, vector, metadata) {
    const database = await openDB();
    const record = await buildEncryptedRecord(id, vector, metadata);
    return new Promise((resolve, reject) => {
        const tx = database.transaction(IMAGE_STORE, 'readwrite');
        tx.objectStore(IMAGE_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getDecodedStoreItems(storeName) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = async () => {
            const raw = req.result || [];
            const decoded = await Promise.all(raw.map(item => decodeRecord(item)));
            resolve(decoded.filter(Boolean));
        };
        req.onerror = () => reject(req.error);
    });
}

export async function searchTextVectors(queryVector, topK = 5) {
    const items = await getDecodedStoreItems(TEXT_STORE);
    return items
        .map(item => ({
            id: item.id,
            fileName: item.fileName,
            path: item.path,
            paragraph: item.paragraph,
            score: cosineSimilarity(queryVector, item.vector),
        }))
        .filter(item => item.score > 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

export async function searchImageVectors(queryVector, topK = 5) {
    const items = await getDecodedStoreItems(IMAGE_STORE);
    return items
        .map(item => ({
            id: item.id,
            fileName: item.fileName,
            path: item.path,
            labels: item.labels || item.metadata?.labels || [],
            score: cosineSimilarity(queryVector, item.vector),
        }))
        .filter(item => item.score > 0.2)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

export async function clearAllVectors() {
    const database = await openDB();
    return new Promise((resolve) => {
        const tx = database.transaction([TEXT_STORE, IMAGE_STORE], 'readwrite');
        tx.objectStore(TEXT_STORE).clear();
        tx.objectStore(IMAGE_STORE).clear();
        tx.oncomplete = () => resolve();
    });
}

export async function getVectorCounts() {
    const database = await openDB();
    return new Promise((resolve) => {
        const tx = database.transaction([TEXT_STORE, IMAGE_STORE], 'readonly');
        const textReq = tx.objectStore(TEXT_STORE).count();
        const imgReq = tx.objectStore(IMAGE_STORE).count();
        let textCount = 0;
        let imgCount = 0;
        textReq.onsuccess = () => {
            textCount = textReq.result;
        };
        imgReq.onsuccess = () => {
            imgCount = imgReq.result;
        };
        tx.oncomplete = () => resolve({ text: textCount, image: imgCount });
    });
}
