import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath) => fs.readFileSync(path.resolve(relativePath), 'utf8');

const actionsSource = read('src/actions.js');
const vectorStoreSource = read('src/vector-store.js');
const filesysSource = read('src/filesys.js');
const assistantSource = read('src/assistant.js');
const mainActivitySource = read('android/app/src/main/java/com/nice/assistant/MainActivity.java');
const manifestSource = read('android/app/src/main/AndroidManifest.xml');

assert(
  actionsSource.includes("registerPlugin('NativeTts')"),
  'actions should use native Android TTS plugin when available',
);

assert(
  mainActivitySource.includes('registerPlugin(NativeTtsPlugin.class);'),
  'MainActivity should register NativeTtsPlugin',
);

assert(
  vectorStoreSource.includes("import { decryptObject, encryptObject } from './secure-store.js';"),
  'vector store should use encrypted secure-store helpers',
);

assert(
  vectorStoreSource.includes('payload: encrypted'),
  'vector store should persist encrypted payloads instead of plaintext vectors',
);

assert(
  filesysSource.includes('normalizeNativeEntry(') && filesysSource.includes('normalizeNativeEntryType('),
  'filesystem scanner should normalize readdir entry shapes across Android variants',
);

assert(
  filesysSource.includes('async function runSingleFlightScan(task)') &&
  filesysSource.includes('return await runSingleFlightScan(async () => {'),
  'filesystem scan/rescan flows should use single-flight guard to prevent concurrent index corruption',
);

assert(
  filesysSource.includes('Never treat localhost/WebView preview URLs as "external open success"'),
  'native file opening should not report success when only WebView localhost URL is available',
);

assert(
  filesysSource.includes('sanitizeRequestedFileName('),
  'file name resolution should sanitize quoted/punctuated user file names before exact lookup',
);

assert(
  filesysSource.includes('if (!explicitDenied && cachedGranted)'),
  'native permission status should keep a stable granted state between startup checks',
);

assert(
  assistantSource.includes('I do not use local file search for live weather.'),
  'weather intent should not fall back to local file search when online weather is blocked',
);

assert(
  assistantSource.includes('OPEN_TARGET_CLARIFY') &&
  assistantSource.includes('I found both an app and a file for'),
  'assistant should disambiguate ambiguous open commands between app and file',
);

assert(
  assistantSource.includes('function looksLikeGeneralKnowledgeQuestion(') &&
  assistantSource.includes('generalKnowledge: true'),
  'assistant should route non-command general knowledge questions to knowledge retrieval',
);

assert(
  manifestSource.includes('READ_MEDIA_VISUAL_USER_SELECTED'),
  'Android manifest should request partial-photo permission for Android 14+ handling',
);

console.log('platform-hardening.test: ok');
