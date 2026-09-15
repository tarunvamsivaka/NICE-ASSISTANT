/**
 * Shared retrieval helpers for deterministic ranking and cache keys.
 * Kept pure so unit tests can run in Node without browser APIs.
 */

export function hashChunkText(text) {
    const source = typeof text === 'string' ? text : '';
    let hash = 5381;
    for (let i = 0; i < source.length; i++) {
        hash = ((hash << 5) + hash) + source.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

export function buildEmbeddingCacheKey({
    fileId = '',
    fileVersion = '0',
    chunkIndex = 0,
    chunkHash = '',
    paragraph = '',
}) {
    const safeChunkIndex = Number.isFinite(chunkIndex) ? chunkIndex : 0;
    const safeHash = chunkHash || hashChunkText(paragraph);
    return `${fileId}|${fileVersion}|${safeChunkIndex}|${safeHash}`;
}

export function computeBlendedRerankScore({
    bm25Score = 0,
    maxBm25 = 1,
    semanticSimilarity = 0,
    bm25Weight = 0.6,
    semanticWeight = 0.4,
}) {
    const safeMax = Math.max(1e-9, Number(maxBm25) || 1);
    const bm25Norm = Math.max(0, Math.min(1, (Number(bm25Score) || 0) / safeMax));
    const semanticNorm = Math.max(0, Math.min(1, ((Number(semanticSimilarity) || 0) + 1) / 2));
    return (bm25Norm * bm25Weight) + (semanticNorm * semanticWeight);
}

export function compareSearchResults(a, b) {
    const aTypePriority = a?.matchType === 'filename' ? 1 : 0;
    const bTypePriority = b?.matchType === 'filename' ? 1 : 0;
    if (aTypePriority !== bTypePriority) return aTypePriority - bTypePriority;

    const aRank = Number.isFinite(a?.rerankScore) ? a.rerankScore : null;
    const bRank = Number.isFinite(b?.rerankScore) ? b.rerankScore : null;
    if (aRank !== null || bRank !== null) {
        if (aRank === null) return 1;
        if (bRank === null) return -1;
        if (aRank !== bRank) return bRank - aRank;
    }

    const aScore = Number(a?.score) || 0;
    const bScore = Number(b?.score) || 0;
    if (aScore !== bScore) return bScore - aScore;

    return String(a?.fileName || '').localeCompare(String(b?.fileName || ''));
}

export function combineSearchResults({
    contentResults = [],
    filenameResults = [],
    includeFilenameFallback = 'always',
}) {
    const normalizedMode = ['always', 'ifNoContent', 'never'].includes(includeFilenameFallback)
        ? includeFilenameFallback
        : 'always';

    const sortedContent = [...contentResults].sort(compareSearchResults);
    const sortedFilename = [...filenameResults].sort(compareSearchResults);

    if (normalizedMode === 'never') return sortedContent;
    if (normalizedMode === 'ifNoContent') {
        return sortedContent.length > 0 ? sortedContent : sortedFilename;
    }
    return [...sortedContent, ...sortedFilename];
}

export function shouldStopSearchEarly({
    forceFullScan = true,
    highConfidenceFound = false,
    batchStart = 0,
    batchSize = 1,
}) {
    if (forceFullScan) return false;
    return !!highConfidenceFound && batchStart > batchSize * 2;
}

export function normalizeDisplayPath(rawPath, fileName = '') {
    if (!rawPath) return '';

    const normalized = String(rawPath)
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\/+|\/+$/g, '');

    if (!normalized) return '';

    const parts = normalized.split('/');
    const targetName = String(fileName || '').toLowerCase();
    if (targetName) {
        while (parts.length > 0) {
            const tail = (parts[parts.length - 1] || '').toLowerCase();
            if (tail !== targetName) break;
            parts.pop();
        }
    }

    return parts.join('/');
}
