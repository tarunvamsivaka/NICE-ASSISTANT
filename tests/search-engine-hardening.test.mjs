import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve('src/search-engine.js'), 'utf8');

assert(
    source.includes("includeFilenameFallback: ['always', 'ifNoContent', 'never'].includes(opts.includeFilenameFallback)"),
    'searchForAnswer should support includeFilenameFallback policy',
);

assert(
    source.includes('const forceFullScan = typeof opts === \'function\' ? true : opts.forceFullScan !== false') &&
    source.includes('forceFullScan,'),
    'searchForAnswer should default to forceFullScan=true',
);

assert(
    source.includes("matchType: 'filename'"),
    'filename fallback matches should be explicitly typed',
);

assert(
    source.includes("matchType: 'content'"),
    'content matches should be explicitly typed',
);

assert(
    source.includes('combineSearchResults({'),
    'final results should combine content and filename matches explicitly',
);

assert(
    source.includes('shouldStopSearchEarly({'),
    'early-stop behavior should be gated by forceFullScan policy helper',
);

assert(
    !source.includes('if (highConfidenceFound && batchStart > BATCH_SIZE * 2) break;'),
    'legacy unconditional early stop should be removed',
);

assert(
    source.includes('async function _readCapacitorPdf(entry)') &&
    source.includes('const uriResult = await Filesystem.getUri({') &&
    source.includes('URI PDF fallback failed'),
    'PDF read path should include URI fallback',
);

assert(
    source.includes('async function _readCapacitorImage(entry, ext)') &&
    source.includes('URI image fallback failed'),
    'image OCR read path should include URI fallback',
);

assert(
    source.includes('normalizeDisplayPath(row.path, row.fileName)'),
    'result formatter should normalize display path',
);

assert(
    source.includes('Answer (generated offline from local files)'),
    'search output should synthesize a direct offline answer section',
);

assert(
    source.includes('export async function warmupSearchKnowledge'),
    'search engine should expose warmup learning routine',
);

assert(
    source.includes('rememberFileLearningProfile(entry, fileVersion, text);'),
    'search pass should keep learning from file contents',
);

assert(
    source.includes('buildIndexSignature(searchable)') &&
    source.includes('buildQueryCacheKey({'),
    'query cache key should include indexed-file signature to avoid stale cache after rescans',
);

assert(
    source.includes('ENTRY_VERSION_CACHE_TTL') &&
    source.includes('getCachedEntryVersion('),
    'entry-version cache should expire with TTL instead of persisting forever',
);

assert(
    source.includes('export function invalidateSearchCaches()'),
    'search engine should expose explicit cache invalidation hook for scan/rescan flows',
);

assert(
    source.includes('const READ_FAILURE_CACHE_TTL = 120000') &&
    source.includes('function shouldSkipReadAttempt(entry)') &&
    source.includes('function noteReadFailure(entry)'),
    'search should include unreadable-file cooldown protection',
);

assert(
    source.includes('async function fetchWithTimeout(') &&
    source.includes('withTimeout('),
    'search should use timeout wrappers for heavy file reads/extraction',
);

assert(
    source.includes('function queueOcrTask(task)') &&
    source.includes('return queueOcrTask(async () => {'),
    'OCR path should be serialized to avoid worker contention under heavy image batches',
);

assert(
    !source.includes('before the safety timeout') &&
    !source.includes('timedOut') &&
    !source.includes('maxDurationMs'),
    'search should not enforce a global query timeout that can stop full-file coverage',
);

assert(
    source.includes('await acquireSearchSlot(normalizedOpts.progressCb);') &&
    source.includes('releaseSearchSlot();'),
    'search should throttle concurrent full-scan sessions',
);

console.log('search-engine-hardening.test: ok');
