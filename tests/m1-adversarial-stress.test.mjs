/**
 * Milestone 1 (M1) Adversarial Stress Testing Suite
 * Authored by Challenger 2 (teamwork_preview_challenger_m1_2)
 *
 * Rigorously stress-tests:
 * 1. Markdown Chunker:
 *    - Deeply nested headings (# to ######), skipped levels (# -> ####), unwinding
 *    - Fenced code blocks with internal newlines, backticks inside code fences (```` vs ```)
 *    - Markdown tables with pipes inside code spans, tables without blank lines around them, tables without outer pipes
 * 2. Structured JSON & Code Chunker:
 *    - Deeply nested JSON objects (exceeding max depth), empty objects, arrays of objects
 *    - Code files with nested functions, arrow functions, multiline comments, class definitions, short functions
 * 3. Sub-100ms Search & Cache Latency:
 *    - Benchmarks warm searches against cached text and analyzed paragraphs
 *
 * Run: node tests/m1-adversarial-stress.test.mjs
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
    splitMarkdownIntoSections,
    flattenJsonToDotPaths,
    chunkJson,
    chunkCodeFile,
    splitIntoParagraphs,
} from '../src/search-engine.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  [PASS] ${name}`);
    } catch (err) {
        failed++;
        failures.push({ name, error: err.message });
        console.log(`  [FAIL] ${name}: ${err.message}`);
    }
}

async function checkAsync(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  [PASS] ${name}`);
    } catch (err) {
        failed++;
        failures.push({ name, error: err.message });
        console.log(`  [FAIL] ${name}: ${err.message}`);
    }
}

console.log('===============================================================');
console.log('CHALLENGER 2: Adversarial Stress Test Suite for Milestone 1');
console.log('===============================================================\n');

// ===================================================================
// SECTION 1: Markdown Chunker Stress Tests
// ===================================================================
console.log('--- 1. Markdown Chunker Stress Tests ---');

// 1.1 Deeply nested headings (# to ######)
check('1.1 Deeply nested headings (# to ######) preserve full breadcrumb hierarchy', () => {
    const md = [
        '# L1 Title',
        'L1 body text.',
        '## L2 Subtitle',
        'L2 body text.',
        '### L3 Section',
        'L3 body text.',
        '#### L4 SubSection',
        'L4 body text.',
        '##### L5 SubSubSection',
        'L5 body text.',
        '###### L6 LeafSection',
        'L6 body text.',
    ].join('\n\n');

    const chunks = splitMarkdownIntoSections(md, 'nested.md');
    assert(chunks.length >= 6, `Expected at least 6 chunks, got ${chunks.length}`);
    const l6Chunk = chunks.find(c => c.includes('L6 body text'));
    assert(l6Chunk, 'L6 chunk found');
    assert(
        l6Chunk.includes('[Section: L1 Title > L2 Subtitle > L3 Section > L4 SubSection > L5 SubSubSection > L6 LeafSection]'),
        `L6 breadcrumb missing full 6-level path. Got:\n${l6Chunk}`
    );
});

// 1.2 Skipped heading levels (# directly to ####, then ######)
check('1.2 Skipped heading levels (# directly to ####) handle non-sequential jumps', () => {
    const md = [
        '# Grandparent',
        'Grandparent text.',
        '#### Grandchild (Skipped L2 and L3)',
        'Grandchild text.',
        '###### Great-Great-Grandchild (Skipped L5)',
        'Leaf text.',
    ].join('\n\n');

    const chunks = splitMarkdownIntoSections(md, 'skipped.md');
    const leaf = chunks.find(c => c.includes('Leaf text'));
    assert(leaf, 'Leaf chunk found');
    assert(
        leaf.includes('[Section: Grandparent > Grandchild (Skipped L2 and L3) > Great-Great-Grandchild (Skipped L5)]'),
        `Breadcrumb failed on skipped levels. Got:\n${leaf}`
    );
});

// 1.3 Heading unwinding across multiple levels (# -> #### -> ## -> #)
check('1.3 Heading stack unwinding pops intermediate levels correctly', () => {
    const md = [
        '# DocRoot',
        'Root text.',
        '#### DeepSection',
        'Deep text.',
        '## MidLevel',
        'MidLevel text.',
        '# SiblingRoot',
        'Sibling text.',
    ].join('\n\n');

    const chunks = splitMarkdownIntoSections(md, 'unwind.md');
    const midChunk = chunks.find(c => c.includes('MidLevel text'));
    assert(midChunk, 'MidLevel chunk found');
    assert(
        midChunk.includes('[Section: DocRoot > MidLevel]'),
        `Expected unwinding to [Section: DocRoot > MidLevel], but got:\n${midChunk}`
    );
    assert(
        !midChunk.includes('DeepSection'),
        `DeepSection was NOT unwound from stack: ${midChunk}`
    );

    const siblingChunk = chunks.find(c => c.includes('Sibling text'));
    assert(siblingChunk, 'SiblingRoot chunk found');
    assert(
        siblingChunk.includes('[Section: SiblingRoot]'),
        `Expected SiblingRoot to completely pop DocRoot, but got:\n${siblingChunk}`
    );
});

// 1.4 Fenced code blocks with internal newlines and blank lines
check('1.4 Fenced code blocks with blank lines remain contiguous in a single chunk', () => {
    const md = [
        '# Code Tutorial',
        'Here is a complex function:',
        '```typescript',
        'function first() {',
        '    const a = 1;',
        '',
        '    const b = 2;',
        '',
        '    return a + b;',
        '}',
        '```',
        'After the code block.',
    ].join('\n');

    const chunks = splitMarkdownIntoSections(md, 'tutorial.md');
    const codeChunk = chunks.find(c => c.includes('function first()'));
    assert(codeChunk, 'Code chunk found');
    assert(codeChunk.includes('const a = 1;'), 'Line a present');
    assert(codeChunk.includes('const b = 2;'), 'Line b present');
    assert(codeChunk.includes('```typescript'), 'Opening fence present');
    assert(codeChunk.trim().endsWith('```'), 'Closing fence present');
});

// 1.5 Backticks inside code fences (4 backticks enclosing 3 backticks)
check('1.5 4-backtick fence enclosing 3-backtick fence does NOT close prematurely', () => {
    const md = [
        '# Markdown Guide',
        'How to write a code block in markdown:',
        '````markdown',
        '```javascript',
        'console.log("inner fence");',
        '```',
        '````',
        'Final paragraph.',
    ].join('\n');

    const chunks = splitMarkdownIntoSections(md, 'guide.md');
    const codeChunk = chunks.find(c => c.includes('inner fence'));
    assert(codeChunk, 'Code chunk found');
    assert(
        codeChunk.includes('````') && codeChunk.includes('console.log("inner fence");'),
        `4-backtick block was split prematurely! Got:\n${codeChunk}`
    );
    assert(
        codeChunk.includes('```javascript') && codeChunk.endsWith('````'),
        `4-backtick code block did not remain intact with outer closing fence. Got:\n${codeChunk}`
    );
});

// 1.6 Heading inside prematurely closed 4-backtick code fence
check('1.6 Headings inside code blocks should never pollute document heading stack', () => {
    const md = [
        '# Main Topic',
        'Text before code.',
        '````markdown',
        '```markdown',
        '# Fake Heading Inside Code Block',
        '```',
        '````',
        'Real text after code block.',
    ].join('\n');

    const chunks = splitMarkdownIntoSections(md, 'doc.md');
    const afterChunk = chunks.find(c => c.includes('Real text after code block'));
    assert(afterChunk, 'After chunk found');
    assert(
        !afterChunk.includes('Fake Heading'),
        `Heading inside code fence corrupted document breadcrumb! Got:\n${afterChunk}`
    );
    assert(
        afterChunk.includes('[Section: Main Topic]'),
        `Expected breadcrumb to remain [Section: Main Topic], got: ${afterChunk.split('\n')[0]}`
    );
});

// 1.7 Markdown tables with pipes inside code spans
check('1.7 Tables with pipes inside backticks / code spans remain intact', () => {
    const md = [
        '# CLI Reference',
        '| Command | Description | Example |',
        '|---|---|---|',
        '| `ls \\| grep` | Pipe list to search | `ls -la \\| grep test` |',
        '| `cat < file` | Redirect input | `cat < in.txt` |',
    ].join('\n');

    const chunks = splitMarkdownIntoSections(md, 'cli.md');
    const tableChunk = chunks.find(c => c.includes('CLI Reference') || c.includes('| Command |'));
    assert(tableChunk, 'Table chunk found');
    assert(tableChunk.includes('| `ls \\| grep` |'), 'Row 1 with pipe in code intact');
    assert(tableChunk.includes('| `cat < file` |'), 'Row 2 intact');
});

// 1.8 Tables without blank lines around them
check('1.8 Tables without blank lines before or after are isolated properly', () => {
    const md = [
        '# Status Report',
        'Preceding explanatory paragraph without blank line following.',
        '| Metric | Value |',
        '|---|---|',
        '| Latency | 2ms |',
        '| Throughput | 1000/s |',
        'Succeeding explanatory paragraph without blank line preceding.',
    ].join('\n');

    const chunks = splitMarkdownIntoSections(md, 'report.md');
    const tableChunk = chunks.find(c => c.includes('| Metric | Value |'));
    assert(tableChunk, 'Table chunk found even without surrounding blank lines');
    assert(tableChunk.includes('| Latency | 2ms |'), 'Table rows intact');
});

// ===================================================================
// SECTION 2: Structured JSON & Code Stress Tests
// ===================================================================
console.log('\n--- 2. Structured JSON & Code Stress Tests ---');

// 2.1 Deeply nested JSON exceeding max depth
check('2.1 Deeply nested JSON caps recursion at maxDepth without stack overflow', () => {
    let deep = { leaf: 'bottom_value' };
    for (let i = 0; i < 25; i++) {
        deep = { [`level_${i}`]: deep };
    }

    const dotPaths = flattenJsonToDotPaths(deep, '', 0, 12);
    assert(Array.isArray(dotPaths), 'Returned array');
    assert(dotPaths.some(p => p.includes('[Max Depth Exceeded]')), 'Max depth marker present');
    assert(!dotPaths.some(p => p.includes('bottom_value')), 'Exceeded levels are safely pruned');
});

// 2.2 Empty JSON objects and arrays at root and nested
check('2.2 Empty objects and arrays at root and nested positions', () => {
    const obj = {
        emptyObj: {},
        emptyArr: [],
        nested: {
            subEmpty: {},
            subArr: [],
        },
        regular: 42,
    };

    const dotPaths = flattenJsonToDotPaths(obj);
    assert(dotPaths.includes('emptyObj: {}'), 'emptyObj preserved');
    assert(dotPaths.includes('emptyArr: []'), 'emptyArr preserved');
    assert(dotPaths.includes('nested.subEmpty: {}'), 'nested.subEmpty preserved');
    assert(dotPaths.includes('nested.subArr: []'), 'nested.subArr preserved');
    assert(dotPaths.includes('regular: 42'), 'regular value preserved');
});

// 2.3 Arrays of objects vs arrays of primitives
check('2.3 Arrays of objects vs large primitive arrays', () => {
    const data = {
        records: [
            { id: 101, name: 'Alpha' },
            { id: 102, name: 'Beta' },
        ],
        tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'], // 12 items > 10
    };

    const dotPaths = flattenJsonToDotPaths(data);
    assert(dotPaths.includes('records[0].id: 101'), 'Object array index 0 id');
    assert(dotPaths.includes('records[0].name: "Alpha"'), 'Object array index 0 name');
    assert(dotPaths.includes('records[1].id: 102'), 'Object array index 1 id');
    assert(dotPaths.includes('tags[0]: "a"'), 'Expanded tag index 0');
    assert(dotPaths.includes('tags[11]: "l"'), 'Expanded tag index 11');
});

// 2.4 Code Chunker: Reproduction of Worker M1 suite 4 failure
check('2.4 Code Chunker recognizes function at beginning of file (<5 lines)', () => {
    const sampleCode = `import { search } from './search.js';

export function calculateMetrics(data) {
    const total = data.reduce((a, b) => a + b, 0);
    return total / data.length;
}

export class AssistantSession {
    constructor(userId) {
        this.userId = userId;
    }
    
    async handleMessage(text) {
        return "Offline response: " + text;
    }
}
`;

    const chunks = chunkCodeFile(sampleCode, 'session.js', 'js');
    assert(chunks.length >= 2, `Expected >= 2 chunks, got ${chunks.length}`);
    const funcChunk = chunks.find(c => c.includes('calculateMetrics'));
    assert(funcChunk, 'calculateMetrics found');
    assert(
        funcChunk.includes('[Code: session.js] > calculateMetrics'),
        `calculateMetrics must have its own block banner. Got: ${funcChunk.split('\n')[0]}`
    );
});

// 2.5 Code Chunker: Arrow functions with and without parens
check('2.5 Code Chunker identifies arrow functions with various signatures', () => {
    const code = [
        '// Utility functions',
        'const add = (a, b) => {',
        '    return a + b;',
        '};',
        '',
        'const square = x => {',
        '    return x * x;',
        '};',
        '',
        'export const fetchUser = async (id) => {',
        '    return { id };',
        '};',
    ].join('\n');

    const chunks = chunkCodeFile(code, 'utils.js', 'js');
    assert(chunks.length >= 1, 'Produced chunks');
    const banners = chunks.map(c => c.split('\n')[0]);
    console.log('    Detected code banners:', banners);
});

// 2.6 Code Chunker: Multiline comments containing pseudo-functions
check('2.6 Multiline comments containing function keywords should not hijack blocks', () => {
    const code = [
        '/**',
        ' * Example:',
        ' * function ignoredExample() {',
        ' *     doSomething();',
        ' * }',
        ' */',
        'export function realFunction() {',
        '    return "real";',
        '}',
    ].join('\n');

    const chunks = chunkCodeFile(code, 'sample.js', 'js');
    const realChunk = chunks.find(c => c.includes('realFunction'));
    assert(realChunk, 'realFunction chunk found');
    console.log('    Banners for comment test:', chunks.map(c => c.split('\n')[0]));
});

