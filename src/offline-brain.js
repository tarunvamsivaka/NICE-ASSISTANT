/**
 * Nice - Offline Brain
 * Lightweight local reasoning utilities for intent inference and multi-step planning.
 */

const MAX_PLAN_STEPS = 5;

const PRIMARY_SPLIT_RE = /\s*(?:\band then\b|\bthen\b|;|\r?\n)\s*/i;
const IMPERATIVE_VERB_RE = /\b(open|launch|start|run|set|create|scan|index|search|find|play|pause|resume|stop|cancel|show|get|toggle|turn|check)\b/i;
const FILE_LIKE_RE = /\.[a-z0-9]{1,6}$/i;

function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function titleCase(input) {
    return String(input || '')
        .trim()
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function splitByHeuristicAnd(segment) {
    const value = clean(segment);
    if (!value || !value.includes(' and ')) return [value];
    const parts = value.split(/\band\b/i).map(clean).filter(Boolean);
    if (parts.length !== 2) return [value];
    if (parts.every((part) => IMPERATIVE_VERB_RE.test(part))) return parts;
    return [value];
}

export function buildOfflineExecutionPlan(rawInput) {
    const source = clean(rawInput);
    if (!source) return { steps: [], reasoning: 'empty' };

    let steps = source
        .split(PRIMARY_SPLIT_RE)
        .map(clean)
        .filter(Boolean);

    if (steps.length === 1) {
        steps = splitByHeuristicAnd(steps[0]);
    } else {
        steps = steps.flatMap(splitByHeuristicAnd);
    }

    const uniqueSteps = [];
    const seen = new Set();
    for (const step of steps) {
        const key = step.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueSteps.push(step);
        if (uniqueSteps.length >= MAX_PLAN_STEPS) break;
    }

    return {
        steps: uniqueSteps,
        reasoning: uniqueSteps.length > 1 ? 'multi_step_detected' : 'single_step',
    };
}

function inferOpenFileIntent(text) {
    const openFileMatch = text.match(/(?:open|show|view)\s+(?:file\s+)?(.+)/i);
    if (!openFileMatch) return null;
    const target = clean(openFileMatch[1]);
    if (!target) return null;
    if (!FILE_LIKE_RE.test(target) && !/\bfile\b/i.test(text)) return null;
    return {
        intent: 'OPEN_FILE',
        confidence: 0.83,
        reason: 'open_file_pattern',
        entity: target,
    };
}

function inferLaunchAppIntent(text) {
    const launchMatch = text.match(/(?:open|launch|start|run)\s+(.+)/i);
    if (!launchMatch) return null;
    const candidate = clean(launchMatch[1]).replace(/\s+(?:app|application)$/i, '');
    if (!candidate) return null;
    if (FILE_LIKE_RE.test(candidate)) return null;
    return {
        intent: 'LAUNCH_APP',
        confidence: 0.76,
        reason: 'launch_pattern',
        entity: titleCase(candidate),
    };
}

/**
 * Best-effort local inference for commands that slipped through strict parser patterns.
 * Returns null when confidence is low.
 */
export function inferOfflineIntent(rawInput) {
    const text = clean(rawInput).toLowerCase();
    if (!text) return null;

    if (/^(?:what(?:'s| is)?\s+the\s+time|time now|current time|date today|what(?:'s| is)?\s+today(?:'s)?\s+date)$/i.test(text)) {
        return { intent: 'TIME_QUERY', confidence: 0.92, reason: 'time_query' };
    }

    if (/(?:scan|index|rescan)\s+(?:my\s+)?(?:files|storage|device)/i.test(text)) {
        return { intent: 'SCAN_FILES', confidence: 0.9, reason: 'scan_files' };
    }

    if (/(?:storage|file)\s*(?:status|stats|count)|how many files/i.test(text)) {
        return { intent: 'STORAGE_STATS', confidence: 0.86, reason: 'storage_stats' };
    }

    if (/(?:battery|charge)\s*(?:status|level|percent)?/i.test(text)) {
        return { intent: 'BATTERY', confidence: 0.86, reason: 'battery' };
    }

    if (/(?:flashlight|torch)/i.test(text)) {
        return { intent: 'FLASHLIGHT', confidence: 0.84, reason: 'flashlight' };
    }

    if (/^(?:mute|unmute|toggle voice|toggle tts)$/i.test(text)) {
        return { intent: 'MUTE_TOGGLE', confidence: 0.82, reason: 'tts_toggle' };
    }

    if (/(?:timer status|remaining timer|how much time left)/i.test(text)) {
        return { intent: 'TIMER_STATUS', confidence: 0.84, reason: 'timer_status' };
    }

    const openFileGuess = inferOpenFileIntent(rawInput);
    if (openFileGuess) return openFileGuess;

    const launchGuess = inferLaunchAppIntent(rawInput);
    if (launchGuess) return launchGuess;

    return null;
}

