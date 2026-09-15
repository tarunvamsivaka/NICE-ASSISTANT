/**
 * Nice - Offline Usage Learning Engine
 * Learns user task patterns locally and stores them encrypted at rest.
 */

import { decryptObject, encryptObject, isSecureStorageAvailable } from './secure-store.js';

const STORAGE_KEY = 'nice_usage_learning_v2';
const LEGACY_STORAGE_KEY = 'nice_usage_learning_v1';
const CONSENT_KEY = 'nice_auto_learn_consent';
const LEGACY_ENABLE_KEY = 'nice_auto_learn';
const ENCRYPTION_KEY_ID = 'usage_learning_profile';

const MAX_PHRASES = 500;
const MAX_ENTITY_ITEMS = 300;
const SAFE_HINT_INTENTS = new Set([
  'TIME_QUERY',
  'BATTERY',
  'FLASHLIGHT',
  'MUTE_TOGGLE',
  'TIMER_STATUS',
  'LIST_NOTES',
  'STORAGE_STATS',
  'LAUNCH_APP',
  'MEDIA',
  'WEATHER',
  'SCAN_FILES',
  'FILE_SEARCH',
  'ASK_KNOWLEDGE',
]);

let inMemoryFallback = null;
let profileCache = null;
let bootstrapped = false;
let bootstrapPromise = null;
let persistChain = Promise.resolve();

function defaultProfile() {
  return {
    version: 2,
    updatedAt: 0,
    intents: {},
    phrases: {},
    transitions: {},
    entities: {},
    lastIntent: null,
    lastTaskAt: 0,
  };
}

function hasStorage() {
  return typeof localStorage !== 'undefined';
}

function readBoolean(key, fallback = false) {
  try {
    if (!hasStorage()) return fallback;
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

function writeBoolean(key, value) {
  try {
    if (hasStorage()) localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // Ignore write failures.
  }
}

export function getLearningConsent() {
  return readBoolean(CONSENT_KEY, false);
}

function isLegacyLearningEnabled() {
  try {
    if (!hasStorage()) return true;
    return localStorage.getItem(LEGACY_ENABLE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function isLearningEnabled() {
  return getLearningConsent() && isLegacyLearningEnabled();
}

export function setLearningConsent(enabled, opts = {}) {
  const next = !!enabled;
  writeBoolean(CONSENT_KEY, next);

  if (!next && opts.clearOnDisable !== false) {
    clearUsageLearning({ keepConsentFlag: true });
  } else if (next) {
    void bootstrapProfile(true);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nice:learning-policy-updated', {
      detail: {
        enabled: isLearningEnabled(),
        consent: next,
      },
    }));
  }
}

function normalizePhrase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function nowTs() {
  return Date.now();
}

async function readProfileFromStorage() {
  if (!hasStorage()) return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const decrypted = await decryptObject(raw, { keyId: ENCRYPTION_KEY_ID });
      if (decrypted && typeof decrypted === 'object') {
        return decrypted;
      }
      const maybePlain = JSON.parse(raw);
      if (maybePlain && typeof maybePlain === 'object') {
        return maybePlain;
      }
    }
  } catch {
    // Continue to legacy fallback.
  }

  try {
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    // ignore malformed storage and reset.
  }

  return null;
}

async function persistProfileEncrypted(profile) {
  if (!hasStorage() || !isLearningEnabled()) return;

  try {
    const payload = await encryptObject(profile, { keyId: ENCRYPTION_KEY_ID });
    localStorage.setItem(STORAGE_KEY, payload);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Fall back to in-memory profile if writes fail.
    inMemoryFallback = profile;
  }
}

function queuePersist(profile) {
  if (!isLearningEnabled()) return;
  const snapshot = JSON.parse(JSON.stringify(profile));
  persistChain = persistChain
    .then(() => persistProfileEncrypted(snapshot))
    .catch(() => { /* keep chain alive */ });
}

async function bootstrapProfile(force = false) {
  if (bootstrapped && !force) return bootstrapPromise || Promise.resolve(profileCache);
  if (bootstrapPromise && !force) return bootstrapPromise;

  bootstrapPromise = (async () => {
    if (!isLearningEnabled()) {
      profileCache = defaultProfile();
      inMemoryFallback = profileCache;
      bootstrapped = true;
      return profileCache;
    }

    const loaded = await readProfileFromStorage();
    profileCache = { ...defaultProfile(), ...(loaded || {}) };
    inMemoryFallback = profileCache;
    bootstrapped = true;
    return profileCache;
  })();

  return bootstrapPromise;
}

function loadProfile() {
  if (profileCache) return profileCache;

  if (!bootstrapped) {
    void bootstrapProfile();
  }

  if (inMemoryFallback) {
    profileCache = inMemoryFallback;
    return profileCache;
  }

  profileCache = defaultProfile();
  inMemoryFallback = profileCache;
  return profileCache;
}

function saveProfile(profile) {
  profile.updatedAt = nowTs();
  profileCache = profile;
  inMemoryFallback = profile;
  queuePersist(profile);
}

