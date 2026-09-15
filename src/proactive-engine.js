/**
 * Nice - Proactive Suggestions Engine
 * Builds realtime offline suggestions from usage patterns + local context.
 */

import { getPersonalizedCommandSuggestions, getLearningStatus } from './usage-learning.js';
import { getKnowledgeGraphStats } from './knowledge-graph.js';
import { getIndexedFileCount, getFileIndex } from './filesys.js';

function isMorning(hour) {
  return hour >= 5 && hour < 12;
}

function isEvening(hour) {
  return hour >= 17 && hour < 22;
}

function pickAgendaHint() {
  try {
    const raw = localStorage.getItem('nice_timetable');
    if (!raw) return null;
    const text = String(raw).toLowerCase();
    if (text.includes('tomorrow')) return 'Show my schedule for tomorrow';
    if (text.includes('today')) return 'What is my schedule today?';
    return 'Search my files for timetable';
  } catch {
    return null;
  }
}

function pickFileThemeHint() {
  const files = Array.isArray(getFileIndex?.()) ? getFileIndex() : [];
  if (!files.length) return null;

  const names = files.slice(0, 500).map(f => String(f?.name || '').toLowerCase());
  const hasInvoices = names.some(name => /invoice|bill|receipt|statement/.test(name));
  if (hasInvoices) return 'Find my latest invoices';

  const hasResume = names.some(name => /resume|cv|portfolio/.test(name));
  if (hasResume) return 'Open my latest resume';

  const hasSchedule = names.some(name => /schedule|timetable|calendar|meeting/.test(name));
  if (hasSchedule) return 'What is my schedule today?';

  const hasNotes = names.some(name => /note|todo|task|plan/.test(name));
  if (hasNotes) return 'Find my todo list';

  return null;
}

export function getProactiveSuggestions(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const hour = now.getHours();
  const suggestions = [];
  const used = new Set();

  const pushUnique = (text) => {
    const value = String(text || '').trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (used.has(key)) return;
    used.add(key);
    suggestions.push(value);
  };

  const indexedFiles = Number(getIndexedFileCount()) || 0;
  if (indexedFiles <= 0) {
    pushUnique('Scan my files');
  } else if (indexedFiles < 200) {
    pushUnique('Rescan my files');
  }

  const kg = getKnowledgeGraphStats();
  if (kg.facts > 0) {
    pushUnique('What have you learned from my files?');
  }

  const learning = getLearningStatus();
  if (!learning.enabled) {
    pushUnique('Open settings');
  }

  const agendaHint = pickAgendaHint();
  if (agendaHint) pushUnique(agendaHint);

  const fileThemeHint = pickFileThemeHint();
  if (fileThemeHint) pushUnique(fileThemeHint);

  if (isMorning(hour)) {
    pushUnique('What is my schedule today?');
  }
  if (isEvening(hour)) {
    pushUnique('Set alarm for tomorrow 7 AM');
  }

  const personalized = getPersonalizedCommandSuggestions({ limit: 6 });
  for (const command of personalized) pushUnique(command);

  return suggestions.slice(0, Number.isFinite(opts.limit) ? opts.limit : 6);
}