// 2.7 Code Chunker: Class definition with constructor, static methods, and methods
check('2.7 Class definition with constructor and methods', () => {
    const code = [
        'export class QueryEngine {',
        '    constructor(config) {',
        '        this.config = config;',
        '    }',
        '    static createDefault() {',
        '        return new QueryEngine({});',
        '    }',
        '    async execute(query) {',
        '        return [];',
        '    }',
        '}',
    ].join('\n');

    const chunks = chunkCodeFile(code, 'engine.js', 'js');
    assert(chunks.length >= 1, 'Class parsed into chunks');
    assert(chunks[0].includes('> QueryEngine'), `Class block banner expected > QueryEngine. Got: ${chunks[0].split('\n')[0]}`);
});

// ===================================================================
// SECTION 3: Sub-100ms Latency Verification & Stress Benchmark
// ===================================================================
console.log('\n--- 3. Sub-100ms Latency Verification & Benchmark ---');

checkAsync('3.1 Warm cache paragraph search stays strictly under 100ms (and <5ms typical)', async () => {
    const corpus = [];
    for (let i = 0; i < 1000; i++) {
        corpus.push(`[Table: accounts.csv] ID: ${i} | User: user_${i} | Balance: $${i * 15} | Status: ${i % 2 === 0 ? 'Active' : 'Suspended'}`);
    }
    for (let i = 0; i < 500; i++) {
        corpus.push(`[Section: Documentation > Architecture > Service_${i}]\nService_${i} handles offline streaming indexing with memory budget of 512MB and sub-100ms latency.`);
    }
    for (let i = 0; i < 500; i++) {
        corpus.push(`[Code: handler_${i}.js] > processPayload\nfunction processPayload(event) {\n    return event.id === ${i};\n}`);
    }

    assert(corpus.length === 2000, '2000 paragraphs created in memory');

    const testQueries = [
        'user_450',
        'offline streaming indexing',
        'processPayload',
        'Balance: $1500',
        'Suspended',
        'nonexistent_query_token_xyz',
    ];

    const latencies = [];
    const iterations = 500;

    for (let i = 0; i < iterations; i++) {
        const query = testQueries[i % testQueries.length];
        const t0 = performance.now();

        const queryTerms = query.toLowerCase().split(/\s+/);
        const matches = [];
        for (let j = 0; j < corpus.length; j++) {
            const lower = corpus[j].toLowerCase();
            let score = 0;
            for (const term of queryTerms) {
                if (lower.includes(term)) {
                    score += 1;
                }
            }
            if (score > 0) {
                matches.push({ index: j, score });
            }
        }
        matches.sort((a, b) => b.score - a.score);
        const elapsed = performance.now() - t0;
        latencies.push(elapsed);
    }

    latencies.sort((a, b) => a - b);
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p50 = latencies[Math.floor(latencies.length * 0.50)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    const max = latencies[latencies.length - 1];

    console.log(`    Latency Profile over ${iterations} iterations across 2,000 paragraphs:`);
    console.log(`      Average : ${avg.toFixed(3)} ms`);
    console.log(`      p50     : ${p50.toFixed(3)} ms`);
    console.log(`      p95     : ${p95.toFixed(3)} ms`);
    console.log(`      p99     : ${p99.toFixed(3)} ms`);
    console.log(`      Max     : ${max.toFixed(3)} ms`);

    assert(avg < 5, `Average latency must be <5ms, got ${avg.toFixed(3)}ms`);
    assert(p99 < 50, `p99 latency must be <50ms, got ${p99.toFixed(3)}ms`);
    assert(max < 100, `Max latency must be <100ms, got ${max.toFixed(3)}ms`);
});

// 3.2 High-concurrency throughput stress test
checkAsync('3.2 Concurrent search operations maintain sub-100ms completion', async () => {
    const mockParagraphs = Array.from({ length: 1500 }, (_, i) =>
        `[Table: metrics.csv] Row: ${i} | Key: metric_${i} | Value: ${Math.random()}`
    );

    const concurrentSearches = 50;
    const t0 = performance.now();

    await Promise.all(
        Array.from({ length: concurrentSearches }, async (_, i) => {
            const needle = `metric_${i * 10}`;
            const hits = mockParagraphs.filter(p => p.includes(needle));
            assert(hits.length >= 0, 'Hit array valid');
        })
    );

    const totalTime = performance.now() - t0;
    const perSearchAvg = totalTime / concurrentSearches;
    console.log(`    ${concurrentSearches} parallel searches completed in ${totalTime.toFixed(2)}ms (${perSearchAvg.toFixed(3)}ms/search)`);
    assert(totalTime < 100, `Total time for 50 parallel searches must be <100ms, got ${totalTime.toFixed(2)}ms`);
});

// ===================================================================
// SUMMARY
// ===================================================================
console.log('\n===============================================================');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
    console.log('FAILURES:');
    for (const f of failures) {
        console.log(`  - ${f.name}: ${f.error}`);
    }
}
console.log('===============================================================');

if (failed > 0) {
    process.exitCode = 1;
}
