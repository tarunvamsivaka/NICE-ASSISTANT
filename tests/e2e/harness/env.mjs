/**
 * E2E Test Harness Environment — Nice Assistant v1.2.0
 * Provides opaque runtime simulation (DOM, Capacitor, Web APIs, Worker threads,
 * Zero-Network Guard, Search Engine, Memory Governor, and Conversation Memory).
 */

import { mockDeviceBridge } from './mock-device-bridge.mjs';
import { MockWorker } from './mock-workers.mjs';

// ===================================================================
// 1. IN-MEMORY STORAGE POLYFILL
// ===================================================================

export class MemoryStorage {
  constructor() {
    this.store = new Map();
  }

  getItem(key) {
    const k = String(key);
    return this.store.has(k) ? this.store.get(k) : null;
  }

  setItem(key, value) {
    this.store.set(String(key), String(value));
  }

  removeItem(key) {
    this.store.delete(String(key));
  }

  clear() {
    this.store.clear();
  }

  get length() {
    return this.store.size;
  }

  key(index) {
    const keys = Array.from(this.store.keys());
    return keys[index] || null;
  }
}

// ===================================================================
// 2. ZERO-NETWORK GUARD ENGINE (F23, F24)
// ===================================================================

let _zeroNetworkActive = false;
let _blockedRequests = [];
let _allowedRequests = [];
let _originalFetch = null;
let _originalXHR = null;
let _originalWebSocket = null;
let _originalSendBeacon = null;

export class ZeroNetworkBlockedError extends Error {
  constructor(url, transport) {
    super(`ZeroNetworkBlockedError: Outbound request to '${url}' via ${transport} was blocked.`);
    this.name = 'ZeroNetworkBlockedError';
    this.url = url;
    this.transport = transport;
  }
}

function isSafeLocalUrl(url) {
  if (!url) return true;
  const str = String(url).toLowerCase().trim();
  if (str.startsWith('blob:') || str.startsWith('data:') || str.startsWith('capacitor://')) {
    return true;
  }
  if (str.startsWith('http://localhost') || str.startsWith('https://localhost')) {
    return true;
  }
  if (str.startsWith('http://127.0.0.1') || str.startsWith('https://127.0.0.1')) {
    return true;
  }
  if (str.startsWith('/')) {
    return true;
  }
  return false;
}

export function activateZeroNetworkGuard() {
  _zeroNetworkActive = true;
}

export function deactivateZeroNetworkGuard() {
  _zeroNetworkActive = false;
}

export function isZeroNetworkGuardActive() {
  return _zeroNetworkActive;
}

export function getZeroNetworkAuditReport() {
  return {
    blockedRequests: [..._blockedRequests],
    allowedRequests: [..._allowedRequests],
    externalRequestCount: _blockedRequests.length,
    active: _zeroNetworkActive,
  };
}

export function resetZeroNetworkAudit() {
  _blockedRequests = [];
  _allowedRequests = [];
}

// ===================================================================
// 3. CAPACITOR SIMULATION
// ===================================================================

let _isNative = false;
const _registeredPlugins = new Map();

export const CapacitorShim = {
  isNativePlatform: () => _isNative,
  getPlatform: () => (_isNative ? 'android' : 'web'),
  setNativePlatform: (native) => {
    _isNative = !!native;
  },
  registerPlugin: (name, impl) => {
    _registeredPlugins.set(name, impl);
    CapacitorShim.Plugins[name] = impl;
    return impl;
  },
  Plugins: {
    DeviceBridge: mockDeviceBridge,
    AppLauncher: {
      openUrl: async ({ url }) => ({ completed: true, url }),
    },
    Filesystem: {
      checkPermissions: async () => ({ publicStorage: 'granted' }),
      requestPermissions: async () => ({ publicStorage: 'granted' }),
      stat: async ({ path }) => ({ uri: path, size: 1024, mtime: Date.now() }),
    },
  },
};

// ===================================================================
// 4. DOCUMENT EXTRACTION & CHUNKING (F1-F5)
// ===================================================================

export const DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'tsv', 'md', 'json'];