function ensureIntentStat(profile, intent) {
  if (!profile.intents[intent]) {
    profile.intents[intent] = {
      count: 0,
      success: 0,
      fail: 0,
      lastTs: 0,
      avgLatencyMs: 0,
      hourHistogram: Array(24).fill(0),
    };
  }
  return profile.intents[intent];
}

function updateTransition(profile, fromIntent, toIntent) {
  if (!fromIntent || !toIntent) return;
  if (!profile.transitions[fromIntent]) profile.transitions[fromIntent] = {};
  const nextBucket = profile.transitions[fromIntent];
  nextBucket[toIntent] = (nextBucket[toIntent] || 0) + 1;
}

function trimOldestItems(objectMap, maxCount, tsKey = 'lastTs') {
  const entries = Object.entries(objectMap);
  if (entries.length <= maxCount) return objectMap;
  entries.sort((a, b) => (b[1]?.[tsKey] || 0) - (a[1]?.[tsKey] || 0));
  const kept = entries.slice(0, maxCount);
  return Object.fromEntries(kept);
}

function updatePhraseModel(profile, phrase, intent) {
  if (!phrase) return;
  const existing = profile.phrases[phrase] || { total: 0, intents: {}, lastTs: 0 };
  existing.total += 1;
  existing.lastTs = nowTs();
  existing.intents[intent] = (existing.intents[intent] || 0) + 1;
  profile.phrases[phrase] = existing;
  profile.phrases = trimOldestItems(profile.phrases, MAX_PHRASES);
}

function updateEntityModel(profile, intent, entity) {
  const clean = String(entity || '').trim();
  if (!clean) return;
  if (!profile.entities[intent]) profile.entities[intent] = {};
  const bucket = profile.entities[intent];
  const existing = bucket[clean] || { count: 0, lastTs: 0 };
  existing.count += 1;
  existing.lastTs = nowTs();
  bucket[clean] = existing;
  profile.entities[intent] = trimOldestItems(bucket, MAX_ENTITY_ITEMS);
}

function topIntentFromPhraseEntry(entry) {
  const pairs = Object.entries(entry?.intents || {});
  if (!pairs.length) return null;
  pairs.sort((a, b) => b[1] - a[1]);
  const [intent, count] = pairs[0];
  const total = Math.max(1, Number(entry.total || 1));
  return {
    intent,
    count,
    total,
    confidence: count / total,
  };
}

function getTopEntityForIntentInternal(profile, intent) {
  const entities = profile.entities?.[intent];
  if (!entities) return null;
  const pairs = Object.entries(entities);
  if (!pairs.length) return null;
  pairs.sort((a, b) => b[1].count - a[1].count || b[1].lastTs - a[1].lastTs);
  return pairs[0][0];
}

function canonicalCommandForIntent(intent, profile) {
  switch (intent) {
    case 'TIME_QUERY':
      return 'What time is it?';
    case 'BATTERY':
      return 'Battery status';
    case 'FLASHLIGHT':
      return 'Toggle flashlight';
    case 'MUTE_TOGGLE':
      return 'Toggle voice';
    case 'TIMER_STATUS':
      return 'Timer status';
    case 'LIST_NOTES':
      return 'Show my notes';
    case 'STORAGE_STATS':
      return 'How many files do I have?';
    case 'WEATHER':
      return 'Weather now';
    case 'SCAN_FILES':
      return 'Scan my files';
    case 'FILE_SEARCH':
      return 'Search my files';
    case 'ASK_KNOWLEDGE':
      return 'What is my schedule today?';
    case 'LAUNCH_APP': {
      const app = getTopEntityForIntentInternal(profile, 'LAUNCH_APP') || 'Settings';
      return `Open ${app}`;
    }
    case 'MEDIA': {
      const song = getTopEntityForIntentInternal(profile, 'MEDIA');
      return song ? `Play ${song}` : 'Play a song';
    }
    default:
      return null;
  }
}

function shouldTrackIntent(intent) {
  if (!intent) return false;
  return !['UNKNOWN', 'GREETING', 'HELP', 'CONVERSATIONAL'].includes(intent);
}

export function recordTaskObservation({
  rawInput,
  intent,
  success = true,
  latencyMs = 0,
  entity = '',
} = {}) {
  if (!isLearningEnabled() || !shouldTrackIntent(intent)) return;

  const profile = loadProfile();
  const ts = nowTs();
  const hour = new Date(ts).getHours();
  const stat = ensureIntentStat(profile, intent);

  stat.count += 1;
  stat.lastTs = ts;
  stat.hourHistogram[hour] = (stat.hourHistogram[hour] || 0) + 1;
  if (success) stat.success += 1;
  else stat.fail += 1;

  const observedLatency = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : 0;
  if (observedLatency > 0) {
    const prevWeight = Math.max(0, stat.count - 1);
    stat.avgLatencyMs = ((stat.avgLatencyMs * prevWeight) + observedLatency) / Math.max(1, stat.count);
  }

  const phrase = normalizePhrase(rawInput);
  if (phrase.length >= 2) updatePhraseModel(profile, phrase, intent);

  updateEntityModel(profile, intent, entity);
  updateTransition(profile, profile.lastIntent, intent);
  profile.lastIntent = intent;
  profile.lastTaskAt = ts;

  saveProfile(profile);
}

