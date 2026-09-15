/**
 * Nice — Comprehensive Test Suite (Updated)
 * Tests all core logic: command parser, math evaluator (including word math),
 * unit converter, file search, and new features
 * Run: node tests/test-all.mjs
 */

// --- Inline the logic we need to test (since modules use browser DOM) ---

// ===== INTENTS =====
const INTENTS = {
    LAUNCH_APP: 'LAUNCH_APP',
    SET_ALARM: 'SET_ALARM',
    CALENDAR: 'CALENDAR',
    MEDIA: 'MEDIA',
    NOTE: 'NOTE',
    CALCULATE: 'CALCULATE',
    CONVERT: 'CONVERT',
    FILE_SEARCH: 'FILE_SEARCH',
    WEATHER: 'WEATHER',
    GREETING: 'GREETING',
    HELP: 'HELP',
    UNKNOWN: 'UNKNOWN',
};

let lastContext = { intent: null, entity: null, timestamp: 0 };

// ===== WORD-TO-NUMBER MATH ENGINE =====
const WORD_NUMS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90,
};
const WORD_MULTIPLIERS = { hundred: 100, thousand: 1000, million: 1000000, billion: 1000000000 };
const WORD_OPERATORS = {
    plus: '+', add: '+', added: '+', 'added to': '+', and: '+',
    minus: '-', subtract: '-', subtracted: '-', 'take away': '-',
    times: '*', multiply: '*', 'multiplied by': '*', into: '*',
    'divided by': '/', divide: '/', over: '/',
    'to the power of': '**', 'power': '**', 'raised to': '**',
    mod: '%', modulo: '%', remainder: '%',
};

function parseWordMath(text) {
    let expr = text.toLowerCase().trim();
    expr = expr.replace(/^(?:what\s+is|calculate|compute|solve|how\s+much\s+is|eval)\s+/i, '');
    expr = expr.replace(/\?$/, '').trim();

    expr = expr.replace(/square\s+root\s+of\s+(\S+)/gi, (_, n) => {
        const num = WORD_NUMS[n] !== undefined ? WORD_NUMS[n] : n;
        return `Math.sqrt(${num})`;
    });
    expr = expr.replace(/(\S+)\s+squared/gi, (_, n) => {
        const num = WORD_NUMS[n] !== undefined ? WORD_NUMS[n] : n;
        return `(${num})**2`;
    });
    expr = expr.replace(/(\S+)\s+cubed/gi, (_, n) => {
        const num = WORD_NUMS[n] !== undefined ? WORD_NUMS[n] : n;
        return `(${num})**3`;
    });

    for (const [phrase, op] of Object.entries(WORD_OPERATORS)) {
        if (phrase.includes(' ')) {
            const regex = new RegExp(phrase.replace(/\s+/g, '\\s+'), 'gi');
            expr = expr.replace(regex, ` ${op} `);
        }
    }

    const tokens = expr.split(/\s+/);
    const result = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (WORD_OPERATORS[t] && !t.includes(' ')) {
            result.push(WORD_OPERATORS[t]);
        } else if (WORD_NUMS[t] !== undefined) {
            let num = WORD_NUMS[t];
            if (num >= 20 && num <= 90 && i + 1 < tokens.length && WORD_NUMS[tokens[i + 1]] !== undefined && WORD_NUMS[tokens[i + 1]] < 10) {
                num += WORD_NUMS[tokens[i + 1]];
                i++;
            }
            if (i + 1 < tokens.length && WORD_MULTIPLIERS[tokens[i + 1]]) {
                num *= WORD_MULTIPLIERS[tokens[i + 1]];
                i++;
                if (i + 1 < tokens.length && WORD_NUMS[tokens[i + 1]] !== undefined) {
                    let addNum = WORD_NUMS[tokens[i + 1]];
                    i++;
                    if (addNum >= 20 && addNum <= 90 && i + 1 < tokens.length && WORD_NUMS[tokens[i + 1]] !== undefined && WORD_NUMS[tokens[i + 1]] < 10) {
                        addNum += WORD_NUMS[tokens[i + 1]];
                        i++;
                    }
                    num += addNum;
                }
            }
            result.push(num.toString());
        } else if (/^[\d.]+$/.test(t) || /^[+\-*/%()]+$/.test(t)) {
            result.push(t);
        } else if (t === 'x' || t === '×') {
            result.push('*');
        } else {
            result.push(t);
        }
    }
    return result.join(' ');
}