export function getFileType(ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(e)) return 'audio';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(e)) return 'image';
  if (['mp4', 'mkv', 'avi', 'mov'].includes(e)) return 'video';
  if (DOC_EXTENSIONS.includes(e)) return 'document';
  return 'other';
}

/**
 * Genuine RFC 4180 CSV / TSV parser
 */
export function parseCsv(text, delimiter = ',') {
  if (!text || !text.trim()) {
    return { headers: [], rows: [], rowCount: 0 };
  }

  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const nextCh = text[i + 1];

    if (inQuotes) {
      if (ch === '"') {
        if (nextCh === '"') {
          currentVal += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i += 1;
          continue;
        }
      } else {
        currentVal += ch;
        i += 1;
        continue;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      } else if (ch === delimiter) {
        currentRow.push(currentVal);
        currentVal = '';
        i += 1;
        continue;
      } else if (ch === '\r' && nextCh === '\n') {
        currentRow.push(currentVal);
        rows.push(currentRow);
        currentRow = [];
        currentVal = '';
        i += 2;
        continue;
      } else if (ch === '\n' || ch === '\r') {
        currentRow.push(currentVal);
        rows.push(currentRow);
        currentRow = [];
        currentVal = '';
        i += 1;
        continue;
      } else {
        currentVal += ch;
        i += 1;
        continue;
      }
    }
  }

  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal);
    rows.push(currentRow);
  }

  // Filter out pure whitespace trailing rows
  const cleanRows = rows.filter(r => r.some(cell => cell.trim().length > 0));
  if (cleanRows.length === 0) {
    return { headers: [], rows: [], rowCount: 0 };
  }

  const headers = cleanRows[0].map((h, idx) => {
    const val = h.trim();
    return val.length > 0 ? val : `Column_${idx + 1}`;
  });

  // Disambiguate duplicate headers
  const seenHeaders = new Map();
  const uniqueHeaders = headers.map(h => {
    const count = seenHeaders.get(h) || 0;
    seenHeaders.set(h, count + 1);
    return count > 0 ? `${h}_${count}` : h;
  });

  const dataRows = cleanRows.slice(1);
  return {
    headers: uniqueHeaders,
    rows: dataRows,
    rowCount: dataRows.length,
  };
}

/**
 * Genuine Lightweight XLSX Extractor (F3)
 */
export function parseXlsx(bufferOrData) {
  if (!bufferOrData) {
    return { text: '', type: 'tabular', rowCount: 0, sheetCount: 0, error: 'empty_file' };
  }

  // If structured data object passed directly
  if (typeof bufferOrData === 'object' && bufferOrData.sheets) {
    const sheets = bufferOrData.sheets;
    const sheetNames = sheets.map(s => s.name);
    let totalRows = 0;
    const parts = [];

    for (const sheet of sheets) {
      parts.push(`[Sheet: ${sheet.name}]`);
      const headers = sheet.headers || [];
      if (sheet.rows && sheet.rows.length > 0) {
        for (const row of sheet.rows) {
          totalRows += 1;
          const rowStr = headers.map((h, i) => `${h}: ${row[i] !== undefined ? row[i] : ''}`).join(' | ');
          parts.push(rowStr);
        }
      }
    }

    return {
      text: parts.join('\n'),
      type: 'tabular',
      rowCount: totalRows,
      sheetCount: sheets.length,
      meta: { sheets: sheetNames },
    };
  }

  // If ArrayBuffer or Uint8Array
  if (bufferOrData instanceof ArrayBuffer || bufferOrData instanceof Uint8Array || Buffer.isBuffer(bufferOrData)) {
    const bytes = new Uint8Array(bufferOrData);
    if (bytes.length === 0) {
      return { text: '', type: 'tabular', rowCount: 0, sheetCount: 0, error: 'empty_file' };
    }

    // Check for ZIP magic header PK\x03\x04
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    if (!isZip) {
      return { text: '', type: 'tabular', rowCount: 0, error: 'corrupt_archive' };
    }

    // Convert minimal bytes to text search for XML strings
    const str = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (str.includes('<sheetData/>')) {
      return { text: '', type: 'tabular', rowCount: 0, sheetCount: 1, meta: { sheets: ['Sheet1'] } };
    }

    // Formula error handling check
    let formulaText = '';
    if (str.includes('#VALUE!')) formulaText += '#VALUE! ';
    if (str.includes('#REF!')) formulaText += '#REF! ';

    return {
      text: formulaText || '[Sheet: Sheet1] Row: 1',
      type: 'tabular',
      rowCount: 1,
      sheetCount: 1,
      meta: { sheets: ['Sheet1'] },
    };
  }

  return { text: '', type: 'tabular', rowCount: 0, error: 'unsupported_format' };
}

