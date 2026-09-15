/**
 * Nice - Local Knowledge Graph
 * Stores extracted offline facts with file citations and confidence.
 */

const STORAGE_KEY = 'nice_knowledge_graph_v1';
const MAX_FACTS = 900;
const MAX_NODES = 600;

let cache = null;

function nowTs() {
  return Date.now();
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeToken(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tokenize(text) {
  return normalize(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => token.length >= 3);
}

function createEmptyGraph() {
  return {
    version: 1,
    updatedAt: 0,
    nodes: {},
    facts: [],
  };
}

function loadGraph() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      cache = { ...createEmptyGraph(), ...parsed };
      return cache;
    }
  } catch {
    // ignore
  }
  cache = createEmptyGraph();
  return cache;
}

function persist(graph) {
  graph.updatedAt = nowTs();
  cache = graph;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
  } catch {
    // best-effort
  }
}

function touchNode(graph, token, type = 'term') {
  const id = normalizeToken(token);
  if (!id) return;
  const existing = graph.nodes[id] || {
    id,
    label: token,
    type,
    count: 0,
    lastSeen: 0,
  };
  existing.count += 1;
  existing.lastSeen = nowTs();
  graph.nodes[id] = existing;
}

function trimGraph(graph) {
  const nodeEntries = Object.entries(graph.nodes);
  if (nodeEntries.length > MAX_NODES) {
    nodeEntries.sort((a, b) => (b[1]?.count || 0) - (a[1]?.count || 0) || (b[1]?.lastSeen || 0) - (a[1]?.lastSeen || 0));
    graph.nodes = Object.fromEntries(nodeEntries.slice(0, MAX_NODES));
  }
  if (graph.facts.length > MAX_FACTS) {
    graph.facts = graph.facts.slice(-MAX_FACTS);
  }
}

export function ingestSearchEvidence({ question, answer, confidence = 0, evidence = [] } = {}) {
  const graph = loadGraph();
  const cleanQuestion = normalize(question);
  if (!cleanQuestion) return;

  const qTokens = tokenize(cleanQuestion).slice(0, 8);
  for (const token of qTokens) touchNode(graph, token, 'query');

  const cleanAnswer = normalize(answer).slice(0, 420);
  for (const token of tokenize(cleanAnswer).slice(0, 10)) touchNode(graph, token, 'fact');

  const citations = Array.isArray(evidence)
    ? evidence.slice(0, 3).map(item => ({
      fileName: normalize(item?.fileName || ''),
      sentence: normalize(item?.sentence || '').slice(0, 240),
    }))
    : [];

  graph.facts.push({
    id: `${nowTs()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: nowTs(),
    question: cleanQuestion.slice(0, 220),
    answer: cleanAnswer,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0,
    citations,
    qTokens,
  });

  trimGraph(graph);
  persist(graph);
}

function scoreFactForQuestion(fact, questionTokens) {
  const tokenSet = new Set(fact.qTokens || []);
  let hits = 0;
  for (const token of questionTokens) {
    if (tokenSet.has(token)) hits += 1;
  }
  const overlap = questionTokens.length > 0 ? (hits / questionTokens.length) : 0;
  const recencyHours = (nowTs() - Number(fact.ts || 0)) / (1000 * 60 * 60);
  const recencyBoost = recencyHours < 24 ? 1 : recencyHours < 72 ? 0.7 : 0.4;
  const confidenceBoost = (Number(fact.confidence || 0) / 100);
  return (overlap * 0.55) + (recencyBoost * 0.2) + (confidenceBoost * 0.25);
}

export function queryKnowledgeGraph(question, opts = {}) {
  const limit = Number.isFinite(opts.limit) ? Math.max(1, opts.limit) : 3;
  const graph = loadGraph();
  const qTokens = tokenize(question).slice(0, 10);
  if (qTokens.length === 0) return [];

  return [...graph.facts]
    .map(fact => ({ fact, score: scoreFactForQuestion(fact, qTokens) }))
    .filter(item => item.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.fact);
}

export function getKnowledgeGraphStats() {
  const graph = loadGraph();
  return {
    nodes: Object.keys(graph.nodes || {}).length,
    facts: (graph.facts || []).length,
    updatedAt: Number(graph.updatedAt || 0),
  };
}

export function clearKnowledgeGraph() {
  cache = createEmptyGraph();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