function isWordMath(text) {
    const lower = text.toLowerCase();
    const hasNumbers = Object.keys(WORD_NUMS).some(w => {
        const regex = new RegExp(`\\b${w}\\b`);
        return regex.test(lower);
    });
    const hasOps = Object.keys(WORD_OPERATORS).some(w => {
        const regex = new RegExp(`\\b${w.replace(/\s+/g, '\\s+')}\\b`);
        return regex.test(lower);
    });
    return hasNumbers && hasOps;
}

// ===== PARSE COMMAND =====
function parseCommand(input) {
    const text = input.trim().toLowerCase();

    if (/^(hi|hello|hey|good\s*(morning|afternoon|evening)|what'?s?\s*up|howdy)/i.test(text)) {
        return { intent: INTENTS.GREETING, raw: input };
    }
    if (/^(help|what can you do|commands|capabilities)/i.test(text)) {
        return { intent: INTENTS.HELP, raw: input };
    }

    if (/^(open\s+it|do\s+it|yes|go\s+ahead|confirm)$/i.test(text) && lastContext.entity) {
        if (lastContext.intent === INTENTS.FILE_SEARCH) {
            return { intent: INTENTS.LAUNCH_APP, app: lastContext.entity, raw: input, followUp: true };
        }
        return { intent: lastContext.intent, entity: lastContext.entity, raw: input, followUp: true };
    }

    const launchMatch = text.match(/(?:open|launch|start|run)\s+(.+)/i);
    if (launchMatch && !/^(?:play|queue)\s/i.test(text)) {
        const app = launchMatch[1].replace(/\b\w/g, c => c.toUpperCase());
        lastContext = { intent: INTENTS.LAUNCH_APP, entity: app, timestamp: Date.now() };
        return { intent: INTENTS.LAUNCH_APP, app, raw: input };
    }

    const alarmMatch = text.match(/(?:set|create)\s+(?:an?\s+)?alarm\s+(?:for|at)\s+(.+)/i)
        || text.match(/(?:wake\s+me\s+up)\s+(?:at|by)\s+(.+)/i);
    if (alarmMatch) {
        const time = alarmMatch[1].replace(/\b\w/g, c => c.toUpperCase());
        lastContext = { intent: INTENTS.SET_ALARM, entity: time, timestamp: Date.now() };
        return { intent: INTENTS.SET_ALARM, time, raw: input };
    }

    const calMatch = text.match(/(?:schedule|add|create|set)\s+(?:a\s+)?(?:meeting|event|appointment|reminder)?\s*(.+?)(?:\s+(?:on|for|at|tomorrow|today)\s+(.+))?$/i)
        || text.match(/(?:remember|remind\s+me)\s+(?:to\s+)?(.+?)(?:\s+(?:on|at|tomorrow)\s+(.+))?$/i);
    if (calMatch && (text.includes('schedule') || text.includes('meeting') || text.includes('calendar') || text.includes('event') || text.includes('appointment') || text.includes('tomorrow') || text.includes('remind'))) {
        const event = calMatch[1].replace(/\b\w/g, c => c.toUpperCase()).trim();
        const when = calMatch[2] ? calMatch[2].replace(/\b\w/g, c => c.toUpperCase()).trim() : 'Today';
        lastContext = { intent: INTENTS.CALENDAR, entity: event, timestamp: Date.now() };
        return { intent: INTENTS.CALENDAR, event, when, raw: input };
    }

    const mediaMatch = text.match(/(?:play|start\s+playing|queue)\s+(.+)/i);
    const mediaPause = /^(?:pause|stop|resume)\s*(?:music|song|playback|media)?$/i.test(text);
    const volumeMatch = text.match(/(?:volume|turn)\s+(?:up|down|to\s+\d+)/i)
        || text.match(/(?:set\s+volume\s+to)\s+(\d+)/i);
    if (mediaMatch) {
        const song = mediaMatch[1].replace(/\b\w/g, c => c.toUpperCase());
        lastContext = { intent: INTENTS.MEDIA, entity: song, timestamp: Date.now() };
        return { intent: INTENTS.MEDIA, action: 'play', song, raw: input };
    }
    if (mediaPause) {
        return { intent: INTENTS.MEDIA, action: text.includes('resume') ? 'resume' : 'pause', raw: input };
    }
    if (volumeMatch) {
        return { intent: INTENTS.MEDIA, action: 'volume', detail: volumeMatch[0], raw: input };
    }

    // Weather query
    if (/(?:weather|temperature|forecast|how\s+(?:hot|cold|warm)\s+is\s+it)/i.test(text)) {
        return { intent: INTENTS.WEATHER, raw: input };
    }

    const noteMatch = text.match(/(?:note|write\s+down|jot\s+down|add\s+note|take\s+a\s+note)[:\s]+(.+)/i)
        || text.match(/(?:note|write|jot):\s*(.+)/i);
    if (noteMatch) {
        const content = noteMatch[1].trim();
        lastContext = { intent: INTENTS.NOTE, entity: content, timestamp: Date.now() };
        return { intent: INTENTS.NOTE, content, raw: input };
    }

    const convertMatch = text.match(/convert\s+([\d.]+)\s+(\w+)\s+to\s+(\w+)/i)
        || text.match(/([\d.]+)\s+(\w+)\s+(?:to|in)\s+(\w+)/i);
    if (convertMatch && !text.match(/(?:what|how|calc)/i)) {
        const value = parseFloat(convertMatch[1]);
        const from = convertMatch[2].toLowerCase();
        const to = convertMatch[3].toLowerCase();
        return { intent: INTENTS.CONVERT, value, from, to, raw: input };
    }

    // Word-based math
    if (isWordMath(text)) {
        const wordExpr = parseWordMath(text);
        return { intent: INTENTS.CALCULATE, expression: wordExpr, wordMath: true, raw: input };
    }

    const calcMatch = text.match(/(?:calculate|what\s+is|compute|solve|eval)\s+(.+)/i)
        || text.match(/^([\d\s+\-*\/().^%]+)$/);
    if (calcMatch) {
        const expr = calcMatch[1].trim();
        return { intent: INTENTS.CALCULATE, expression: expr, raw: input };
    }

    const fileMatch = text.match(/(?:find|search|look\s+for|locate|where\s+is|open\s+file)\s+(.+)/i)
        || text.match(/(?:what'?s?\s+(?:in|inside))\s+(?:my\s+)?(.+?)(?:\s+file)?$/i);
    if (fileMatch) {
        const file = fileMatch[1].trim();
        lastContext = { intent: INTENTS.FILE_SEARCH, entity: file, timestamp: Date.now() };
        return { intent: INTENTS.FILE_SEARCH, file, raw: input };
    }

    return { intent: INTENTS.UNKNOWN, raw: input };
}

// ===== SAFE EVALUATE (with word math support) =====
function safeEvaluate(expr) {
    try {
        // First, try word math conversion
        let preprocessed = expr;
        if (/[a-zA-Z]/.test(expr) && !/^Math\./.test(expr)) {
            preprocessed = parseWordMath(expr);
        }

        // Handle Math.sqrt()
        if (preprocessed.includes('Math.sqrt(')) {
            const sqrtMatch = preprocessed.match(/Math\.sqrt\(([\d.]+)\)/);
            if (sqrtMatch) {
                const val = parseFloat(sqrtMatch[1]);
                const sqrtResult = Math.sqrt(val);
                const formatted = Number.isInteger(sqrtResult) ? sqrtResult.toString() : sqrtResult.toFixed(4).replace(/\.?0+$/, '');
                return { value: formatted };
            }
        }

        let cleaned = preprocessed
            .replace(/[×x]/gi, '*')
            .replace(/[÷]/g, '/')
            .replace(/\^/g, '**')
            .replace(/[^\d+\-*/.()%\s]/g, '')
            .trim();

        if (!cleaned || cleaned.length > 200) {
            return { error: 'Invalid expression' };
        }

        // Tokenize
        const tokens = [];
        let i = 0;
        while (i < cleaned.length) {
            if (/\s/.test(cleaned[i])) { i++; continue; }
            if (/[0-9.]/.test(cleaned[i])) {
                let num = '';
                while (i < cleaned.length && /[0-9.]/.test(cleaned[i])) {
                    num += cleaned[i++];
                }
                tokens.push({ type: 'num', value: parseFloat(num) });
                if (isNaN(tokens[tokens.length - 1].value)) return { error: 'Invalid number' };
                continue;
            }
            if (cleaned[i] === '*' && cleaned[i + 1] === '*') {
                tokens.push({ type: 'op', value: '**' }); i += 2; continue;
            }
            if ('+-*/%'.includes(cleaned[i])) {
                tokens.push({ type: 'op', value: cleaned[i] }); i++; continue;
            }
            if (cleaned[i] === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
            if (cleaned[i] === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
            return { error: 'Unexpected character' };
        }

        if (tokens.length === 0) return { error: 'Empty expression' };
        if (tokens.length > 50) return { error: 'Expression too complex' };

        let pos = 0;
        function peek() { return tokens[pos]; }
        function consume() { return tokens[pos++]; }

        function parseExpr() {
            let left = parseTerm();
            while (pos < tokens.length && peek()?.type === 'op' && (peek().value === '+' || peek().value === '-')) {
                const op = consume().value;
                const right = parseTerm();
                left = op === '+' ? left + right : left - right;
            }
            return left;
        }

        function parseTerm() {
            let left = parsePower();
            while (pos < tokens.length && peek()?.type === 'op' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
                const op = consume().value;
                const right = parsePower();
                if (op === '/') {
                    if (right === 0) throw new Error('Division by zero');
                    left = left / right;
                } else if (op === '%') {
                    left = left % right;
                } else {
                    left = left * right;
                }
            }
            return left;
        }

        function parsePower() {
            let base = parseUnary();
            if (pos < tokens.length && peek()?.type === 'op' && peek().value === '**') {
                consume();
                const exp = parsePower();
                base = Math.pow(base, exp);
            }
            return base;
        }

        function parseUnary() {
            if (peek()?.type === 'op' && (peek().value === '-' || peek().value === '+')) {
                const op = consume().value;
                const val = parseUnary();
                return op === '-' ? -val : val;
            }
            return parsePrimary();
        }

        function parsePrimary() {
            if (peek()?.type === 'lparen') {
                consume();
                const val = parseExpr();
                if (!peek() || peek().type !== 'rparen') throw new Error('Missing )');
                consume();
                return val;
            }
            if (peek()?.type === 'num') {
                return consume().value;
            }
            throw new Error('Unexpected token');
        }

        const result = parseExpr();
        if (pos < tokens.length) throw new Error('Unexpected tokens after expression');

        if (typeof result !== 'number' || !isFinite(result)) {
            return { error: 'Result is not a valid number' };
        }

        const formatted = Number.isInteger(result) ? result.toString() : result.toFixed(4).replace(/\.?0+$/, '');
        return { value: formatted };
    } catch (e) {
        return { error: e.message || 'Could not parse expression' };
    }
}

// ===== UNIT CONVERTER =====
function convertUnit(value, from, to) {
    const conversions = {
        'miles_km': 1.60934, 'miles_kilometers': 1.60934,
        'km_miles': 0.621371, 'kilometers_miles': 0.621371,
        'feet_meters': 0.3048, 'ft_m': 0.3048,
        'meters_feet': 3.28084, 'm_ft': 3.28084,
        'inches_cm': 2.54, 'in_cm': 2.54,
        'cm_inches': 0.393701, 'cm_in': 0.393701,
        'pounds_kg': 0.453592, 'lbs_kg': 0.453592, 'lb_kg': 0.453592,
        'kg_pounds': 2.20462, 'kg_lbs': 2.20462, 'kg_lb': 2.20462,
        'ounces_grams': 28.3495, 'oz_g': 28.3495,
        'grams_ounces': 0.035274, 'g_oz': 0.035274,
        'celsius_fahrenheit': null, 'c_f': null,
        'fahrenheit_celsius': null, 'f_c': null,
        'liters_gallons': 0.264172, 'l_gal': 0.264172,
        'gallons_liters': 3.78541, 'gal_l': 3.78541,
    };

    const key = `${from}_${to}`;
    const factor = conversions[key];

    if (factor === undefined) return { error: true };

    if (factor === null) {
        if (key === 'celsius_fahrenheit' || key === 'c_f') {
            return { value: ((value * 9 / 5) + 32).toFixed(2) };
        }
        if (key === 'fahrenheit_celsius' || key === 'f_c') {
            return { value: ((value - 32) * 5 / 9).toFixed(2) };
        }
    }

    return { value: (value * factor).toFixed(4).replace(/\.?0+$/, '') };
}

// ===== FILE SEARCH =====
function simulateFileSearch(query) {
    const files = [
        { name: 'Invoice_March.pdf', path: '/Documents/Invoices/', size: '245 KB', summary: 'March 2026 invoice. Total: $3,847.50.' },
        { name: 'Budget_2026.xlsx', path: '/Documents/Finance/', size: '128 KB', summary: 'Annual budget spreadsheet.' },
        { name: 'Meeting_Notes.txt', path: '/Documents/Work/', size: '12 KB', summary: 'Notes from team standup.' },
        { name: 'Grocery_List.txt', path: '/Notes/', size: '2 KB', summary: 'Shopping list: Milk, Eggs, Bread.' },
        { name: 'Resume_2026.pdf', path: '/Documents/Personal/', size: '156 KB', summary: 'Updated resume.' },
    ];

    const queryLower = query.toLowerCase().replace(/['"]/g, '');
    const match = files.find(f =>
        f.name.toLowerCase().includes(queryLower) ||
        queryLower.includes(f.name.toLowerCase().replace(/\.[^.]+$/, ''))
    );

    if (match) return { text: `Found ${match.name}`, detail: match.summary };

    const contentMatch = files.find(f =>
        f.summary.toLowerCase().includes(queryLower) ||
        queryLower.split(' ').some(word => word.length > 3 && f.summary.toLowerCase().includes(word))
    );

    if (contentMatch) return { text: `Found in ${contentMatch.name}`, detail: contentMatch.summary };
    return { text: 'No files found', detail: `Searched ${files.length} docs.` };
}

// ===== TEST RUNNER =====
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName) {
    if (condition) {
        passed++;
    } else {
        failed++;
        failures.push(testName);
        console.log(`  ❌ FAILED: ${testName}`);
    }
}

function assertEqual(actual, expected, testName) {
    if (actual === expected) {
        passed++;
    } else {
        failed++;
        failures.push(testName);
        console.log(`  ❌ FAILED: ${testName} — expected "${expected}", got "${actual}"`);
    }
}

// ===== TEST SUITE =====

console.log('\n═══════════════════════════════════════');
console.log('  Nice App — Comprehensive Test Suite');
console.log('═══════════════════════════════════════\n');

// --- 1. COMMAND PARSER TESTS ---
console.log('🧪 Command Parser Tests');
console.log('─────────────────────────');

// Greetings
assertEqual(parseCommand('Hi').intent, 'GREETING', 'Parse: hi → GREETING');
assertEqual(parseCommand('Hello').intent, 'GREETING', 'Parse: hello → GREETING');
assertEqual(parseCommand('Hey').intent, 'GREETING', 'Parse: hey → GREETING');
assertEqual(parseCommand('Good morning').intent, 'GREETING', 'Parse: good morning → GREETING');
assertEqual(parseCommand('What\'s up').intent, 'GREETING', 'Parse: what\'s up → GREETING');

// Help
assertEqual(parseCommand('Help').intent, 'HELP', 'Parse: help → HELP');
assertEqual(parseCommand('What can you do').intent, 'HELP', 'Parse: what can you do → HELP');

// Launch App
assertEqual(parseCommand('Open Camera').intent, 'LAUNCH_APP', 'Parse: open camera → LAUNCH_APP');
assertEqual(parseCommand('Launch Settings').intent, 'LAUNCH_APP', 'Parse: launch settings → LAUNCH_APP');
assertEqual(parseCommand('Run Calculator').intent, 'LAUNCH_APP', 'Parse: run calculator → LAUNCH_APP');

// Set Alarm
assertEqual(parseCommand('Set alarm for 7 AM').intent, 'SET_ALARM', 'Parse: set alarm → SET_ALARM');
assertEqual(parseCommand('Wake me up at 6:30 AM').intent, 'SET_ALARM', 'Parse: wake me up → SET_ALARM');
assertEqual(parseCommand('Set an alarm for 9 PM').intent, 'SET_ALARM', 'Parse: set an alarm → SET_ALARM');

// Calendar
assertEqual(parseCommand('Schedule meeting tomorrow at 3 PM').intent, 'CALENDAR', 'Parse: schedule meeting → CALENDAR');
assertEqual(parseCommand('Remind me to call dentist').intent, 'CALENDAR', 'Parse: remind me → CALENDAR');

// Media
assertEqual(parseCommand('Play Bohemian Rhapsody').intent, 'MEDIA', 'Parse: play song → MEDIA');
assertEqual(parseCommand('Pause music').intent, 'MEDIA', 'Parse: pause → MEDIA');
assertEqual(parseCommand('Resume').intent, 'MEDIA', 'Parse: resume → MEDIA');

// Note
assertEqual(parseCommand('Note: Buy groceries and milk').intent, 'NOTE', 'Parse: note → NOTE');
assertEqual(parseCommand('Write down: meeting at 5').intent, 'NOTE', 'Parse: write down → NOTE');

// Weather
assertEqual(parseCommand('Weather today').intent, 'WEATHER', 'Parse: weather → WEATHER');
assertEqual(parseCommand('What is the temperature').intent, 'WEATHER', 'Parse: temperature → WEATHER');

// Calculate
assertEqual(parseCommand('What is 145 * 32').intent, 'CALCULATE', 'Parse: what is math → CALCULATE');
assertEqual(parseCommand('Calculate 100 + 200').intent, 'CALCULATE', 'Parse: calculate → CALCULATE');

// Word Math Detection
assertEqual(parseCommand('five plus three').intent, 'CALCULATE', 'Parse: five plus three → CALCULATE');
assertEqual(parseCommand('twenty times four').intent, 'CALCULATE', 'Parse: twenty times four → CALCULATE');
assertEqual(parseCommand('ten divided by two').intent, 'CALCULATE', 'Parse: ten divided by two → CALCULATE');
assertEqual(parseCommand('seven minus three').intent, 'CALCULATE', 'Parse: seven minus three → CALCULATE');
assertEqual(parseCommand('twelve multiplied by five').intent, 'CALCULATE', 'Parse: twelve multiplied by five → CALCULATE');

// Convert
assertEqual(parseCommand('Convert 5 miles to km').intent, 'CONVERT', 'Parse: convert → CONVERT');
assertEqual(parseCommand('Convert 5 miles to kilometers').intent, 'CONVERT', 'Parse: convert to km → CONVERT');

// File Search
assertEqual(parseCommand('Find Invoice_March.pdf').intent, 'FILE_SEARCH', 'Parse: find file → FILE_SEARCH');
assertEqual(parseCommand('Search budget report').intent, 'FILE_SEARCH', 'Parse: search → FILE_SEARCH');

// Play vs Open conflict
assertEqual(parseCommand('Play Bohemian Rhapsody').intent, 'MEDIA', 'BugFix: play → MEDIA not LAUNCH_APP');
assert(parseCommand('Play Bohemian Rhapsody').action === 'play', 'BugFix: play action is play');
assertEqual(parseCommand('Open Camera').intent, 'LAUNCH_APP', 'BugFix: open still works for LAUNCH_APP');

// Unknown
assertEqual(parseCommand('xyzzy').intent, 'UNKNOWN', 'Parse: gibberish → UNKNOWN');
assertEqual(parseCommand('blah blah blah').intent, 'UNKNOWN', 'Parse: random → UNKNOWN');

console.log('');

// --- 2. WORD MATH ENGINE TESTS ---
console.log('🧪 Word Math Engine Tests');
console.log('─────────────────────────');

// Basic word math
assertEqual(parseWordMath('five plus three'), '5 + 3', 'WordMath: five plus three → 5 + 3');
assertEqual(parseWordMath('twenty times four'), '20 * 4', 'WordMath: twenty times four → 20 * 4');
assertEqual(parseWordMath('ten minus seven'), '10 - 7', 'WordMath: ten minus seven → 10 - 7');
assertEqual(parseWordMath('fifteen divided by three'), '15 / 3', 'WordMath: fifteen divided by three → 15 / 3');
assertEqual(parseWordMath('eight multiplied by six'), '8 * 6', 'WordMath: eight multiplied by six → 8 * 6');

// Compound numbers
assertEqual(parseWordMath('twenty three plus seven'), '23 + 7', 'WordMath: twenty three + seven → 23 + 7');
assertEqual(parseWordMath('fifty five minus ten'), '55 - 10', 'WordMath: fifty five - ten → 55 - 10');

// Large numbers
assertEqual(parseWordMath('five hundred plus three'), '500 + 3', 'WordMath: five hundred + three → 500 + 3');
assertEqual(parseWordMath('two thousand times three'), '2000 * 3', 'WordMath: two thousand × three → 2000 * 3');

// Word math evaluation
assertEqual(safeEvaluate('5 + 3').value, '8', 'Eval WordMath: 5+3 = 8');
assertEqual(safeEvaluate('20 * 4').value, '80', 'Eval WordMath: 20*4 = 80');
assertEqual(safeEvaluate('15 / 3').value, '5', 'Eval WordMath: 15/3 = 5');
assertEqual(safeEvaluate('10 - 7').value, '3', 'Eval WordMath: 10-7 = 3');
assertEqual(safeEvaluate('23 + 7').value, '30', 'Eval WordMath: 23+7 = 30');

// End-to-end word math
const fivePlusThree = parseCommand('five plus three');
assertEqual(safeEvaluate(fivePlusThree.expression).value, '8', 'E2E: five plus three = 8');

const twentyTimesFour = parseCommand('twenty times four');
assertEqual(safeEvaluate(twentyTimesFour.expression).value, '80', 'E2E: twenty times four = 80');

const tenDivTwo = parseCommand('ten divided by two');
assertEqual(safeEvaluate(tenDivTwo.expression).value, '5', 'E2E: ten divided by two = 5');

console.log('');

// --- 3. STANDARD MATH EVALUATOR TESTS ---
console.log('🧪 Math Evaluator Tests');
console.log('─────────────────────────');

assertEqual(safeEvaluate('2 + 2').value, '4', 'Math: 2+2 = 4');
assertEqual(safeEvaluate('145 * 32').value, '4640', 'Math: 145*32 = 4640');
assertEqual(safeEvaluate('100 / 3').value, '33.3333', 'Math: 100/3 = 33.3333');
assertEqual(safeEvaluate('2 ** 10').value, '1024', 'Math: 2^10 = 1024');
assertEqual(safeEvaluate('(10 + 5) * 3').value, '45', 'Math: (10+5)*3 = 45');
assertEqual(safeEvaluate('0.1 + 0.2').value, '0.3', 'Math: 0.1+0.2 = 0.3');
assertEqual(safeEvaluate('100 - 75').value, '25', 'Math: 100-75 = 25');
assert(safeEvaluate('abc').error !== undefined, 'Math: invalid → error');
assert(safeEvaluate('1/0').error !== undefined, 'Math: division by zero → error');
assert(safeEvaluate('').error !== undefined, 'Math: empty → error');

console.log('');

// --- 4. UNIT CONVERTER TESTS ---
console.log('🧪 Unit Converter Tests');
console.log('─────────────────────────');

assertEqual(convertUnit(5, 'miles', 'km').value, '8.0467', 'Convert: 5 miles → 8.0467 km');
assertEqual(convertUnit(10, 'km', 'miles').value, '6.2137', 'Convert: 10 km → 6.2137 miles');
assertEqual(convertUnit(100, 'celsius', 'fahrenheit').value, '212.00', 'Convert: 100°C → 212°F');
assertEqual(convertUnit(32, 'fahrenheit', 'celsius').value, '0.00', 'Convert: 32°F → 0°C');
assertEqual(convertUnit(1, 'kg', 'pounds').value, '2.2046', 'Convert: 1 kg → 2.2046 lbs');
assertEqual(convertUnit(1, 'liters', 'gallons').value, '0.2642', 'Convert: 1L → 0.2642 gal');
assert(convertUnit(1, 'bananas', 'oranges').error === true, 'Convert: invalid → error');

console.log('');

// --- 5. FILE SEARCH TESTS ---
console.log('🧪 File Search Tests');
console.log('─────────────────────────');

assert(simulateFileSearch('Invoice_March.pdf').text.includes('Invoice_March.pdf'), 'FileSearch: exact match');
assert(simulateFileSearch('budget').text.includes('Budget'), 'FileSearch: partial match');
assert(simulateFileSearch('invoice march').text.includes('Invoice'), 'FileSearch: fuzzy match');
assert(simulateFileSearch('xyznonexistent').text.includes('No files'), 'FileSearch: no match');
assert(simulateFileSearch('resume').text.includes('Resume'), 'FileSearch: resume match');

console.log('');

// --- 6. EDGE CASE TESTS ---
console.log('🧪 Edge Case Tests');
console.log('─────────────────────────');

assertEqual(parseCommand('').intent, 'UNKNOWN', 'Edge: empty string → UNKNOWN');
assertEqual(parseCommand('   ').intent, 'UNKNOWN', 'Edge: whitespace → UNKNOWN');

assertEqual(parseCommand('OPEN CAMERA').intent, 'LAUNCH_APP', 'Edge: uppercase → LAUNCH_APP');
assertEqual(parseCommand('set ALARM for 7 AM').intent, 'SET_ALARM', 'Edge: mixed case → SET_ALARM');

assertEqual(safeEvaluate('145 × 32').value, '4640', 'Edge: multiplication sign × works');

// Follow-up context
lastContext = { intent: null, entity: null, timestamp: 0 };
parseCommand('Find Invoice_March.pdf');
const followUp = parseCommand('open it');
assertEqual(followUp.intent, 'LAUNCH_APP', 'Edge: follow-up "open it" → LAUNCH_APP');
assert(followUp.followUp === true, 'Edge: followUp flag set');

// Word math edge cases
assert(isWordMath('five plus three'), 'isWordMath: "five plus three" is detected');
assert(!isWordMath('hello world'), 'isWordMath: "hello world" is not detected');
assert(isWordMath('twenty times four'), 'isWordMath: "twenty times four" is detected');
assert(!isWordMath('five things'), 'isWordMath: "five things" has no operator');

console.log('');

// --- 7. SPECIFIC DATA EXTRACTION TESTS ---
console.log('🧪 Specific Data Pattern Tests');
console.log('─────────────────────────');

// Test Aadhaar detection regex
const aadhaarRegex = /\b\d{4}\s*\d{4}\s*\d{4}\b/g;
const testDoc = 'Name: John Doe, Aadhaar: 1234 5678 9012, Phone: 9876543210';
const aadhaarMatches = testDoc.match(aadhaarRegex);
assert(aadhaarMatches && aadhaarMatches.length > 0, 'Pattern: Aadhaar number detected');
assertEqual(aadhaarMatches[0].trim(), '1234 5678 9012', 'Pattern: Aadhaar number correct');

// Test Phone detection regex
const phoneRegex = /(?:\+\d{1,3}[\s-]?)?(?:\d{10}|\d{3}[\s-]\d{3}[\s-]\d{4})/g;
const phoneMatches = testDoc.match(phoneRegex);
assert(phoneMatches && phoneMatches.length > 0, 'Pattern: Phone number detected');

// Test Email detection regex
const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const emailDoc = 'Contact: john@example.com for details';
const emailMatches = emailDoc.match(emailRegex);
assert(emailMatches && emailMatches.length > 0, 'Pattern: Email detected');
assertEqual(emailMatches[0], 'john@example.com', 'Pattern: Email correct');

// Test PAN detection regex
const panRegex = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
const panDoc = 'PAN: ABCDE1234F, verified';
const panMatches = panDoc.match(panRegex);
assert(panMatches && panMatches.length > 0, 'Pattern: PAN number detected');

console.log('');

// --- RESULTS ---
console.log('═══════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════');

if (failures.length > 0) {
    console.log('\n❌ Failed tests:');
    failures.forEach(f => console.log(`   • ${f}`));
}

if (failed === 0) {
    console.log('\n✅ ALL TESTS PASSED — Ready for launch!\n');
} else {
    console.log(`\n⚠️  ${failed} test(s) need attention before launch.\n`);
}

process.exit(failed > 0 ? 1 : 0);
