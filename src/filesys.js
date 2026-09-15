/**
 * Nice — File System Engine
 * Real file access, indexing, search, and audio playback
 * Uses File System Access API + IndexedDB for offline persistence
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { AppLauncher } from '@capacitor/app-launcher';


// ===== IndexedDB for File Index =====
const DB_NAME = 'nice_files';
const DB_VERSION = 1;
const STORE_NAME = 'file_index';
const HANDLES_STORE = 'dir_handles';

let db = null;
let fileIndex = []; // In-memory cache for instant search
let audioPlayer = null;
let currentAudioFile = null;
let musicProgressTimer = null;
let _indexScanPromise = null;

async function runSingleFlightScan(task) {
    if (_indexScanPromise) return _indexScanPromise;
    _indexScanPromise = (async () => {
        try {
            return await task();
        } finally {
            _indexScanPromise = null;
        }
    })();
    return _indexScanPromise;
}

function stopMusicProgressUpdates() {
    if (musicProgressTimer) {
        clearInterval(musicProgressTimer);
        musicProgressTimer = null;
    }
}

function startMusicProgressUpdates() {
    stopMusicProgressUpdates();
    musicProgressTimer = setInterval(() => {
        if (!audioPlayer || audioPlayer.paused) return;
        const duration = Number(audioPlayer.duration);
        const current = Number(audioPlayer.currentTime);
        const pct = duration > 0 ? (current / duration) * 100 : 0;
        const bar = document.getElementById('musicProgress');
        if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
    }, 200);
}

function notifyIndexUpdated() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('nice:index-updated'));
}

function openDB() {
    return new Promise((resolve, reject) => {
        if (db) return resolve(db);
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(STORE_NAME)) {
                const store = d.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('name', 'nameLower');
                store.createIndex('type', 'type');
                store.createIndex('ext', 'ext');
            }
            if (!d.objectStoreNames.contains(HANDLES_STORE)) {
                d.createObjectStore(HANDLES_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(db); };
        req.onerror = () => reject(req.error);
    });
}

// ===== File Indexing =====
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'opus', 'webm'];
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'heif', 'tif', 'tiff'];
export const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'];
export const DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'tsv', 'ppt', 'pptx'];

export function getFileType(ext) {
    if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
    if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
    if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
    if (DOC_EXTENSIONS.includes(ext)) return 'document';
    return 'other';
}
export const getFileCategory = getFileType;

function toStoredFileRecord(file) {
    const record = {
        id: file.id,
        name: file.name,
        nameLower: file.nameLower,
        path: file.path,
        ext: file.ext,
        type: file.type,
    };

    if (file.capacitorPath) record.capacitorPath = file.capacitorPath;
    if (file.capacitorDirectory !== undefined && file.capacitorDirectory !== null) {
        record.capacitorDirectory = file.capacitorDirectory;
    }
    if (file.file) record.file = file.file;

    return record;
}

function runStoreWrite(database, writer) {
    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        try {
            writer(store);
        } catch (error) {
            reject(error);
            return;
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('store_write_failed'));
        tx.onabort = () => reject(tx.error || new Error('store_write_aborted'));
    });
}

async function replaceIndexedStoreRecords(database, files, opts = {}) {
    const chunkSize = Math.max(
        64,
        Math.min(512, Number(opts.chunkSize) || (Capacitor.isNativePlatform() ? 160 : 260)),
    );

    await runStoreWrite(database, (store) => {
        store.clear();
    });

    if (!Array.isArray(files) || files.length === 0) return;

    for (let i = 0; i < files.length; i += chunkSize) {
        const batch = files.slice(i, i + chunkSize).map(toStoredFileRecord);
        await runStoreWrite(database, (store) => {
            for (const record of batch) {
                store.put(record);
            }
        });

        // Yield between write batches to keep Android WebView responsive.
        if ((i + chunkSize) < files.length) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
}

/**
 * Grant folder access — user picks a directory, we index all files
 * Returns { success, count, message }
 * 
 * Desktop: Uses File System Access API (showDirectoryPicker)
 * Android/Mobile: Falls back to <input webkitdirectory> for folder selection
 */
export async function grantFolderAccess() {
    return await runSingleFlightScan(async () => {
        // Native Android: Capacitor Filesystem
        if (Capacitor.isNativePlatform()) {
            const result = await _grantViaCapacitor();
            // Fallback for Android 13+ Scoped Storage blocking native access
            if (result.success && result.count === 0) {
                console.log('[Nice] Scoped Storage returned 0 files. Falling back to native file picker intent.');
                return await _grantViaFilePickerFallback();
            }
            return result;
        }

        // Desktop: File System Access API
        if ('showDirectoryPicker' in window) {
            return await _grantViaDirectoryPicker();
        }

        // Android/Mobile fallback: webkitdirectory input
        return await _grantViaFileInput();
    });
}

// Comprehensive extension allowlist for indexing on Android
// Aligned with search-engine.js TEXT_EXTS + PDF_EXTS + IMG_EXTS + DOC_EXTENSIONS
export const NATIVE_INDEX_EXTS = new Set([
    // Text & code files
    'txt', 'md', 'json', 'csv', 'tsv', 'html', 'css', 'js', 'xml', 'py', 'java',
    'c', 'cpp', 'h', 'log', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'env',
    'sh', 'bat', 'rtf', 'tex', 'rst', 'org', 'ts', 'jsx', 'tsx', 'sql',
    'r', 'rb', 'php', 'swift', 'kt', 'go', 'rs',
    // Documents
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt',
    // Images (for OCR)
    'jpg', 'jpeg', 'png', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff',
]);

// Directories to skip during scanning (system/cache/app-internal dirs)
const SKIP_DIR_NAMES = new Set([
    'Data', 'data', 'lost+found', 'LOST.DIR',
    'node_modules', '.thumbnails', '.cache', '.trash',
]);
const ALLOW_HIDDEN_DIR_NAMES = new Set([
    '.statuses',
]);
const SKIP_PATH_PREFIXES = [
    'android/data',
    'android/obb',
    'android/sandbox',
];
const EXTRA_ANDROID_SOURCE_PATHS = [
    '',
    '.',
    'Download',
    'Downloads',
    'Documents',
    'DCIM',
    'Pictures',
    'Movies',
    'Music',
    'Podcasts',
    'Notifications',
    'Ringtones',
    'Recordings',
    'WhatsApp/Media',
    'Bluetooth',
    'WhatsApp',
    'Android/media',
    'Android/media/com.whatsapp/WhatsApp/Media',
    'Android/media/com.whatsapp.w4b/WhatsApp Business/Media',
    'Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents',
    'Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images',
    'Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video',
    'Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Audio',
    'WhatsApp/Media/.Statuses',
    'Telegram',
    'Telegram/Documents',
    'Telegram/Telegram Documents',
    'Telegram/Telegram Images',
    'Telegram/Telegram Video',
    'Android/media/org.telegram.messenger',
    'Android/media/com.instagram.android',
    'DCIM/Camera',
    'Pictures/Screenshots',
    'Pictures/WhatsApp',
    'WhatsApp Documents',
    'WhatsApp Audio',
    'WhatsApp Images',
    'WhatsApp Video',
    'MIUI/download',
    'Bluetooth',
    'Download/Bluetooth',
];
const ABSOLUTE_ANDROID_SCAN_PATHS = [
    '/storage/emulated/0',
    '/sdcard',
    '/storage/self/primary',
];

const MAX_SCAN_DEPTH = 20; // Prevent runaway recursion while covering deeper storage paths
const MAX_NATIVE_SCAN_FILES = 50000;
const MIN_EXPECTED_FULL_SCAN = 600;