export function getPreferredIntentForInput(rawInput, opts = {}) {
  const minCount = Number.isFinite(opts.minCount) ? opts.minCount : 2;
  const minConfidence = Number.isFinite(opts.minConfidence) ? opts.minConfidence : 0.68;
  const phrase = normalizePhrase(rawInput);
  if (!phrase || !isLearningEnabled()) return null;

  const profile = loadProfile();
  const entry = profile.phrases?.[phrase];
  if (!entry) return null;
  const top = topIntentFromPhraseEntry(entry);
  if (!top) return null;
  if (top.count < minCount || top.confidence < minConfidence) return null;
  return top;
}

export function getTopEntityForIntent(intent) {
  const profile = loadProfile();
  return getTopEntityForIntentInternal(profile, intent);
}

export function applyUsageIntentHint(parsed, rawInput) {
  if (!parsed || !rawInput || !isLearningEnabled()) return parsed;
  if (parsed.intent !== 'ASK_KNOWLEDGE' && parsed.intent !== 'UNKNOWN') return parsed;

  const inferred = getPreferredIntentForInput(rawInput);
  if (!inferred || !SAFE_HINT_INTENTS.has(inferred.intent)) return parsed;

  const hinted = { ...parsed, intent: inferred.intent, raw: rawInput, learnedHint: true };
  if (inferred.intent === 'LAUNCH_APP') {
    hinted.app = getTopEntityForIntent('LAUNCH_APP') || 'Settings';
  } else if (inferred.intent === 'MEDIA') {
    hinted.action = 'play';
    hinted.song = getTopEntityForIntent('MEDIA') || 'music';
  } else if (inferred.intent === 'FILE_SEARCH') {
    hinted.file = rawInput;
  } else if (inferred.intent === 'ASK_KNOWLEDGE') {
    hinted.question = rawInput;
  }
  return hinted;
}

export function getPersonalizedCommandSuggestions(opts = {}) {
  const limit = Number.isFinite(opts.limit) ? Math.max(1, opts.limit) : 6;
  const profile = loadProfile();
  const hour = (opts.now instanceof Date ? opts.now : new Date()).getHours();
  const out = [];
  const used = new Set();

  const addUnique = (command) => {
    const clean = String(command || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (used.has(key)) return;
    used.add(key);
    out.push(clean);
  };

  if (isLearningEnabled()) {
    // Transition-aware first suggestion.
    const transitions = profile.transitions?.[profile.lastIntent] || {};
    const transitionList = Object.entries(transitions).sort((a, b) => b[1] - a[1]);
    if (transitionList.length) {
      const candidate = canonicalCommandForIntent(transitionList[0][0], profile);
      addUnique(candidate);
    }

    const scoredIntents = Object.entries(profile.intents || {})
      .filter(([intent]) => shouldTrackIntent(intent))
      .map(([intent, stat]) => {
        const count = stat.count || 0;
        const lastTs = stat.lastTs || 0;
        const hourAffinity = stat.hourHistogram?.[hour] || 0;
        const successRate = count > 0 ? (stat.success || 0) / count : 0;
        const recencyBoost = Math.max(0, 1 - ((nowTs() - lastTs) / (1000 * 60 * 60 * 24 * 7)));
        const score = (count * 0.9) + (hourAffinity * 1.2) + (successRate * 2) + (recencyBoost * 1.4);
        return { intent, score };
      })
      .sort((a, b) => b.score - a.score);

    for (const item of scoredIntents) {
      addUnique(canonicalCommandForIntent(item.intent, profile));
      if (out.length >= limit) break;
    }
  }

  // Fallback defaults keep UX stable for cold-start users.
  const fallback = [
    'What time is it?',
    'Set alarm for 7 AM',
    'Play a song',
    'Scan my files',
    'Search my files',
    'Battery status',
    'Open calculator',
    'What can you do?',
  ];
  for (const cmd of fallback) {
    addUnique(cmd);
    if (out.length >= limit) break;
  }

  return out.slice(0, limit);
}

export function getLearningStatus() {
  const profile = loadProfile();
  const intentsTracked = Object.keys(profile.intents || {}).length;
  const phrasesTracked = Object.keys(profile.phrases || {}).length;
  const transitionsTracked = Object.keys(profile.transitions || {}).length;
  return {
    enabled: isLearningEnabled(),
    consentGranted: getLearningConsent(),
    secureAtRest: isSecureStorageAvailable(),
    bootstrapped,
    intentsTracked,
    phrasesTracked,
    transitionsTracked,
    lastTaskAt: profile.lastTaskAt || 0,
  };
}

export function clearUsageLearning(opts = {}) {
  profileCache = defaultProfile();
  inMemoryFallback = profileCache;

  try {
    if (hasStorage()) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      if (!opts.keepConsentFlag) {
        localStorage.removeItem(CONSENT_KEY);
      }
    }
  } catch {
    // Ignore cleanup failures.
  }
}

void bootstrapProfile();

