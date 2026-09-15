import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const assistantSource = fs.readFileSync(path.resolve('src/assistant.js'), 'utf8');
const filesysSource = fs.readFileSync(path.resolve('src/filesys.js'), 'utf8');

const internetSearchIndex = assistantSource.indexOf('const internetSearchMatch = text.match');
const broadFileSearchIndex = assistantSource.indexOf('const fileMatch = text.match(/(?:find|search|look\\s+for|locate|where\\s+is)\\s+(?:file\\s+)?(.+)/i);');

assert(
    internetSearchIndex !== -1 && broadFileSearchIndex !== -1 && internetSearchIndex < broadFileSearchIndex,
    'explicit internet search parsing must run before broad file-search regex',
);

assert(
    assistantSource.includes('intent: INTENTS.BRAIN_PLAN'),
    'assistant should expose BRAIN_PLAN intent for offline multi-step execution',
);

assert(
    assistantSource.includes('case INTENTS.BRAIN_PLAN:'),
    'generateResponse should execute offline multi-step plans',
);

assert(
    assistantSource.includes("return { intent: INTENTS.OPEN_FILE, file: lastContext.entity, raw: rawInput, followUp: true };"),
    'file-search follow-up should map to OPEN_FILE instead of LAUNCH_APP',
);

assert(
    !assistantSource.includes('intent: INTENTS.LAUNCH_APP, app: lastContext.entity'),
    'legacy follow-up mapping to LAUNCH_APP should be removed',
);

assert(
    assistantSource.includes('applyUsageIntentHint('),
    'assistant should apply local usage-learning hints during response generation',
);

assert(
    filesysSource.includes('const title = document.createElement(\'span\');')
    && filesysSource.includes('title.textContent = `📄 ${name}`;'),
    'file preview modal should render filename via textContent',
);

assert(
    !filesysSource.includes('modal.innerHTML = `'),
    'file preview modal should avoid unsanitized HTML templates',
);

console.log('offline-brain-hardening.test: ok');