function cacheNativeStoragePermission(granted) {
    try {
        localStorage.setItem('nice_storage_granted', granted ? 'true' : 'false');
    } catch {
        // Ignore storage cache failures in restricted contexts.
    }
}

function normalizeNativePath(path = '') {
    return String(path || '')
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\/+|\/+$/g, '');
}

function normalizeAbsoluteNativePath(path = '') {
    const normalized = String(path || '')
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .trim();
    if (!normalized) return '';
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function shouldSkipNativeDirectory(name, fullPath = '') {
    const dirName = String(name || '');
    if (!dirName) return true;
    const lowerDirName = dirName.toLowerCase();
    if (dirName.startsWith('.') && !ALLOW_HIDDEN_DIR_NAMES.has(lowerDirName)) return true;
    if (SKIP_DIR_NAMES.has(dirName)) return true;

    const normalizedPath = normalizeNativePath(fullPath).toLowerCase();
    return SKIP_PATH_PREFIXES.some(prefix => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`));
}

function normalizeNativeEntry(rawEntry) {
    if (!rawEntry) return { name: '', type: '' };
    if (typeof rawEntry === 'string') {
        return { name: rawEntry.trim(), type: '' };
    }
    const name = String(rawEntry.name || rawEntry.path || '').trim();
    const type = rawEntry.type;
    return { name, type };
}

function normalizeNativeEntryType(rawType, name = '') {
    const lowered = String(rawType || '').toLowerCase();
    if (lowered === 'directory' || lowered === 'dir') return 'directory';
    if (lowered === 'file') return 'file';

    if (rawType === 0 || rawType === 1 || rawType === 2) {
        // Capacitor filesystem plugin versions differ in enum value ordering.
        // Prefer explicit filename heuristic where available.
        if (String(name || '').includes('.')) return 'file';
        return rawType === 2 ? 'file' : 'directory';
    }

    // Fallback heuristic for string-only entry arrays.
    return String(name || '').includes('.') ? 'file' : 'directory';
}

// Native Android implementation using Capacitor Filesystem
async function _grantViaCapacitor() {
    try {
        const perm = await Filesystem.requestPermissions();
        if (perm.publicStorage !== 'granted' && perm.publicStorage !== 'limited') {
            cacheNativeStoragePermission(false);
            return { success: false, message: 'Storage permission denied.' };
        }
        cacheNativeStoragePermission(true);

        const files = [];
        const dedupeIds = new Set();
        const visitedDirs = new Set();
        let scanned = 0;
        let lastYieldTime = performance.now(); // Optimize yielding lag

        async function indexNativeDir(path, depth, directory, scopeLabel) {
            if (depth > MAX_SCAN_DEPTH) return; // Depth guard
            if (scanned > MAX_NATIVE_SCAN_FILES) return; // Safety limit

            const useAbsolutePath = (directory === undefined || directory === null)
                && String(path || '').trim().startsWith('/');
            const normalizedPath = useAbsolutePath
                ? normalizeAbsoluteNativePath(path)
                : normalizeNativePath(path);
            const dirKey = `${scopeLabel}|${String(directory)}|${normalizedPath.toLowerCase()}`;
            if (visitedDirs.has(dirKey)) return;

            try {
                const readdirArgs = {
                    path: normalizedPath || '',
                };
                if (directory !== undefined && directory !== null) {
                    readdirArgs.directory = directory;
                }
                const result = await Filesystem.readdir(readdirArgs);
                visitedDirs.add(dirKey);

                for (const rawEntry of (result.files || [])) {
                    if (scanned > MAX_NATIVE_SCAN_FILES) break; // Safety limit
                    const entry = normalizeNativeEntry(rawEntry);
                    if (!entry || !entry.name) continue;

                    const fullPath = normalizedPath ? `${normalizedPath}/${entry.name}` : entry.name;
                    const entryType = normalizeNativeEntryType(entry.type, entry.name);

                    if (entryType === 'directory') {
                        if (shouldSkipNativeDirectory(entry.name, fullPath)) continue;
                        // Chunked yielding: Only yield if blocking thread for > 30ms to prevent lag
                        if (performance.now() - lastYieldTime > 30) {
                            await new Promise(r => setTimeout(r, 0));
                            lastYieldTime = performance.now();
                        }
                        await indexNativeDir(fullPath, depth + 1, directory, scopeLabel);
                    } else if (entryType === 'file') {
                        if (entry.name.startsWith('.')) continue;
                        const ext = entry.name.includes('.') ? entry.name.split('.').pop().toLowerCase() : '';
                        const canonicalPath = normalizeNativePath(fullPath).toLowerCase();
                        if (!canonicalPath) continue;
                        if (dedupeIds.has(canonicalPath)) continue;
                        dedupeIds.add(canonicalPath);

                        const displayPath = (scopeLabel === 'ExternalStorage'
                            ? fullPath
                            : `${scopeLabel}/${fullPath}`).replace(/\/+/g, '/');
                        const idPrefix = scopeLabel === 'ExternalStorage' ? '' : `${scopeLabel}:`;
                        const fileId = `${idPrefix}${fullPath}`;
                        files.push({
                            id: fileId,
                            name: entry.name,
                            nameLower: entry.name.toLowerCase(),
                            path: displayPath,
                            ext,
                            type: getFileType(ext),
                            capacitorPath: fullPath,
                            capacitorDirectory: directory,
                        });
                        scanned++;
                    }
                }
            } catch (e) {
                console.warn(`[Nice] Cannot read dir "${scopeLabel}/${path}":`, e.message || e);
            }
        }

        // Scan across primary user-accessible roots.
        await indexNativeDir('', 0, Directory.ExternalStorage, 'ExternalStorage');
        if (files.length < MIN_EXPECTED_FULL_SCAN) {
            for (const extraPath of EXTRA_ANDROID_SOURCE_PATHS) {
                await indexNativeDir(extraPath, 0, Directory.ExternalStorage, 'ExternalStorage');
            }
        }
        try {
            await indexNativeDir('', 0, Directory.Documents, 'Documents');
        } catch {
            // Directory.Documents may be unavailable on some Android builds.
        }
        try {
            await indexNativeDir('', 0, Directory.External, 'External');
        } catch {
            // Directory.External may be unavailable depending on device/storage setup.
        }
        if (files.length < MIN_EXPECTED_FULL_SCAN) {
            for (const absolutePath of ABSOLUTE_ANDROID_SCAN_PATHS) {
                try {
                    await indexNativeDir(absolutePath, 0, null, 'AbsoluteStorage');
                } catch {
                    // Some devices block absolute path traversal; keep best-effort behavior.
                }
            }
        }

        // Store in IndexedDB
        // Android 13 Bugfix: Prevent clearing if scan found 0 files due to Scoped Storage.
        if (files.length === 0) {
            console.log('[Nice] Native scan found 0 files. Aborting IndexedDB clear to protect fallback index.');
            return { success: false, message: 'No files found natively.' };
        }

        const database = await openDB();
        await replaceIndexedStoreRecords(database, files);

        // Keep full index in memory
        fileIndex = files;
        notifyIndexUpdated();

        // Store stats
        localStorage.setItem('nice_file_count', files.length.toString());
        localStorage.setItem('nice_folder_name', 'Device Storage');
        localStorage.setItem('nice_last_scan', new Date().toLocaleString());
        localStorage.setItem('nice_last_scan_ts', Date.now().toString());
        cacheNativeStoragePermission(true);

        return {
            success: true,
            count: files.length,
            message: `Indexed **${files.length}** files from on-device storage (including Downloads, Documents, DCIM, Pictures, WhatsApp/Android media when accessible). I am ready to answer from file contents offline.`,
        };
    } catch (e) {
        return { success: false, message: `Error accessing files: ${e.message}` };
    }
}

// Desktop implementation using File System Access API
async function _grantViaDirectoryPicker() {
    try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });

        // Index all files recursively
        const files = [];
        let scanned = 0;

        async function indexDir(handle, path) {
            for await (const entry of handle.values()) {
                if (entry.kind === 'file') {
                    const name = entry.name;
                    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
                    files.push({
                        id: `${path}/${name}`,
                        name,
                        nameLower: name.toLowerCase(),
                        path,
                        ext,
                        type: getFileType(ext),
                        handle: entry,
                    });
                    scanned++;
                } else if (entry.kind === 'directory') {
                    // Skip hidden dirs and system dirs
                    if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        try {
                            await indexDir(entry, `${path}/${entry.name}`);
                        } catch {
                            // Permission denied for sub-directory, skip
                        }
                    }
                }

                // YIELD TO MAIN THREAD: Prevent UI freeze during fast large directory scans
                if (scanned % 50 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
        }

        await indexDir(dirHandle, dirHandle.name);

        // Store in IndexedDB
        const database = await openDB();
        await replaceIndexedStoreRecords(database, files);

        // Keep full index with handles in memory
        fileIndex = files;
        notifyIndexUpdated();

        // Save the directory handle for re-access
        try {
            const htx = database.transaction(HANDLES_STORE, 'readwrite');
            htx.objectStore(HANDLES_STORE).put({ id: 'root', handle: dirHandle, name: dirHandle.name });
        } catch {
            // Some browsers don't support storing handles
        }

        // Store stats
        localStorage.setItem('nice_file_count', files.length.toString());
        localStorage.setItem('nice_folder_name', dirHandle.name);
        localStorage.setItem('nice_last_scan', new Date().toLocaleString());
        localStorage.setItem('nice_last_scan_ts', Date.now().toString());
        cacheNativeStoragePermission(true);

        return {
            success: true,
            count: files.length,
            message: `Indexed **${files.length}** files from "${dirHandle.name}". I can now search and play files instantly!`,
        };
    } catch (e) {
        if (e.name === 'AbortError') {
            return { success: false, message: 'Folder selection cancelled.' };
        }
        return { success: false, message: `Error accessing files: ${e.message}` };
    }
}

// Android/Mobile fallback using <input type="file" webkitdirectory>
function _grantViaFileInput() {
    return new Promise((resolve) => {
        // Create a temporary file input with webkitdirectory
        const input = document.createElement('input');
        input.type = 'file';
        input.setAttribute('webkitdirectory', '');
        input.setAttribute('directory', '');
        input.multiple = true;
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', async () => {
            const selectedFiles = input.files;
            if (!selectedFiles || selectedFiles.length === 0) {
                input.remove();
                resolve({ success: false, message: 'No files selected.' });
                return;
            }

            const files = [];
            let folderName = 'Selected Folder';

            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                const name = file.name;
                const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
                // webkitRelativePath gives the folder structure
                const relativePath = file.webkitRelativePath || name;
                const pathParts = relativePath.split('/');
                if (i === 0 && pathParts.length > 1) {
                    folderName = pathParts[0];
                }
                const path = pathParts.slice(0, -1).join('/') || folderName;

                // Skip hidden files and system dirs
                if (name.startsWith('.') || relativePath.includes('node_modules/')) continue;

                files.push({
                    id: relativePath,
                    name,
                    nameLower: name.toLowerCase(),
                    path,
                    ext,
                    type: getFileType(ext),
                    handle: null, // No handle on Android — store the File object
                    file: file,   // Store the actual File object for reading
                });
            }

            // Store in IndexedDB
            try {
                const database = await openDB();
                await replaceIndexedStoreRecords(database, files);
            } catch {
                // IndexedDB write failed, still keep in memory
            }

            // Keep full index in memory
            fileIndex = files;
            notifyIndexUpdated();

            // Store stats
            localStorage.setItem('nice_file_count', files.length.toString());
            localStorage.setItem('nice_folder_name', folderName);
            localStorage.setItem('nice_last_scan', new Date().toLocaleString());
            localStorage.setItem('nice_last_scan_ts', Date.now().toString());
            cacheNativeStoragePermission(true);

            input.remove();
            resolve({
                success: true,
                count: files.length,
                message: `Indexed **${files.length}** files from "${folderName}". I can now search your files offline.`,
            });
        });

        // Handle cancel
        input.addEventListener('cancel', () => {
            input.remove();
            resolve({ success: false, message: 'Folder selection cancelled.' });
        });

        // Trigger the file picker
        input.click();
    });
}

// Android 13+ Fallback: Standard multiple file picker (no webkitdirectory)
// This skips the Scoped Storage limitations by letting the user hand-pick the PDFs/Docs explicitly
function _grantViaFilePickerFallback() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = ".pdf,.txt,.md,.jpg,.jpeg,.png,.csv,.tsv,.json,.html,.doc,.docx,.rtf,.xls,.xlsx,.xml,.log,.yaml,.yml";
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', async () => {
            const selectedFiles = input.files;
            if (!selectedFiles || selectedFiles.length === 0) {
                input.remove();
                resolve({ success: false, message: 'No files selected.' });
                return;
            }

            const files = [];
            const folderName = 'Selected Documents';

            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                const name = file.name;
                const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';

                // Allow specific types to save memory
                if (!['txt', 'md', 'pdf', 'jpg', 'jpeg', 'png', 'csv', 'tsv', 'json', 'html', 'doc', 'docx', 'rtf', 'xls', 'xlsx', 'xml', 'log', 'yaml', 'yml'].includes(ext)) continue;

                files.push({
                    id: `UserSelected/${name}`,
                    name,
                    nameLower: name.toLowerCase(),
                    path: folderName,
                    ext,
                    type: getFileType(ext),
                    handle: null, // No handle on Android
                    file: file,   // Store the actual File object for immediate reading
                });
            }

            // Store in IndexedDB
            try {
                const database = await openDB();
                await replaceIndexedStoreRecords(database, files);
            } catch {
                // IndexedDB write failed, still keep in memory
            }

            // Keep full index in memory
            fileIndex = files;
            notifyIndexUpdated();

            // Store stats
            localStorage.setItem('nice_file_count', files.length.toString());
            localStorage.setItem('nice_folder_name', folderName);
            localStorage.setItem('nice_last_scan', new Date().toLocaleString());
            localStorage.setItem('nice_last_scan_ts', Date.now().toString());
            cacheNativeStoragePermission(true);

            input.remove();
            resolve({
                success: true,
                count: files.length,
                message: `Ready. I loaded **${files.length}** selected files and can answer from them offline.`,
            });
        });

        // Handle cancel
        input.addEventListener('cancel', () => {
            input.remove();
            resolve({ success: false, message: 'File selection cancelled.' });
        });

        // Trigger the standard OS file picker
        input.click();
    });
}

/**
 * Load existing index from IndexedDB (called on startup)
 */
export async function loadFileIndex() {
    try {
        const database = await openDB();
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();

        return new Promise((resolve) => {
            req.onsuccess = () => {
                fileIndex = req.result || [];
                notifyIndexUpdated();
                resolve(fileIndex.length);
            };
            req.onerror = () => resolve(0);
        });
    } catch {
        return 0;
    }
}

/**
 * Auto-rescan using the previously saved directory handle.
 * Called on every app launch — re-indexes files WITH live handles
 * so the knowledge engine can read file contents.
 * Returns { success, count } or { success: false }
 */
export async function autoRescanFromSavedHandle() {
    return await runSingleFlightScan(async () => {
        if (Capacitor.isNativePlatform()) {
            try {
                let perm = await Filesystem.checkPermissions();
                if (perm.publicStorage !== 'granted' && perm.publicStorage !== 'limited') {
                    perm = await Filesystem.requestPermissions();
                }
                if (perm.publicStorage !== 'granted' && perm.publicStorage !== 'limited') {
                    cacheNativeStoragePermission(false);
                    console.log('[Nice] Storage permission not granted, skipping auto-rescan');
                    return { success: false };
                }
                cacheNativeStoragePermission(true);

                // Throttle: don't re-index if scanned recently
                let lastTime = Number(localStorage.getItem('nice_last_scan_ts') || '');
                if (!Number.isFinite(lastTime) || lastTime <= 0) {
                    const lastScan = localStorage.getItem('nice_last_scan');
                    if (lastScan) {
                        const parsedTime = new Date(lastScan).getTime();
                        if (Number.isFinite(parsedTime) && parsedTime > 0) {
                            lastTime = parsedTime;
                        }
                    }
                }
                if (Number.isFinite(lastTime) && (Date.now() - lastTime < 2 * 60 * 1000)) {
                    const count = await loadFileIndex();
                    if (count > 0) {
                        console.log('[Nice] Loaded', count, 'files from cache');
                        cacheNativeStoragePermission(true);
                        return { success: true, count };
                    }
                }

                // Android 13 Bugfix: If native scan fails/finds 0 files, load from DB
                const result = await _grantViaCapacitor();
                if (!result.success || result.count === 0) {
                    console.log('[Nice] Auto-rescan native failed. Loading from IndexedDB cache...');
                    const count = await loadFileIndex();
                    if (count > 0) {
                        cacheNativeStoragePermission(true);
                        return { success: true, count };
                    }
                }
                if (result?.success) cacheNativeStoragePermission(true);
                return result;
            } catch (e) {
                console.warn('[Nice] Auto-rescan error:', e);
                const count = await loadFileIndex();
                // Fallback to cache if error occurs
                if (count > 0) {
                    cacheNativeStoragePermission(true);
                    return { success: true, count };
                }
                cacheNativeStoragePermission(false);
                return { success: false };
            }
        }

        try {
            const database = await openDB();
            const tx = database.transaction(HANDLES_STORE, 'readonly');
            const store = tx.objectStore(HANDLES_STORE);

            return new Promise((resolve) => {
                const req = store.get('root');
                req.onsuccess = async () => {
                    const record = req.result;
                    if (!record || !record.handle) {
                        resolve({ success: false });
                        return;
                    }

                    const dirHandle = record.handle;

                    // Verify we still have permission
                    try {
                        const perm = await dirHandle.queryPermission({ mode: 'read' });
                        if (perm !== 'granted') {
                            // Try to request silently — will succeed if previously granted
                            const newPerm = await dirHandle.requestPermission({ mode: 'read' });
                            if (newPerm !== 'granted') {
                                resolve({ success: false });
                                return;
                            }
                        }
                    } catch {
                        resolve({ success: false });
                        return;
                    }

                    // Re-index all files with live handles
                    const files = [];
                    async function indexDir(handle, path) {
                        try {
                            for await (const entry of handle.values()) {
                                if (entry.kind === 'file') {
                                    const name = entry.name;
                                    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
                                    files.push({
                                        id: `${path}/${name}`,
                                        name,
                                        nameLower: name.toLowerCase(),
                                        path,
                                        ext,
                                        type: getFileType(ext),
                                        handle: entry,
                                    });
                                } else if (entry.kind === 'directory') {
                                    if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                                        await indexDir(entry, `${path}/${entry.name}`);
                                    }
                                }
                            }
                        } catch {
                            // Skip dirs we can't read
                        }
                    }

                    await indexDir(dirHandle, record.name || 'Storage');

                    // Update memory index
                    fileIndex = files;
                    notifyIndexUpdated();

                    // Update IndexedDB metadata
                    try {
                        await replaceIndexedStoreRecords(database, files);
                    } catch { /* ok */ }

                    localStorage.setItem('nice_file_count', files.length.toString());
                    localStorage.setItem('nice_last_scan', new Date().toLocaleString());
                    localStorage.setItem('nice_last_scan_ts', Date.now().toString());

                    resolve({ success: true, count: files.length });
                };
                req.onerror = () => resolve({ success: false });
            });
        } catch {
            return { success: false };
        }
    });
}

/**
 * Search files by name — instant fuzzy search
 */
export function searchFiles(query) {
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const words = q.split(/\s+/);

    // Score each file
    const scored = fileIndex
        .map(f => {
            let score = 0;
            const name = f.nameLower;

            // Exact name match
            if (name === q) score += 100;
            // Name contains full query
            else if (name.includes(q)) score += 50;
            // All words found in name
            else if (words.every(w => name.includes(w))) score += 30;
            // Some words found
            else {
                const matchCount = words.filter(w => name.includes(w) || f.path.toLowerCase().includes(w)).length;
                if (matchCount > 0) score += matchCount * 10;
            }

            // Path match bonus
            if (f.path.toLowerCase().includes(q)) score += 5;

            return { ...f, score };
        })
        .filter(f => f.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

    return scored;
}

function normalizeFileLookupName(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function sanitizeRequestedFileName(fileName) {
    let value = String(fileName || '').trim();
    if (!value) return '';

    // Strip markdown emphasis/quotes and trailing sentence punctuation.
    value = value
        .replace(/^\*+|\*+$/g, '')
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/[.,!?;:)\]]+$/g, '')
        .trim();

    // If a path was pasted, keep only the final segment for matching.
    const parts = value.split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : value;
}

export function findFileById(fileId) {
    const key = String(fileId || '').trim();
    if (!key) return null;
    return fileIndex.find(f => f.id === key) || null;
}

export function findExactFileByName(fileName) {
    const cleanName = sanitizeRequestedFileName(fileName);
    const target = normalizeFileLookupName(cleanName);
    if (!target) return null;

    const exact = fileIndex.find(f => normalizeFileLookupName(f.name) === target);
    if (exact) return exact;

    // Secondary pass: allow omitted extension only when unambiguous.
    const withoutExtMatches = fileIndex.filter(f => {
        const withoutExt = normalizeFileLookupName(f.name.replace(/\.[^.]+$/, ''));
        return withoutExt === target;
    });
    if (withoutExtMatches.length === 1) {
        return withoutExtMatches[0];
    }

    return null;
}

/**
 * Search specifically for audio files
 */
export function findAudioFiles(query) {
    const q = query.toLowerCase().trim();
    const audioFiles = fileIndex.filter(f => f.type === 'audio');

    if (!q) return audioFiles.slice(0, 20);

    const words = q.split(/\s+/).filter(w => !['play', 'song', 'music', 'the', 'by', 'from', 'a', 'an'].includes(w));

    return audioFiles
        .map(f => {
            let score = 0;
            // Clean name: remove extension, track numbers, underscores, hyphens
            const name = f.nameLower
                .replace(/\.[^.]+$/, '')     // Remove extension
                .replace(/^\d+[.\-_\s]+/, '') // Strip leading track numbers
                .replace(/[_-]/g, ' ')        // Normalize separators
                .trim();

            if (name.includes(q)) score += 50;
            else if (words.length && words.every(w => name.includes(w))) score += 30;
            else {
                // Single word matches with higher granularity
                const matchCount = words.filter(w => name.includes(w)).length;
                if (matchCount > 0) score += matchCount * 15;
                // Also check path for artist/album folders
                const pathMatches = words.filter(w => (f.path || '').toLowerCase().includes(w)).length;
                if (pathMatches > 0) score += pathMatches * 5;
            }
            return { ...f, score };
        })
        .filter(f => f.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
}

/**
 * Play an audio file from the index
 */
export async function playAudioFile(fileEntry) {
    try {
        // Native Android: resolve a durable URI first, then convert for WebView playback.
        if (fileEntry.capacitorPath) {
            const directory = getEntryDirectory(fileEntry);
            let webUrl = null;

            try {
                const uriResult = await Filesystem.getUri({
                    path: fileEntry.capacitorPath,
                    directory,
                });
                if (uriResult?.uri) {
                    webUrl = Capacitor.convertFileSrc(uriResult.uri);
                }
            } catch {
                // Continue with direct path conversion fallback.
            }

            if (!webUrl) {
                webUrl = Capacitor.convertFileSrc(fileEntry.capacitorPath);
            }

            let result = await playAudioUrl(webUrl, fileEntry.name, { revokeUrlOnStop: false });
            if (result.success) {
                return result;
            }

            // Fallback: fetch bytes and play via blob URL if direct WebView stream fails.
            try {
                const response = await fetch(webUrl, { cache: 'no-store' });
                if (response.ok) {
                    const blob = await response.blob();
                    const objectUrl = URL.createObjectURL(blob);
                    result = await playAudioUrl(objectUrl, fileEntry.name, { revokeUrlOnStop: true });
                    if (result.success) {
                        return result;
                    }
                }
            } catch (fallbackErr) {
                console.warn('[Nice] Audio fetch fallback failed:', fallbackErr?.message || fallbackErr);
            }

            return {
                success: false,
                message: 'Could not start audio playback for this file. Try another song or re-scan your files.',
            };
        }

        // Web Desktop: If we have a file handle (in-memory from current session)
        if (fileEntry.handle) {
            const file = await fileEntry.handle.getFile();
            const url = URL.createObjectURL(file);
            return await playAudioUrl(url, fileEntry.name, { revokeUrlOnStop: true });
        }

        return { success: false, message: 'File access expired. Please re-scan your files with "scan my files".' };
    } catch (e) {
        return { success: false, message: "Couldn't play file: " + e.message };
    }
}

/**
 * Play audio from a URL/blob
 */
async function playAudioUrl(url, name, opts = {}) {
    const revokeUrlOnStop = !!opts.revokeUrlOnStop;

    // Stop existing
    if (audioPlayer) {
        audioPlayer.pause();
        if (audioPlayer._objectUrl) URL.revokeObjectURL(audioPlayer._objectUrl);
    }
    stopMusicProgressUpdates();

    audioPlayer = new Audio(url);
    audioPlayer._objectUrl = revokeUrlOnStop ? url : null;
    audioPlayer.volume = 1.0;
    audioPlayer.muted = false;
    audioPlayer.playsInline = true;
    audioPlayer.preload = 'auto';

    const cleanName = name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
    currentAudioFile = cleanName;

    try {
        const playPromise = audioPlayer.play();
        if (playPromise && typeof playPromise.then === 'function') {
            await playPromise;
        }
    } catch (err) {
        console.warn('[Nice] Audio playback failed for "' + cleanName + '":', err?.message || err);
        if (audioPlayer._objectUrl) URL.revokeObjectURL(audioPlayer._objectUrl);
        audioPlayer = null;
        currentAudioFile = null;
        updateRealMusicPlayer(null, false);
        return {
            success: false,
            message: 'Audio playback could not start. Check media volume and try again.',
        };
    }

    // Create/update the real audio player UI
    updateRealMusicPlayer(cleanName, true);

    audioPlayer.addEventListener('ended', () => {
        stopMusicProgressUpdates();
        updateRealMusicPlayer(cleanName, false);
        currentAudioFile = null;
    });

    audioPlayer.addEventListener('error', () => {
        stopMusicProgressUpdates();
        updateRealMusicPlayer(cleanName, false);
    });

    return { success: true, message: 'Now playing: **' + cleanName + '**' };
}

function getEntryDirectory(entry) {
    return entry.capacitorDirectory || Directory.ExternalStorage;
}

/**
 * Pause real audio playback
 */
export function pauseRealAudio() {
    if (audioPlayer && !audioPlayer.paused) {
        audioPlayer.pause();
        stopMusicProgressUpdates();
        updateRealMusicPlayer(currentAudioFile, false);
        return true;
    }
    return false;
}

/**
 * Resume real audio playback
 */
export function resumeRealAudio() {
    if (audioPlayer && audioPlayer.paused && audioPlayer.src) {
        audioPlayer.play().catch(() => { });
        startMusicProgressUpdates();
        updateRealMusicPlayer(currentAudioFile, true);
        return true;
    }
    return false;
}

/**
 * Stop real audio playback
 */
export function stopRealAudio() {
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        if (audioPlayer._objectUrl) URL.revokeObjectURL(audioPlayer._objectUrl);
        stopMusicProgressUpdates();
        audioPlayer = null;
        currentAudioFile = null;
        updateRealMusicPlayer(null, false);
        return true;
    }
    return false;
}

export function isRealAudioPlaying() {
    return audioPlayer && !audioPlayer.paused;
}

/**
 * Real music player UI with progress
 */
function updateRealMusicPlayer(songName, isPlaying) {
    let player = document.getElementById('musicPlayer');
    if (!player) {
        player = document.createElement('div');
        player.id = 'musicPlayer';
        player.className = 'music-player';
        player.innerHTML = `
      <div class="music-player-content">
        <span class="music-icon">🎵</span>
        <div class="music-info">
          <span class="music-title" id="musicTitle">Now Playing</span>
          <div class="music-progress-bar" id="musicProgressBar">
            <div class="music-progress" id="musicProgress"></div>
          </div>
        </div>
        <div class="music-controls">
          <button class="music-ctrl-btn" id="musicPauseResume" aria-label="Pause/Resume">⏸️</button>
          <button class="music-ctrl-btn" id="musicStop" aria-label="Stop">⏹️</button>
        </div>
      </div>
    `;
        document.body.appendChild(player);

        document.getElementById('musicPauseResume').addEventListener('click', () => {
            if (audioPlayer && !audioPlayer.paused) pauseRealAudio();
            else resumeRealAudio();
        });
        document.getElementById('musicStop').addEventListener('click', () => stopRealAudio());
    }

    if (songName) {
        document.getElementById('musicTitle').textContent = songName;
    }

    const btn = document.getElementById('musicPauseResume');
    if (btn) btn.textContent = isPlaying ? '⏸️' : '▶️';
    player.classList.toggle('visible', isPlaying || (audioPlayer && audioPlayer.paused && audioPlayer.src));
    if (!isPlaying) {
        const bar = document.getElementById('musicProgress');
        if (bar) bar.style.width = '0%';
    }

    if (audioPlayer && isPlaying) {
        startMusicProgressUpdates();
    } else {
        stopMusicProgressUpdates();
    }
}

/**
 * Open/download a file from the index
 */
export const INLINE_TEXT_PREVIEW_EXTS = new Set([
    'txt', 'md', 'json', 'csv', 'tsv', 'html', 'css', 'js', 'xml', 'log',
    'ini', 'cfg', 'yaml', 'yml', 'toml', 'rtf',
]);

export function getMimeTypeForEntry(fileEntry) {
    const ext = String(fileEntry?.ext || '').toLowerCase();
    const byExt = {
        txt: 'text/plain',
        md: 'text/markdown',
        json: 'application/json',
        csv: 'text/csv',
        tsv: 'text/tab-separated-values',
        html: 'text/html',
        css: 'text/css',
        js: 'text/javascript',
        xml: 'application/xml',
        log: 'text/plain',
        ini: 'text/plain',
        cfg: 'text/plain',
        yaml: 'text/yaml',
        yml: 'text/yaml',
        toml: 'text/plain',
        pdf: 'application/pdf',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        bmp: 'image/bmp',
        gif: 'image/gif',
        heic: 'image/heic',
        heif: 'image/heif',
        tif: 'image/tiff',
        tiff: 'image/tiff',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        ogg: 'audio/ogg',
        flac: 'audio/flac',
        mp4: 'video/mp4',
        webm: 'video/webm',
        mkv: 'video/x-matroska',
        mov: 'video/quicktime',
        crypt: 'application/octet-stream',
    };
    return byExt[ext] || 'application/octet-stream';
}

async function resolveNativeFileUrls(fileEntry, directory) {
    let nativeUri = '';
    let webUrl = '';

    try {
        const uriResult = await Filesystem.getUri({
            path: fileEntry.capacitorPath,
            directory,
        });
        if (uriResult?.uri) {
            nativeUri = uriResult.uri;
            webUrl = Capacitor.convertFileSrc(uriResult.uri);
        }
    } catch {
        // Continue with best-effort path fallback.
    }

    if (!nativeUri) {
        const fromPath = normalizeNativeUriCandidate(fileEntry?.capacitorPath);
        if (fromPath) nativeUri = fromPath;
    }

    if (!webUrl) {
        const previewSource = nativeUri || fileEntry.capacitorPath;
        if (previewSource) {
            webUrl = Capacitor.convertFileSrc(previewSource);
        }
    }

    return { nativeUri, webUrl };
}

function normalizeNativeUriCandidate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(?:content|file|intent|android-app):/i.test(raw)) return raw;
    if (/^\//.test(raw)) return `file://${raw}`;
    return '';
}

function buildAndroidViewIntentUrl(uri, mimeType) {
    const safeUri = String(uri || '').trim();
    if (!safeUri) return '';
    const payload = encodeURIComponent(safeUri);
    const mime = encodeURIComponent(String(mimeType || 'application/octet-stream'));
    return `intent:${payload}#Intent;action=android.intent.action.VIEW;type=${mime};end`;
}

function normalizeBase64Payload(data) {
    if (typeof data !== 'string') return '';
    const trimmed = data.trim();
    if (!trimmed) return '';
    const dataPrefix = 'base64,';
    const idx = trimmed.indexOf(dataPrefix);
    return idx >= 0 ? trimmed.slice(idx + dataPrefix.length) : trimmed;
}

function base64ToBlobUrl(base64Payload, mimeType = 'application/octet-stream') {
    if (!base64Payload) return '';
    try {
        const binary = atob(base64Payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });
        return URL.createObjectURL(blob);
    } catch {
        return '';
    }
}

async function resolveNativePreviewUrl(fileEntry, directory, mimeType) {
    try {
        const raw = await Filesystem.readFile({
            path: fileEntry.capacitorPath,
            directory,
        });
        const payload = normalizeBase64Payload(raw?.data);
        const blobUrl = base64ToBlobUrl(payload, mimeType);
        if (blobUrl) return blobUrl;
    } catch {
        // Continue with URI+fetch fallback.
    }

    try {
        const { webUrl } = await resolveNativeFileUrls(fileEntry, directory);
        if (!webUrl) return '';

        const resp = await fetch(webUrl);
        if (resp.ok) {
            const blob = await resp.blob();
            if (blob && blob.size > 0) {
                return URL.createObjectURL(blob);
            }
        }

        return webUrl;
    } catch {
        return '';
    }
}

async function readNativeTextWithFallback(fileEntry, directory) {
    try {
        const txtResp = await Filesystem.readFile({
            path: fileEntry.capacitorPath,
            directory,
            encoding: 'utf8',
        });
        if (typeof txtResp?.data === 'string' && txtResp.data.length > 0) {
            return txtResp.data;
        }
    } catch {
        // Continue to URI+fetch fallback.
    }

    try {
        const { webUrl } = await resolveNativeFileUrls(fileEntry, directory);
        if (!webUrl) return '';
        const resp = await fetch(webUrl, { cache: 'no-store' });
        if (!resp.ok) return '';
        const rawBuffer = await resp.arrayBuffer();
        const decoder = new TextDecoder('utf-8', { fatal: false });
        return decoder.decode(rawBuffer);
    } catch {
        return '';
    }
}

async function tryOpenNativeExternally(fileEntry, nativeUri, webUrl) {
    const mimeType = getMimeTypeForEntry(fileEntry);
    const nativeCandidates = [];
    const normalizedUri = normalizeNativeUriCandidate(nativeUri);
    const normalizedPathUri = normalizeNativeUriCandidate(fileEntry?.capacitorPath);
    if (normalizedUri) nativeCandidates.push(normalizedUri);
    if (normalizedPathUri && !nativeCandidates.includes(normalizedPathUri)) {
        nativeCandidates.push(normalizedPathUri);
    }

    if (nativeCandidates.length === 0) return false;

    for (const url of nativeCandidates) {
        try {
            await AppLauncher.openUrl({ url });
            return true;
        } catch {
            // Try intent-based fallback for this native URI.
        }
        try {
            const intentUrl = buildAndroidViewIntentUrl(url, mimeType);
            if (!intentUrl) continue;
            await AppLauncher.openUrl({ url: intentUrl });
            return true;
        } catch {
            // Try next native URI candidate.
        }
    }

    // Last fallback: fire Android VIEW intent via anchor click.
    for (const url of nativeCandidates) {
        try {
            const intentUrl = buildAndroidViewIntentUrl(url, mimeType);
            if (!intentUrl) continue;
            const a = document.createElement('a');
            a.href = intentUrl;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.click();
            return true;
        } catch {
            // Try next candidate.
        }
    }

    // Never treat localhost/WebView preview URLs as "external open success".
    return false;
}

export async function openFile(fileEntry, opts = {}) {
    try {
        // Handle Native Android Capacitor Routing
        if (fileEntry.capacitorPath) {
            const directory = getEntryDirectory(fileEntry);
            const { nativeUri, webUrl } = await resolveNativeFileUrls(fileEntry, directory);
            const extLower = String(fileEntry.ext || '').toLowerCase();

            // In-app preview first for real assistant UX.
            if (fileEntry.type === 'image') {
                const previewUrl = await resolveNativePreviewUrl(fileEntry, directory, getMimeTypeForEntry(fileEntry));
                if (previewUrl) {
                    showFilePreview(previewUrl, fileEntry.name, 'image', opts);
                    return { success: true, message: `Showing **${fileEntry.name}**` };
                }
            }
            if (extLower === 'pdf') {
                const previewUrl = await resolveNativePreviewUrl(fileEntry, directory, 'application/pdf');
                if (previewUrl) {
                    showFilePreview(previewUrl, fileEntry.name, 'pdf', opts);
                    return { success: true, message: `Showing **${fileEntry.name}**` };
                }
            }
            if (INLINE_TEXT_PREVIEW_EXTS.has(extLower)) {
                try {
                    const stat = await Filesystem.stat({ path: fileEntry.capacitorPath, directory });
                    if (stat.size > 2 * 1024 * 1024) {
                        // For very large text files, try external open rather than failing immediately.
                        const openedLarge = await tryOpenNativeExternally(fileEntry, nativeUri, webUrl);
                        if (openedLarge) {
                            return { success: true, message: `Opened **${fileEntry.name}** in a device app (large file).` };
                        }
                        return { success: false, message: `File is too large (${Math.round(stat.size / 1024 / 1024)}MB). Could not preview safely.` };
                    }
                } catch { /* ignore stat error */ }

                const text = await readNativeTextWithFallback(fileEntry, directory);
                if (text && text.trim().length > 0) {
                    showFilePreview(text, fileEntry.name, 'text', opts);
                    return { success: true, message: `Showing **${fileEntry.name}**` };
                }
            }

            // External fallback for unsupported or unrenderable native file types.
            const opened = await tryOpenNativeExternally(fileEntry, nativeUri, webUrl);
            if (opened) {
                return {
                    success: true,
                    message: `Opened **${fileEntry.name}** in a device app.`,
                };
            }
            return {
                success: false,
                message: `I could not open **${fileEntry.name}** automatically. Try opening it from your Files app.`,
            };
        }

        // Handle Desktop Web File Handlers
        if (fileEntry.handle) {
            const file = await fileEntry.handle.getFile();
            const url = URL.createObjectURL(file);

            // Images: show inline
            if (fileEntry.type === 'image') {
                showFilePreview(url, fileEntry.name, 'image', opts);
                return { success: true, message: `Showing **${fileEntry.name}**` };
            }

            if (String(fileEntry.ext || '').toLowerCase() === 'pdf') {
                showFilePreview(url, fileEntry.name, 'pdf', opts);
                return { success: true, message: `Showing **${fileEntry.name}**` };
            }

            // Text files: read and show
            if (INLINE_TEXT_PREVIEW_EXTS.has(String(fileEntry.ext || '').toLowerCase())) {
                const text = await file.text();
                showFilePreview(text, fileEntry.name, 'text', opts);
                return { success: true, message: `Showing **${fileEntry.name}**` };
            }

            // Everything else: download
            const a = document.createElement('a');
            a.href = url;
            a.download = fileEntry.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            return { success: true, message: `Downloading **${fileEntry.name}**...` };
        }

        return { success: false, message: 'File access expired. Say "scan my files" to re-index.' };
    } catch (e) {
        return { success: false, message: `Couldn't open file: ${e.message}` };
    }
}

function showFilePreview(url, name, type, opts = {}) {
    let modal = document.getElementById('filePreviewModal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'filePreviewModal';
    modal.className = 'camera-modal'; // Reuse camera modal styles

    const content = document.createElement('div');
    content.className = 'camera-modal-content';

    const header = document.createElement('div');
    header.className = 'camera-header';

    const title = document.createElement('span');
    title.textContent = `📄 ${name}`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'camera-close';
    closeBtn.id = 'previewClose';
    closeBtn.textContent = '✕';

    header.appendChild(title);
    header.appendChild(closeBtn);
    content.appendChild(header);

    const escapeHtml = (str) => String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const escapeRegExp = (str) => String(str || '').replace(/([.*+?^${}()|\\[\\]\\\\])/g, '\\$1');
    const collectTokens = (text, limit = 6) => String(text || '')
        .split(/[^A-Za-z0-9]+/)
        .filter(t => t.length > 3)
        .slice(0, limit);
    const buildHighlightTokens = (snippet, query) => {
        return [...new Set([
            ...collectTokens(query, 8),
            ...collectTokens(snippet, 8),
        ])].slice(0, 12);
    };

    const highlight = opts?.highlight || {};
    const snippetText = String(highlight.snippet || '').trim();
    const queryText = String(highlight.query || '').trim();
    const highlightTokens = buildHighlightTokens(snippetText, queryText);
    const hasHighlight = highlightTokens.length > 0 || snippetText.length > 0 || queryText.length > 0;

    const applyHighlight = (text) => {
        let html = escapeHtml(text || '');
        for (const token of highlightTokens) {
            if (!token) continue;
            const re = new RegExp(`(${escapeRegExp(token)})`, 'ig');
            html = html.replace(re, '<mark>$1</mark>');
        }
        return html;
    };

    if (hasHighlight) {
        const pill = document.createElement('span');
        pill.textContent = 'match';
        pill.style.marginLeft = '8px';
        pill.style.fontSize = '12px';
        pill.style.padding = '4px 8px';
        pill.style.background = 'var(--accent, #1f8efa)';
        pill.style.color = '#fff';
        pill.style.borderRadius = '999px';
        header.insertBefore(pill, closeBtn);
    }

    const snippetForCard = snippetText || queryText;
    const maybeAddSnippetCard = () => {
        if (!hasHighlight || !snippetForCard) return null;
        const card = document.createElement('div');
        card.style.margin = '12px 0';
        card.style.padding = '10px 12px';
        card.style.borderRadius = '10px';
        card.style.background = 'var(--bg-tertiary, #f3f6fb)';
        card.style.color = 'var(--text-primary, #111)';
        card.innerHTML = `<strong>Matched snippet</strong><br>${applyHighlight(snippetForCard.substring(0, 380))}`;
        return card;
    };

    if (type === 'image') {
        const img = document.createElement('img');
        img.src = String(url || '');
        img.alt = String(name || 'preview');
        img.style.maxWidth = '100%';
        img.style.borderRadius = '8px';
        content.appendChild(img);
    } else if (type === 'pdf') {
        const note = maybeAddSnippetCard();
        if (note) content.appendChild(note);

        const frame = document.createElement('iframe');
        frame.src = String(url || '');
        frame.title = `Preview ${name}`;
        frame.style.width = '100%';
        frame.style.minHeight = '72vh';
        frame.style.border = '0';
        frame.style.borderRadius = '8px';
        content.appendChild(frame);
    } else if (type === 'text') {
        const note = maybeAddSnippetCard();
        if (note) content.appendChild(note);

        const block = document.createElement('pre');
        const body = String(url || '');
        block.innerHTML = hasHighlight ? applyHighlight(body) : escapeHtml(body);
        block.style.whiteSpace = 'pre-wrap';
        block.style.wordBreak = 'break-word';
        block.style.maxHeight = '72vh';
        block.style.overflow = 'auto';
        block.style.padding = '12px';
        block.style.margin = '0';
        block.style.borderRadius = '8px';
        block.style.background = 'var(--bg-tertiary, #f5f5f5)';
        block.style.color = 'var(--text-primary, #111)';
        content.appendChild(block);

        if (hasHighlight) {
            requestAnimationFrame(() => {
                const firstMark = block.querySelector('mark');
                if (firstMark && typeof firstMark.scrollIntoView === 'function') {
                    firstMark.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }
            });
        }
    }

    modal.appendChild(content);
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('visible'));

    const shouldRevoke = typeof url === 'string' && url.startsWith('blob:');
    closeBtn.addEventListener('click', () => {
        modal.classList.remove('visible');
        setTimeout(() => {
            modal.remove();
            if (shouldRevoke) {
                URL.revokeObjectURL(url);
            }
        }, 300);
    });
}

/**
 * Get storage statistics
 */
export function getStorageStats() {
    const total = fileIndex.length;
    if (total === 0) {
        const lastCount = localStorage.getItem('nice_file_count');
        if (lastCount) {
            return `Last scan: ${lastCount} files from "${localStorage.getItem('nice_folder_name') || 'unknown'}"\nScanned: ${localStorage.getItem('nice_last_scan') || 'unknown'}\n\nSay **"scan my files"** to re-index.`;
        }
        return 'No files indexed yet. Say **"scan my files"** to grant access to a folder.';
    }

    const types = {};
    fileIndex.forEach(f => { types[f.type] = (types[f.type] || 0) + 1; });

    const breakdown = Object.entries(types)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `  • ${type}: ${count}`)
        .join('\n');

    const folderName = localStorage.getItem('nice_folder_name') || 'storage';

    return `📊 **Storage: ${total} files** in "${folderName}"\n\n${breakdown}\n\nSay "find [name]" to search or "play [song]" to play music.`;
}