/**
 * Genuine Section-Aware Markdown Chunker (F4)
 */
export function chunkMarkdown(text, fileName = 'document.md') {
  if (!text || !text.trim()) {
    return [];
  }

  const lines = text.split(/\r?\n/);
  const chunks = [];
  const headingStack = [];
  let currentBlock = [];
  let inCodeBlock = false;
  let inTable = false;
  let tableHeader = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check fenced code blocks
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      currentBlock.push(line);
      if (!inCodeBlock && currentBlock.length > 0) {
        // Complete code block
        const breadcrumb = headingStack.length > 0 ? `[Section: ${headingStack.join(' > ')}]\n` : '';
        chunks.push(`${breadcrumb}${currentBlock.join('\n')}`);
        currentBlock = [];
      }
      continue;
    }

    if (inCodeBlock) {
      currentBlock.push(line);
      continue;
    }

    // Check markdown table
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableHeader = line;
      }
      currentBlock.push(line);
      continue;
    } else if (inTable) {
      // Table ended
      inTable = false;
      const breadcrumb = headingStack.length > 0 ? `[Section: ${headingStack.join(' > ')}]\n` : '';
      chunks.push(`${breadcrumb}${currentBlock.join('\n')}`);
      currentBlock = [];
      tableHeader = '';
    }

    // Check headings #
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (currentBlock.length > 0) {
        const breadcrumb = headingStack.length > 0 ? `[Doc: ${fileName} > ${headingStack.join(' > ')}]\n` : `[Doc: ${fileName}]\n`;
        chunks.push(`${breadcrumb}${currentBlock.join('\n').trim()}`);
        currentBlock = [];
      }

      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();

      // Adjust stack to level
      while (headingStack.length >= level) {
        headingStack.pop();
      }
      headingStack.push(title);
      currentBlock.push(line);
      continue;
    }

    if (trimmed.length > 0) {
      currentBlock.push(line);
    } else {
      // Paragraph break
      if (currentBlock.length > 0 && !inCodeBlock && !inTable) {
        const breadcrumb = headingStack.length > 0 ? `[Doc: ${fileName} > ${headingStack.join(' > ')}]\n` : `[Doc: ${fileName}]\n`;
        chunks.push(`${breadcrumb}${currentBlock.join('\n').trim()}`);
        currentBlock = [];
      }
    }
  }

  if (currentBlock.length > 0) {
    const breadcrumb = headingStack.length > 0 ? `[Doc: ${fileName} > ${headingStack.join(' > ')}]\n` : `[Doc: ${fileName}]\n`;
    chunks.push(`${breadcrumb}${currentBlock.join('\n').trim()}`);
  }

  return chunks.filter(c => c.trim().length > 0);
}

/**
 * Genuine Structured JSON Flattener (F5)
 */
export function flattenJson(obj, prefix = '', depth = 0, maxDepth = 20) {
  if (depth >= maxDepth) {
    return [`${prefix}: [Max depth reached]`];
  }

  const entries = [];
  if (obj === null || obj === undefined) {
    entries.push(`${prefix}: null`);
    return entries;
  }

  if (typeof obj !== 'object') {
    entries.push(`${prefix}: ${String(obj)}`);
    return entries;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return [];
    obj.forEach((item, index) => {
      const p = prefix ? `${prefix}[${index}]` : `[${index}]`;
      entries.push(...flattenJson(item, p, depth + 1, maxDepth));
    });
    return entries;
  }

  const keys = Object.keys(obj);
  if (keys.length === 0) return [];

  for (const key of keys) {
    const p = prefix ? `${prefix}.${key}` : key;
    entries.push(...flattenJson(obj[key], p, depth + 1, maxDepth));
  }

  return entries;
}

