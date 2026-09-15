import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const assistantSource = fs.readFileSync(path.resolve('src/assistant.js'), 'utf8');
const usageLearningSource = fs.readFileSync(path.resolve('src/usage-learning.js'), 'utf8');
const performanceSource = fs.readFileSync(path.resolve('src/performance-governor.js'), 'utf8');
const mainSource = fs.readFileSync(path.resolve('src/main.js'), 'utf8');
const proactiveSource = fs.readFileSync(path.resolve('src/proactive-engine.js'), 'utf8');
const htmlSource = fs.readFileSync(path.resolve('index.html'), 'utf8');

assert(
  usageLearningSource.includes("import { decryptObject, encryptObject, isSecureStorageAvailable } from './secure-store.js';"),
  'usage learning should use secure encrypted storage helpers',
);

assert(
  usageLearningSource.includes('setLearningConsent(enabled'),
  'usage learning should expose user-approved consent control',
);

assert(
  usageLearningSource.includes('encryptObject(profile'),
  'usage learning profile should be encrypted before persistence',
);

assert(
  assistantSource.includes('buildSafeActionPlan('),
  'assistant should route multi-step planning through safe action planner',
);

assert(
  assistantSource.includes("from './local-llm-client.js'") &&
  assistantSource.includes('tryLocalLlmAnswer(') &&
  assistantSource.includes("source: 'offline_local_llm'"),
  'assistant should support local-LLM answer synthesis route for offline knowledge responses',
);

assert(
  htmlSource.includes('id="settingLocalLlm"') &&
  htmlSource.includes('id="statLocalLlmState"'),
  'settings UI should expose a Local LLM toggle and runtime status label',
);

assert(
  mainSource.includes('setupLocalLlmControls()') &&
  mainSource.includes('setLocalLlmEnabledPreference(') &&
  mainSource.includes('getLocalLlmRuntimeState('),
  'main settings flow should wire Local LLM toggle, runtime state, and persistence controls',
);

assert(
  assistantSource.includes('INTENTS.MULTIMODAL_CAPTURE'),
  'assistant should support multimodal capture intent',
);

assert(
  mainSource.includes("openFilePicker(picker, { imageOnly: true, preferCamera: true })"),
  'main input flow should trigger camera/image picker for multimodal requests',
);

assert(
  performanceSource.includes('ENERGY_MODE') &&
  performanceSource.includes('batteryLevel') &&
  performanceSource.includes('saveData'),
  'performance governor should account for battery and data-saver signals',
);

assert(
  proactiveSource.includes('pickAgendaHint') &&
  proactiveSource.includes('pickFileThemeHint'),
  'proactive engine should include local schedule/file-context hints',
);

console.log('next-features-hardening.test: ok');
