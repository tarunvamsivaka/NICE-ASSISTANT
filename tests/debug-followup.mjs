// Quick debug: check follow-up command behavior
const INTENTS = {
    LAUNCH_APP: 'LAUNCH_APP', SET_ALARM: 'SET_ALARM', CALENDAR: 'CALENDAR',
    MEDIA: 'MEDIA', NOTE: 'NOTE', CALCULATE: 'CALCULATE', CONVERT: 'CONVERT',
    FILE_SEARCH: 'FILE_SEARCH', GREETING: 'GREETING', HELP: 'HELP', UNKNOWN: 'UNKNOWN',
};

let lastContext = { intent: null, entity: null, timestamp: 0 };

function parseCommand(input) {
    const text = input.trim().toLowerCase();

    // File Search
    const fileMatch = text.match(/(?:find|search|look\s+for|locate|where\s+is|open\s+file)\s+(.+)/i);
    if (fileMatch) {
        const file = fileMatch[1].trim();
        lastContext = { intent: INTENTS.FILE_SEARCH, entity: file, timestamp: Date.now() };
        return { intent: INTENTS.FILE_SEARCH, file, raw: input };
    }

    // Follow-up
    if (/^(open\s+it|do\s+it|yes|go\s+ahead|confirm)$/i.test(text) && lastContext.entity) {
        if (lastContext.intent === INTENTS.FILE_SEARCH) {
            return { intent: 'OPEN_FILE', file: lastContext.entity, raw: input, followUp: true };
        }
        return { intent: lastContext.intent, entity: lastContext.entity, raw: input, followUp: true };
    }

    return { intent: INTENTS.UNKNOWN, raw: input };
}

// Test
const r1 = parseCommand('Find Invoice_March.pdf');
console.log('Step 1 (find file):', JSON.stringify(r1));
console.log('lastContext after:', JSON.stringify(lastContext));

const r2 = parseCommand('open it');
console.log('Step 2 (open it):', JSON.stringify(r2));
console.log('followUp value:', r2.followUp);