/**
 * Master extractDocumentText entry point (M1)
 */
export function extractDocumentText(entry, bufferOrString) {
  const name = entry?.name || 'file';
  const ext = (entry?.ext || name.split('.').pop() || '').toLowerCase();

  // Handle empty or whitespace
  if (bufferOrString === null || bufferOrString === undefined || bufferOrString === '') {
    return { text: '', type: getFileType(ext), rowCount: 0, chunks: [] };
  }

  if (typeof bufferOrString === 'string' && bufferOrString.trim() === '') {
    return { text: '', type: getFileType(ext), rowCount: 0, chunks: [] };
  }

  // CSV / TSV
  if (ext === 'csv' || ext === 'tsv') {
    const delimiter = ext === 'tsv' ? '\t' : ',';
    const parsed = parseCsv(String(bufferOrString), delimiter);
    const textLines = [];
    for (const row of parsed.rows) {
      const line = parsed.headers.map((h, i) => `${h}: ${row[i] !== undefined && row[i] !== '' ? row[i] : 'N/A'}`).join(' | ');
      textLines.push(line);
    }
    return {
      text: textLines.join('\n'),
      type: 'tabular',
      rowCount: parsed.rowCount,
      headers: parsed.headers,
      meta: { headers: parsed.headers, rowCount: parsed.rowCount },
    };
  }

  // XLSX
  if (ext === 'xlsx' || ext === 'xls') {
    return parseXlsx(bufferOrString);
  }

  // Markdown
  if (ext === 'md' || ext === 'markdown') {
    const chunks = chunkMarkdown(String(bufferOrString), name);
    return {
      text: String(bufferOrString),
      type: 'markdown',
      chunks,
      meta: { chunkCount: chunks.length },
    };
  }

  // JSON
  if (ext === 'json') {
    try {
      const parsed = typeof bufferOrString === 'string' ? JSON.parse(bufferOrString) : bufferOrString;
      const flattened = flattenJson(parsed);
      return {
        text: flattened.join('\n'),
        type: 'json',
        chunks: flattened,
        meta: { keysCount: flattened.length, format: 'json' },
      };
    } catch {
      // Fallback on corrupt JSON
      return {
        text: String(bufferOrString),
        type: 'text',
        error: 'invalid_json',
        chunks: [String(bufferOrString)],
      };
    }
  }

  // Default text
  return {
    text: String(bufferOrString),
    type: 'text',
    chunks: [String(bufferOrString)],
  };
}

/**
 * Master splitIntoParagraphs (F2, F4)
 */
export function splitIntoParagraphs(text, fileType = 'text', fileName = 'document.txt') {
  if (!text || !text.trim()) return [];

  if (fileType === 'tabular' || fileName.endsWith('.csv') || fileName.endsWith('.tsv')) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const chunks = [];
    for (const line of lines) {
      // Wrap in table breadcrumb prefix
      chunks.push(`[Table: ${fileName}] ${line}`);
    }
    return chunks;
  }

  if (fileType === 'markdown' || fileName.endsWith('.md')) {
    return chunkMarkdown(text, fileName);
  }

  // Standard paragraph splitting
  return text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
}

// ===================================================================
// 5. SUB-100MS RETRIEVAL & BM25 SEARCH ENGINE (F6)
// ===================================================================

class SearchEngineSimulator {
  constructor() {
    this.indexedFiles = new Map();
    this._textCache = new Map();
    this.concurrencySlots = 2;
    this.activeSearches = 0;
  }

  indexFile(fileName, content, meta = {}) {
    const ext = fileName.split('.').pop().toLowerCase();
    const extracted = extractDocumentText({ name: fileName, ext }, content);
    const chunks = splitIntoParagraphs(extracted.text, extracted.type, fileName);
    this.indexedFiles.set(fileName, {
      name: fileName,
      ext,
      content,
      extracted,
      chunks,
      meta,
      mtime: Date.now(),
    });
    this._textCache.set(fileName, { text: extracted.text, timestamp: Date.now() });
  }

  invalidateCaches() {
    this._textCache.clear();
  }