/**
 * Check if file system access is available
 */
export function isFileSystemAvailable() {
    return 'showDirectoryPicker' in window;
}

/**
 * Get count of indexed files
 */
export function getIndexedFileCount() {
    return fileIndex.length;
}

/**
 * Live check for storage permission/access state used by Settings UI.
 * Returns true only when permissions are currently granted or a native file probe succeeds.
 */
async function canReadIndexedNativeFile() {
    const samples = fileIndex.filter(f => !!f.capacitorPath).slice(0, 3);
    for (const entry of samples) {
        try {
            const directory = getEntryDirectory(entry);
            await Filesystem.stat({ path: entry.capacitorPath, directory });
            return true;
        } catch {
            // Try next sample.
        }
    }
    return false;
}

export async function checkStoragePermission() {
    if (Capacitor.isNativePlatform()) {
        const cachedGranted = typeof localStorage !== 'undefined'
            && localStorage.getItem('nice_storage_granted') === 'true';
        let explicitDenied = false;
        try {
            const perm = await Filesystem.checkPermissions();
            if (perm?.publicStorage === 'granted' || perm?.publicStorage === 'limited') {
                cacheNativeStoragePermission(true);
                return true;
            }
            if (perm?.publicStorage === 'denied') {
                explicitDenied = true;
                cacheNativeStoragePermission(false);
            }
        } catch {
            // Fall through to file probe.
        }
        if (fileIndex.length === 0) {
            try {
                await loadFileIndex();
            } catch {
                // Continue with fallback probes.
            }
        }
        const canReadFiles = await canReadIndexedNativeFile();
        if (canReadFiles) {
            cacheNativeStoragePermission(true);
            return true;
        }
        if (!explicitDenied && cachedGranted) {
            // Keep UI stable between startup checks while native index/probe warms up.
            return true;
        }
        cacheNativeStoragePermission(false);
        return false;
    }

    return fileIndex.some(f => !!f.handle || !!f.file);
}

