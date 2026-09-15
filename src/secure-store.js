/**
 * Nice - Secure local storage helper
 * Uses AES-GCM where available for encrypted at-rest JSON blobs.
 */

const KEY_DB_NAME = 'nice_secure_keys';
const KEY_DB_VERSION = 1;
const KEY_STORE = 'keys';
const DEFAULT_KEY_ID = 'learning_profile_v1';

let keyDbPromise = null;
const keyCache = new Map();

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function hasWebCrypto() {
  return typeof crypto !== 'undefined'
    && !!crypto
    && !!crypto.subtle
    && typeof TextEncoder !== 'undefined'
    && typeof TextDecoder !== 'undefined';
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function openKeyDb() {
  if (keyDbPromise) return keyDbPromise;
  keyDbPromise = new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('indexeddb_unavailable'));
      return;
    }

    const req = indexedDB.open(KEY_DB_NAME, KEY_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexeddb_open_failed'));
  });
  return keyDbPromise;
}

async function loadKeyFromStore(keyId) {
  const db = await openKeyDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readonly');
    const req = tx.objectStore(KEY_STORE).get(keyId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('key_read_failed'));
  });
}

async function saveKeyToStore(keyId, key) {
  const db = await openKeyDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readwrite');
    tx.objectStore(KEY_STORE).put(key, keyId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('key_write_failed'));
  });
}

async function getOrCreateKey(keyId = DEFAULT_KEY_ID) {
  if (keyCache.has(keyId)) return keyCache.get(keyId);

  let key = null;
  try {
    key = await loadKeyFromStore(keyId);
  } catch {
    key = null;
  }

  if (!key) {
    key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    try {
      await saveKeyToStore(keyId, key);
    } catch {
      // Continue with in-memory key for current session.
    }
  }

  keyCache.set(keyId, key);
  return key;
}

export function isSecureStorageAvailable() {
  return hasWebCrypto() && hasIndexedDb();
}

export async function encryptObject(value, opts = {}) {
  const keyId = String(opts.keyId || DEFAULT_KEY_ID);
  const json = JSON.stringify(value ?? null);

  if (!isSecureStorageAvailable()) {
    return JSON.stringify({ v: 1, mode: 'plain', data: json });
  }

  try {
    const key = await getOrCreateKey(keyId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(json);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return JSON.stringify({
      v: 1,
      mode: 'aes-gcm',
      keyId,
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(encrypted)),
    });
  } catch {
    return JSON.stringify({ v: 1, mode: 'plain', data: json });
  }
}

export async function decryptObject(payload, opts = {}) {
  if (!payload) return null;
  const defaultKeyId = String(opts.keyId || DEFAULT_KEY_ID);

  let envelope;
  try {
    envelope = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch {
    try {
      return JSON.parse(String(payload));
    } catch {
      return null;
    }
  }

  if (envelope?.mode === 'plain') {
    try {
      return JSON.parse(String(envelope.data || 'null'));
    } catch {
      return null;
    }
  }

  if (!isSecureStorageAvailable()) return null;
  if (envelope?.mode !== 'aes-gcm') return null;

  try {
    const keyId = String(envelope.keyId || defaultKeyId);
    const key = await getOrCreateKey(keyId);
    const iv = base64ToBytes(String(envelope.iv || ''));
    const ciphertext = base64ToBytes(String(envelope.data || ''));
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );
    const json = new TextDecoder().decode(new Uint8Array(decrypted));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