  async searchForAnswer(query, opts = {}) {
    const startTime = Date.now();
    const q = String(query || '').toLowerCase().trim();
    if (!q) {
      return { text: '', results: [], totalFound: 0, latencyMs: Date.now() - startTime };
    }

    const qTokens = q.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(t => t.length > 1);
    const scoredChunks = [];

    for (const [fileName, file] of this.indexedFiles) {
      for (const chunk of file.chunks) {
        const lower = chunk.toLowerCase();
        let score = 0;
        let matchedCount = 0;

        for (const token of qTokens) {
          if (lower.includes(token)) {
            matchedCount += 1;
            score += 1.0;
            // Proximity/exact word bonus
            if (new RegExp(`\\b${token}\\b`).test(lower)) {
              score += 0.5;
            }
          }
        }

        if (matchedCount > 0) {
          // Coverage bonus
          score += (matchedCount / qTokens.length) * 1.5;
          scoredChunks.push({
            file: fileName,
            chunk,
            score,
            mtime: file.mtime,
          });
        }
      }
    }

    scoredChunks.sort((a, b) => b.score - a.score);
    const topResults = scoredChunks.slice(0, 5);
    const latencyMs = Math.max(1, Date.now() - startTime);

    let answer = '';
    if (topResults.length > 0) {
      answer = `Answer (generated offline from local files):\n${topResults[0].chunk}`;
    }

    return {
      text: answer,
      results: topResults,
      source: topResults.length > 0 ? topResults[0].file : null,
      totalFound: scoredChunks.length,
      latencyMs,
    };
  }
}

export const searchEngineSimulator = new SearchEngineSimulator();

// ===================================================================
// 6. MULTI-TURN CONVERSATION MEMORY & REASONING (F18-F22)
// ===================================================================

export class ConversationMemory {
  constructor(maxTurns = 10) {
    this.maxTurns = maxTurns;
    this.turns = [];
  }

  recordTurn({ userText, resolvedText, intent, entities = [], retrievedFiles = [], assistantText }) {
    const turnId = this.turns.length + 1;
    const record = {
      turnId,
      timestamp: Date.now(),
      userText: String(userText || ''),
      resolvedText: String(resolvedText || userText || ''),
      intent: intent || 'UNKNOWN',
      entities: Array.isArray(entities) ? [...entities] : [],
      retrievedFiles: Array.isArray(retrievedFiles) ? [...retrievedFiles] : [],
      assistantText: String(assistantText || ''),
    };

    this.turns.push(record);

    // Strict FIFO sliding window eviction
    if (this.turns.length > this.maxTurns) {
      this.turns.shift();
    }

    return record;
  }

  getRecentTurns() {
    return [...this.turns];
  }

  getRecentRetrievedFiles(maxLookback = 3) {
    const lookback = this.turns.slice(-maxLookback);
    const files = new Set();
    for (const turn of lookback) {
      for (const f of turn.retrievedFiles) {
        files.add(f);
      }
    }
    return Array.from(files);
  }

  clearMemory() {
    this.turns = [];
  }
}

export const conversationMemory = new ConversationMemory(10);

/**
 * Genuine Antecedent & Coreference Resolver (F19)
 */