/**
 * Get all file entries with handles or File objects (for knowledge engine to read)
 * Desktop files have .handle, Android files have .file or .capacitorPath
 */
export function getReadableFiles() {
    return fileIndex.filter(f => f.handle || f.file || f.capacitorPath);
}

/**
 * Detect files that have been deleted since last index
 * Compares current directory contents with stored index
 */
export async function detectDeletedFiles() {
    const filesWithHandles = fileIndex.filter(f => f.handle);
    const deletedFiles = [];

    for (const entry of filesWithHandles) {
        try {
            await entry.handle.getFile();
        } catch {
            // File no longer accessible — likely deleted
            deletedFiles.push(entry);
        }
    }

    if (deletedFiles.length > 0) {
        // Remove deleted files from index
        const deletedIds = new Set(deletedFiles.map(f => f.id));
        fileIndex = fileIndex.filter(f => !deletedIds.has(f.id));
        notifyIndexUpdated();

        // Update IndexedDB
        try {
            const database = await openDB();
            const tx = database.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            for (const df of deletedFiles) {
                store.delete(df.id);
            }
            localStorage.setItem('nice_file_count', fileIndex.length.toString());
            localStorage.setItem('nice_last_scan_ts', Date.now().toString());
        } catch {
            // Ignore DB errors
        }
    }

    return deletedFiles.map(f => f.name);
}

