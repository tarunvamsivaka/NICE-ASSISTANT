/**
 * Nice - Offline Automation Engine
 * User-defined trigger -> action command rules, executed locally.
 */

const STORAGE_KEY = 'nice_automations_v1';
const MAX_RULES = 60;

let cache = null;

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(text) {
  return normalize(text).toLowerCase();
}

function loadRules() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cache = parsed.filter(Boolean);
        return cache;
      }
    }
  } catch {
    // ignore and reset
  }
  cache = [];
  return cache;
}

function saveRules(next) {
  cache = next.slice(0, MAX_RULES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

export function createAutomationRule(trigger, action) {
  const cleanTrigger = normalize(trigger);
  const cleanAction = normalize(action);
  if (!cleanTrigger || !cleanAction) {
    return { success: false, message: 'Automation needs both trigger and action.' };
  }

  const key = normalizeKey(cleanTrigger);
  const rules = loadRules();
  const existingIdx = rules.findIndex(rule => normalizeKey(rule.trigger) === key);
  const rule = {
    id: existingIdx >= 0 ? rules[existingIdx].id : `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    trigger: cleanTrigger.slice(0, 120),
    action: cleanAction.slice(0, 220),
    updatedAt: Date.now(),
  };

  if (existingIdx >= 0) rules[existingIdx] = rule;
  else rules.push(rule);
  saveRules(rules);
  return { success: true, rule };
}

export function removeAutomationRule(triggerOrId) {
  const key = normalizeKey(triggerOrId);
  const rules = loadRules();
  const before = rules.length;
  const next = rules.filter(rule => rule.id !== triggerOrId && normalizeKey(rule.trigger) !== key);
  saveRules(next);
  return { removed: before - next.length };
}

export function listAutomationRules() {
  return [...loadRules()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function matchAutomationRule(inputText) {
  const key = normalizeKey(inputText);
  if (!key) return null;
  const rules = loadRules();

  // Exact trigger first.
  const exact = rules.find(rule => normalizeKey(rule.trigger) === key);
  if (exact) return exact;

  // Prefix fallback for short trigger commands.
  const fuzzy = rules.find(rule => {
    const trigger = normalizeKey(rule.trigger);
    return trigger.length >= 4 && key.startsWith(trigger);
  });
  return fuzzy || null;
}

