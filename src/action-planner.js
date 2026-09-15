/**
 * Nice - Safe Offline Action Planner
 * Builds executable multi-step plans and blocks unsafe/off-policy steps.
 */

import { buildOfflineExecutionPlan } from './offline-brain.js';

const MAX_PLAN_STEPS = 5;
const BLOCKED_INTENTS = new Set([
  'UNKNOWN',
  'DELETE_NOTES',
  'GO_ONLINE',
  'AUTOMATION_CREATE',
  'AUTOMATION_DELETE',
]);

function normalizeStepLabel(step) {
  return String(step?.raw || step?.intent || '').trim();
}

function makeStepKey(step) {
  const intent = String(step?.intent || '').toUpperCase();
  const raw = String(step?.raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${intent}::${raw}`;
}

export function buildSafeActionPlan(rawInput, parseStep) {
  const planner = typeof parseStep === 'function' ? parseStep : null;
  if (!planner) {
    return {
      steps: [],
      blocked: [],
      warnings: ['planner_missing'],
      reasoning: 'planner_missing',
      safe: false,
    };
  }

  const plan = buildOfflineExecutionPlan(rawInput);
  const blocked = [];
  const steps = [];
  const warnings = [];
  const seen = new Set();

  for (const stepText of plan.steps.slice(0, MAX_PLAN_STEPS)) {
    const parsed = planner(stepText);
    const label = String(stepText || '').trim();

    if (!parsed || !parsed.intent || parsed.intent === 'UNKNOWN') {
      blocked.push({ step: label, reason: 'unresolved_intent' });
      continue;
    }

    if (BLOCKED_INTENTS.has(parsed.intent)) {
      blocked.push({ step: label, reason: `blocked_intent:${parsed.intent}` });
      continue;
    }

    const key = makeStepKey(parsed);
    if (seen.has(key)) {
      warnings.push(`duplicate_step:${label}`);
      continue;
    }
    seen.add(key);
    steps.push(parsed);
  }

  if (plan.steps.length > MAX_PLAN_STEPS) {
    warnings.push(`plan_trimmed:${plan.steps.length}->${MAX_PLAN_STEPS}`);
  }

  if (steps.length === 0) {
    return {
      steps,
      blocked,
      warnings,
      reasoning: plan.reasoning || 'no_safe_steps',
      safe: false,
    };
  }

  return {
    steps,
    blocked,
    warnings,
    reasoning: plan.reasoning || (steps.length > 1 ? 'multi_step_detected' : 'single_step'),
    safe: true,
  };
}

export function formatBlockedPlanSteps(blocked = []) {
  if (!Array.isArray(blocked) || blocked.length === 0) return '';
  const rows = blocked
    .slice(0, 3)
    .map((item, idx) => `${idx + 1}. ${normalizeStepLabel(item.step)} (${item.reason})`);
  return rows.join('\n');
}