export async function detectDeletedFilesQuick(limit = 120) {
    const filesWithHandles = fileIndex.filter(f => f.handle).slice(0, Math.max(1, limit));
    const deletedFiles = [];

    for (const entry of filesWithHandles) {
        try {
            await entry.handle.getFile();
        } catch {
            deletedFiles.push(entry);
        }
    }

    if (deletedFiles.length > 0) {
        const deletedIds = new Set(deletedFiles.map(f => f.id));
        fileIndex = fileIndex.filter(f => !deletedIds.has(f.id));
        notifyIndexUpdated();

        try {
            const database = await openDB();
            const tx = database.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            for (const df of deletedFiles) {
                store.delete(df.id);
            }
            localStorage.setItem('nice_file_count', fileIndex.length.toString());
            localStorage.setItem('nice_last_scan_ts', Date.now().toString());
        } catch {
            // Ignore DB errors
        }
    }

    return deletedFiles.map(f => f.name);
}

export async function runIncrementalIndexMaintenance(opts = {}) {
    const now = Date.now();
    const force = !!opts.force;
    const minIntervalMs = Number.isFinite(opts.minIntervalMs) ? Math.max(30_000, opts.minIntervalMs) : 180_000;
    const quickSampleLimit = Number.isFinite(opts.quickSampleLimit) ? Math.max(20, opts.quickSampleLimit) : 120;
    const markerKey = 'nice_last_index_maintenance_ts';
    const lastTs = Number(localStorage.getItem(markerKey) || '0');

    if (!force && Number.isFinite(lastTs) && (now - lastTs) < minIntervalMs) {
        return { success: true, skipped: true, reason: 'cooldown' };
    }

    localStorage.setItem(markerKey, String(now));

    // Desktop quick-delete cleanup first.
    if (!Capacitor.isNativePlatform()) {
        const removed = await detectDeletedFilesQuick(quickSampleLimit);
        if (removed.length > 0) {
            return {
                success: true,
                skipped: false,
                mode: 'quick_cleanup',
                removedCount: removed.length,
                count: fileIndex.length,
            };
        }
    }

    // Native or stale index: refresh from saved access source.
    const indexedCount = getIndexedFileCount();
    const lastScanTs = Number(localStorage.getItem('nice_last_scan_ts') || '0');
    const scanStale = !Number.isFinite(lastScanTs) || (now - lastScanTs) > Math.max(minIntervalMs, 10 * 60 * 1000);

    if (force || indexedCount === 0 || scanStale) {
        const rescan = await autoRescanFromSavedHandle();
        if (rescan?.success) {
            return { success: true, skipped: false, mode: 'rescan', count: Number(rescan.count || 0) };
        }
        return { success: false, skipped: false, mode: 'rescan_failed', message: rescan?.message || 'rescan failed' };
    }

    return { success: true, skipped: true, reason: 'healthy' };
}

let _maintenanceTimer = null;
function startIndexMaintenanceWatchers() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (typeof document.addEventListener !== 'function' || typeof window.addEventListener !== 'function') return;
    if (_maintenanceTimer) return;

    const tick = () => {
        void runIncrementalIndexMaintenance({
            minIntervalMs: 120_000,
            quickSampleLimit: 120,
        }).catch(() => { });
    };

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) tick();
    });
    window.addEventListener('focus', tick);

    _maintenanceTimer = setInterval(tick, 2 * 60 * 1000);
    tick();
}

startIndexMaintenanceWatchers();

/**
 * Get the current file index for comparison
 */
export function getFileIndex() {
    return fileIndex;
}