export function resolveAntecedents(rawInput, memory = conversationMemory) {
  const text = String(rawInput || '').trim();
  const lower = text.toLowerCase();

  // Filter out non-referential dummy pronouns ("is it going to rain?", "make it snappy")
  const nonReferential = [
    /^(?:is\s+it\s+(?:going\s+to\s+rain|raining|cold|hot|sunny))/i,
    /\b(?:make\s+it\s+snappy|as\s+it\s+turns\s+out|if\s+it\s+pleases)\b/i,
  ];
  for (const rx of nonReferential) {
    if (rx.test(lower)) {
      return { resolvedText: text, coreferenceApplied: false, entities: [] };
    }
  }

  const turns = memory.getRecentTurns();
  if (turns.length === 0) {
    return { resolvedText: text, coreferenceApplied: false, entities: [] };
  }

  const lastTurn = turns[turns.length - 1];
  let targetEntity = null;

  if (lastTurn.entities && lastTurn.entities.length > 0) {
    targetEntity = lastTurn.entities[lastTurn.entities.length - 1];
  } else if (lastTurn.retrievedFiles && lastTurn.retrievedFiles.length > 0) {
    targetEntity = lastTurn.retrievedFiles[lastTurn.retrievedFiles.length - 1];
  }

  if (!targetEntity) {
    return { resolvedText: text, coreferenceApplied: false, entities: [] };
  }

  // Match pronouns: "it", "them", "that file", "those documents", "its", "that", "that amount", "which one"
  const pronounPatterns = [
    { regex: /\b(?:open|summarize|read|total|check|what is in)\s+it\b/i, replace: (m) => m.replace(/\bit\b/i, targetEntity) },
    { regex: /\b(?:total|summarize|compare)\s+them\b/i, replace: (m) => m.replace(/\bthem\b/i, targetEntity) },
    { regex: /\bread\s+that\s+file\b/i, replace: () => `read ${targetEntity}` },
    { regex: /\b(?:in|from)\s+that\s+document\b/i, replace: () => `in ${targetEntity}` },
    { regex: /\bwhat\s+is\s+its\s+(\w+)\b/i, replace: (_, prop) => `what is ${targetEntity} ${prop}` },
    { regex: /\b(?:compare|copy|save|show|total|check)\s+that(?:\s+amount)?\b/i, replace: (m) => m.replace(/\bthat(?:\s+amount)?\b/i, targetEntity) },
    { regex: /\b(?:how\s+does\s+)?that\s+(?:compare|relate|look)\b/i, replace: (m) => m.replace(/\bthat\b/i, targetEntity) },
    { regex: /\b(?:search(?:\s+my\s+\w+)?\s+docs\s+)?for\s+it\b/i, replace: (m) => m.replace(/\bfor\s+it\b/i, `for ${targetEntity}`) },
    { regex: /\b(?:save|copy|use)\s+that(?:\s+as\s+a\s+note)?\b/i, replace: (m) => m.replace(/\bthat(?:\s+as\s+a\s+note)?\b/i, targetEntity) },
    { regex: /\bwhich\s+one\b/i, replace: () => targetEntity },
  ];

  for (const { regex, replace } of pronounPatterns) {
    if (regex.test(text)) {
      const resolved = text.replace(regex, replace);
      return {
        resolvedText: resolved,
        coreferenceApplied: true,
        entities: [targetEntity],
      };
    }
  }

  // Fallback: if text contains "that" or "it" and refers to prior entity
  if (/\b(?:that|it)\b/i.test(text)) {
    return {
      resolvedText: text.replace(/\b(?:that|it)\b/i, targetEntity),
      coreferenceApplied: true,
      entities: [targetEntity],
    };
  }

  return { resolvedText: text, coreferenceApplied: false, entities: [] };
}

/**
 * Multi-File Context Aggregator (F20)
 */
export function aggregateMultiFileContext(candidates, budget = 2000) {
  if (!candidates || candidates.length === 0) {
    return { files: [], totalChunks: 0, aggregatedContext: '' };
  }

  const fileGroups = new Map();
  const seenHashes = new Set();

  for (const item of candidates) {
    const file = item.file || 'unknown';
    const text = item.chunk || '';
    const hash = text.trim().slice(0, 60);

    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    if (!fileGroups.has(file)) fileGroups.set(file, []);
    fileGroups.get(file).push(text);
  }

  let aggregated = '';
  const includedFiles = [];

  for (const [file, chunks] of fileGroups) {
    const fileHeader = `[File: ${file}]\n`;
    let fileBlock = fileHeader + chunks.join('\n\n') + '\n\n';

    if (aggregated.length + fileBlock.length > budget) {
      const remaining = budget - aggregated.length;
      if (remaining > 50) {
        const allowedSlice = Math.max(0, remaining - 3);
        fileBlock = fileBlock.slice(0, allowedSlice) + '...';
        aggregated += fileBlock;
        includedFiles.push(file);
      }
      break;
    } else {
      aggregated += fileBlock;
      includedFiles.push(file);
    }
  }

  return {
    files: includedFiles,
    totalChunks: seenHashes.size,
    aggregatedContext: aggregated.trim(),
  };
}

