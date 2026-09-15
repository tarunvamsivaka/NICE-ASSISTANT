import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const policySource = fs.readFileSync(path.resolve('src/policy.js'), 'utf8');
const mainSource = fs.readFileSync(path.resolve('src/main.js'), 'utf8');
const searchSource = fs.readFileSync(path.resolve('src/search-engine.js'), 'utf8');

assert(
  policySource.includes('offlineDefault: true'),
  'policy should remain offline-default',
);

assert(
  policySource.includes('const OFFLINE_HARD_LOCK = false;'),
  'policy should support session online opt-in for fully-loaded mode',
);

assert(
  /import\s*\{[^}]*extractAttachedFileText[^}]*\}\s*from '\.\/search-engine\.js';/.test(mainSource),
  'main should use unified attachment extraction path',
);

assert(
  mainSource.includes('attachedFileContent = await extractAttachedFileText(attachedFile);'),
  'attached file analysis should use robust extractor for pdf/docx/image/text',
);

assert(
  !mainSource.includes('function setupFileAttachment()'),
  'legacy duplicate attachment setup path should remain removed',
);

assert(
  searchSource.includes('export async function extractAttachedFileText(file)'),
  'search engine should expose reusable attachment extraction utility',
);

console.log('stability-forecast.test: ok');


