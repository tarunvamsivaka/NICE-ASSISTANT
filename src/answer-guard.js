/**
 * Nice - Answer Quality Guard
 * Prevents weak/off-topic responses from being presented as final answers.
 */

const BAD_SIGNAL_RE = /(could not find|couldn't find|no local results|not available|do not have access|permission missing)/i;

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractTerms(text) {
  const stop = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'for', 'of', 'and', 'or', 'in', 'on', 'at',
    'my', 'your', 'our', 'their', 'it', 'this', 'that', 'what', 'when', 'where', 'why', 'how',
    'tell', 'show', 'find', 'search', 'about', 'please', 'with', 'from', 'into', 'there',
  ]);
  return [...new Set(
    normalize(text)
      .split(' ')
      .filter(t => t.length >= 3 && !stop.has(t))
  )];
}

function overlapRatio(question, answer) {
  const qTerms = extractTerms(question);
  if (qTerms.length === 0) return 1;
  const hay = normalize(answer);
  let hits = 0;
  for (const term of qTerms) {
    if (hay.includes(term)) hits += 1;
  }
  return hits / qTerms.length;
}

function parseConfidenceFromAnswer(answer) {
  const match = String(answer || '').match(/\bconfidence\s*[:\-]?\s*(\d{1,3})\s*%/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export function evaluateAnswerQuality(question, answer, opts = {}) {
  const text = String(answer || '').trim();
  const source = String(opts.source || 'offline');
  const reasons = [];

  if (!text) {
    return { score: 0, acceptable: false, needsClarification: true, reasons: ['empty_answer'] };
  }

  if (BAD_SIGNAL_RE.test(text)) reasons.push('negative_search_signal');
  if (text.length < 40) reasons.push('too_short');

  const overlap = overlapRatio(question, text);
  if (overlap < 0.22) reasons.push('low_question_overlap');

  const inlineConfidence = parseConfidenceFromAnswer(text);
  if (inlineConfidence !== null && inlineConfidence < 45) reasons.push('low_confidence');

  let score = 100;
  if (reasons.includes('negative_search_signal')) score -= 45;
  if (reasons.includes('too_short')) score -= 15;
  if (reasons.includes('low_question_overlap')) score -= 30;
  if (reasons.includes('low_confidence')) score -= 25;

  // Slightly stricter for online responses in offline-first app policy.
  if (source.startsWith('web') && overlap < 0.35) score -= 10;

  score = Math.max(0, Math.min(100, score));
  const acceptable = score >= 55;
  return {
    score,
    acceptable,
    needsClarification: !acceptable,
    reasons,
    overlap,
    inlineConfidence,
  };
}

export function buildClarificationPrompt(question, quality) {
  const q = String(question || '').trim().slice(0, 120);
  const reasons = Array.isArray(quality?.reasons) ? quality.reasons : [];
  let hint = 'Try adding more specific keywords';
  if (reasons.includes('low_question_overlap')) hint = 'Try rephrasing with exact terms from the file';
  if (reasons.includes('negative_search_signal')) hint = 'Try scanning files again and checking file accessibility';
  if (reasons.includes('low_confidence')) hint = 'Try narrowing the question to one fact at a time';
  return `I need a quick clarification to answer "${q}" accurately. ${hint}.`;
}