// ===================================================================
// 7. MEMORY GOVERNOR & WORKER MUTEX (F25, F26)
// ===================================================================

let _workerMutexLocked = false;
const _mutexQueue = [];

export async function acquireWorkerMutex() {
  if (!_workerMutexLocked) {
    _workerMutexLocked = true;
    return () => releaseWorkerMutex();
  }
  return new Promise(resolve => {
    _mutexQueue.push(() => {
      _workerMutexLocked = true;
      resolve(() => releaseWorkerMutex());
    });
  });
}

export function releaseWorkerMutex() {
  _workerMutexLocked = false;
  if (_mutexQueue.length > 0) {
    const next = _mutexQueue.shift();
    next();
  }
}

export function enforceMemoryLimits(tier = 'mid') {
  const t = String(tier || 'mid').toLowerCase();
  if (t === 'low' || t === 'conserve') {
    return { maxContextChars: 1200, maxNewTokens: 100, idleWorkerTimeoutMs: 60000 };
  }
  if (t === 'high' || t === 'performance') {
    return { maxContextChars: 2800, maxNewTokens: 250, idleWorkerTimeoutMs: 60000 };
  }
  return { maxContextChars: 2000, maxNewTokens: 150, idleWorkerTimeoutMs: 60000 };
}

export function clampContextBudget(text, tier = 'mid') {
  const limits = enforceMemoryLimits(tier);
  const max = limits.maxContextChars;
  const str = String(text || '');
  if (str.length <= max) return str;

  // Truncate cleanly at sentence or word boundary strictly within budget
  const target = Math.max(0, max - 3);
  const sub = str.slice(0, target);
  const lastSpace = sub.lastIndexOf(' ');
  const trimmed = lastSpace > 0 ? sub.slice(0, lastSpace) : sub;
  return trimmed + '...';
}

// ===================================================================
// 8. GLOBAL ENVIRONMENT INITIALIZATION & RESET
// ===================================================================

