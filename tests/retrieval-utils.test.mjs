import assert from 'node:assert/strict';
import {
    hashChunkText,
    buildEmbeddingCacheKey,
    computeBlendedRerankScore,
    compareSearchResults,
    combineSearchResults,
    shouldStopSearchEarly,
    normalizeDisplayPath,
} from '../src/retrieval-utils.js';

function runBm25VsRerankOrderingTest() {
    const bm25Candidates = [
        { id: 'A', bm25: 12.0, semantic: -0.2 },
        { id: 'B', bm25: 9.0, semantic: 0.95 },
        { id: 'C', bm25: 7.5, semantic: 0.15 },
    ];

    const bm25Order = [...bm25Candidates]
        .sort((a, b) => b.bm25 - a.bm25)
        .map((c) => c.id);
    assert.deepEqual(bm25Order, ['A', 'B', 'C'], 'fixture sanity check: BM25-only order');

    const maxBm25 = Math.max(...bm25Candidates.map((c) => c.bm25));
    const rerankOrder = bm25Candidates
        .map((candidate) => ({
            id: candidate.id,
            score: computeBlendedRerankScore({
                bm25Score: candidate.bm25,
                maxBm25,
                semanticSimilarity: candidate.semantic,
            }),
        }))
        .sort((a, b) => b.score - a.score)
        .map((c) => c.id);

    assert.deepEqual(rerankOrder, ['B', 'A', 'C'], 'BM25+semantic rerank should reorder top results');
}

function runCacheKeyInvalidationTest() {
    const paragraph = 'Invoice total for March is 3847.50 USD';
    const keyBase = buildEmbeddingCacheKey({
        fileId: 'invoice-2026',
        fileVersion: '1700000000000',
        chunkIndex: 3,
        paragraph,
    });

    const keySame = buildEmbeddingCacheKey({
        fileId: 'invoice-2026',
        fileVersion: '1700000000000',
        chunkIndex: 3,
        paragraph,
    });

    const keyVersionChanged = buildEmbeddingCacheKey({
        fileId: 'invoice-2026',
        fileVersion: '1700000001234',
        chunkIndex: 3,
        paragraph,
    });

    const keyContentChanged = buildEmbeddingCacheKey({
        fileId: 'invoice-2026',
        fileVersion: '1700000000000',
        chunkIndex: 3,
        paragraph: `${paragraph} updated`,
    });

    assert.equal(keyBase, keySame, 'same identity and content should produce stable key');
    assert.notEqual(keyBase, keyVersionChanged, 'file mtime/version change must invalidate cache key');
    assert.notEqual(keyBase, keyContentChanged, 'chunk content change must invalidate cache key');
    assert.notEqual(hashChunkText(paragraph), hashChunkText(`${paragraph} updated`), 'hash should track content changes');
}

function runContentFirstOrderingTest() {
    const mixed = [
        { fileName: 'filename-only.pdf', score: 99, matchType: 'filename' },
        { fileName: 'content-hit.txt', score: 2, matchType: 'content' },
    ];

    const ordered = [...mixed].sort(compareSearchResults);
    assert.equal(ordered[0].matchType, 'content', 'content matches must rank before filename-only matches');
}

function runFilenameFallbackPolicyTest() {
    const contentResults = [{ fileName: 'content.txt', score: 4, matchType: 'content' }];
    const filenameResults = [{ fileName: 'name.pdf', score: 10, matchType: 'filename' }];

    const always = combineSearchResults({
        contentResults,
        filenameResults,
        includeFilenameFallback: 'always',
    });
    assert.deepEqual(always.map(r => r.matchType), ['content', 'filename'], 'always mode should keep both');

    const ifNoContent = combineSearchResults({
        contentResults,
        filenameResults,
        includeFilenameFallback: 'ifNoContent',
    });
    assert.deepEqual(ifNoContent.map(r => r.matchType), ['content'], 'ifNoContent should hide filename matches when content exists');

    const never = combineSearchResults({
        contentResults,
        filenameResults,
        includeFilenameFallback: 'never',
    });
    assert.deepEqual(never.map(r => r.matchType), ['content'], 'never mode should remove filename fallback');
}

function runFullScanStopPolicyTest() {
    assert.equal(
        shouldStopSearchEarly({ forceFullScan: true, highConfidenceFound: true, batchStart: 45, batchSize: 15 }),
        false,
        'full scan mode must not stop early',
    );
    assert.equal(
        shouldStopSearchEarly({ forceFullScan: false, highConfidenceFound: true, batchStart: 45, batchSize: 15 }),
        true,
        'non-full-scan mode may stop early after high confidence',
    );
}

function runPathNormalizationTest() {
    const normalized = normalizeDisplayPath(
        'Download/Tarun_Vamsi_Vaka_Resume.pdf.pdf',
        'Tarun_Vamsi_Vaka_Resume.pdf.pdf',
    );
    assert.equal(normalized, 'Download', 'duplicate file-name segment should be trimmed from display path');

    const unchanged = normalizeDisplayPath('Documents/Resumes', 'resume.pdf');
    assert.equal(unchanged, 'Documents/Resumes', 'regular folder paths should be unchanged');
}

runBm25VsRerankOrderingTest();
runCacheKeyInvalidationTest();
runContentFirstOrderingTest();
runFilenameFallbackPolicyTest();
runFullScanStopPolicyTest();
runPathNormalizationTest();
console.log('retrieval-utils.test: ok');