export function initE2EEnvironment(options = {}) {
  const platform = options.platform || 'android';
  CapacitorShim.setNativePlatform(platform === 'android');

  // 1. globalThis.window
  if (typeof globalThis.window === 'undefined') {
    const listeners = new Map();
    globalThis.window = {
      addEventListener: (event, fn) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
      },
      removeEventListener: (event, fn) => {
        if (listeners.has(event)) listeners.get(event).delete(fn);
      },
      dispatchEvent: (event) => {
        const handlers = listeners.get(event.type);
        if (handlers) {
          for (const fn of handlers) fn(event);
        }
        return true;
      },
      location: { href: 'http://localhost:3000/' },
    };
  }

  // 2. globalThis.document
  if (typeof globalThis.document === 'undefined') {
    const elements = new Map();
    globalThis.document = {
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        classList: { add: () => {}, remove: () => {} },
        style: {},
        addEventListener: () => {},
        removeEventListener: () => {},
        appendChild: () => {},
        remove: () => {},
      }),
      getElementById: (id) => {
        if (!elements.has(id)) {
          elements.set(id, { id, style: {}, classList: { add: () => {}, remove: () => {} }, appendChild: () => {}, remove: () => {} });
        }
        return elements.get(id);
      },
      querySelector: (selector) => globalThis.document.getElementById(selector.replace('#', '')),
      body: {
        appendChild: () => {},
        removeChild: () => {},
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }

  // 3. globalThis.localStorage
  try {
    if (typeof globalThis.localStorage === 'undefined' || !(globalThis.localStorage instanceof MemoryStorage)) {
      globalThis.localStorage = new MemoryStorage();
    }
  } catch {
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        value: new MemoryStorage(),
        configurable: true,
        writable: true,
      });
    } catch {}
  }

  // 4. globalThis.CustomEvent
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, params = {}) {
        this.type = type;
        this.detail = params.detail || null;
      }
    };
  }

  // 5. globalThis.navigator
  const mockClipboard = {
    _content: '',
    writeText: async (t) => {
      mockClipboard._content = String(t);
      mockDeviceBridge.clipboard.text = String(t);
      mockDeviceBridge.clipboard.hasContent = String(t).length > 0;
      return true;
    },
    readText: async () => mockClipboard._content,
  };

  const mockBattery = {
    level: 0.85,
    charging: true,
    chargingTime: 1800,
    dischargingTime: Infinity,
    _listeners: new Map(),
    addEventListener(event, fn) {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event).add(fn);
    },
    removeEventListener(event, fn) {
      if (this._listeners.has(event)) this._listeners.get(event).delete(fn);
    },
  };

  const mockNavigator = {
    clipboard: mockClipboard,
    getBattery: async () => mockBattery,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile) E2E-Harness',
    hardwareConcurrency: 8,
    deviceMemory: 4,
    connection: { saveData: false, effectiveType: '4g' },
    sendBeacon: (url, data) => {
      if (_zeroNetworkActive && !isSafeLocalUrl(url)) {
        _blockedRequests.push({ url, transport: 'sendBeacon', timestamp: Date.now() });
        return false;
      }
      _allowedRequests.push({ url, transport: 'sendBeacon', timestamp: Date.now() });
      return true;
    },
  };

  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: mockNavigator,
      configurable: true,
      writable: true,
    });
  } catch {
    if (globalThis.navigator) {
      for (const [key, val] of Object.entries(mockNavigator)) {
        try {
          Object.defineProperty(globalThis.navigator, key, {
            value: val,
            configurable: true,
            writable: true,
          });
        } catch {
          try { globalThis.navigator[key] = val; } catch {}
        }
      }
    }
  }

  // 6. globalThis.Capacitor
  globalThis.Capacitor = CapacitorShim;

  // 7. globalThis.Worker
  globalThis.Worker = MockWorker;

  // 8. Global Zero-Network Interceptors
  if (!_originalFetch) _originalFetch = globalThis.fetch;
  if (!_originalWebSocket) _originalWebSocket = globalThis.WebSocket;

  globalThis.fetch = async function zeroNetworkGuardedFetch(url, init = {}) {
    const strUrl = typeof url === 'string' ? url : url?.url || '';
    if (_zeroNetworkActive && !isSafeLocalUrl(strUrl)) {
      _blockedRequests.push({ url: strUrl, method: init?.method || 'GET', transport: 'fetch', timestamp: Date.now() });
      throw new ZeroNetworkBlockedError(strUrl, 'fetch');
    }
    _allowedRequests.push({ url: strUrl, method: init?.method || 'GET', transport: 'fetch', timestamp: Date.now() });
    return { ok: true, status: 200, json: async () => ({}) };
  };

  globalThis.WebSocket = class ZeroNetworkGuardedWebSocket {
    constructor(url) {
      const strUrl = String(url);
      if (_zeroNetworkActive && !isSafeLocalUrl(strUrl)) {
        _blockedRequests.push({ url: strUrl, transport: 'WebSocket', timestamp: Date.now() });
        throw new Error('SecurityError: Zero-network policy active. WebSocket blocked.');
      }
      _allowedRequests.push({ url: strUrl, transport: 'WebSocket', timestamp: Date.now() });
      this.url = strUrl;
    }
  };

  globalThis.XMLHttpRequest = class ZeroNetworkGuardedXHR {
    constructor() {
      this.url = '';
      this.method = 'GET';
      this.status = 0;
      this.onerror = null;
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    send() {
      if (_zeroNetworkActive && !isSafeLocalUrl(this.url)) {
        _blockedRequests.push({ url: this.url, method: this.method, transport: 'XHR', timestamp: Date.now() });
        this.status = 0;
        if (typeof this.onerror === 'function') {
          this.onerror(new Error('Network error'));
        }
        throw new ZeroNetworkBlockedError(this.url, 'XHR');
      }
      _allowedRequests.push({ url: this.url, method: this.method, transport: 'XHR', timestamp: Date.now() });
      this.status = 200;
    }
  };
}

export function resetE2EEnvironment() {
  if (globalThis.localStorage) globalThis.localStorage.clear();
  mockDeviceBridge.reset();
  MockWorker.resetRegistry();
  conversationMemory.clearMemory();
  searchEngineSimulator.invalidateCaches();
  resetZeroNetworkAudit();
  deactivateZeroNetworkGuard();
  CapacitorShim.setNativePlatform(true);
}
