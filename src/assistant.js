/**
 * Nice Assistant Ã¢â‚¬â€ Command Parser & Response Generator
 * Full device control via real browser APIs
 * Enhanced: English word math, online/offline hybrid, polite personality
 */

import {
  setRealAlarm, cancelAllAlarms,
  setTimer, cancelTimer, getTimerStatus,
  startStopwatch, stopStopwatch, resetStopwatch,
  saveNote, getNotes, deleteAllNotes, formatNotesForDisplay,
  launchApp, createCalendarEvent, parseEventDate,
  playMusic, pauseMusic, resumeMusic, stopMusic, isMusicPlaying,
  toggleTTS, isTTSEnabled, showToast,
  getBatteryStatus, toggleFlashlight, copyToClipboard, readFromClipboard, lookupContact,
  toggleWakeLock, shareContent, toggleFullscreen,
  getCurrentDateTime, getWorldTime, vibrateDevice,
} from './actions.js';
import {
  grantFolderAccess, searchFiles, openFile,
  getStorageStats, isFileSystemAvailable, getIndexedFileCount,
  getReadableFiles,
  findExactFileByName,
  findFileById,
} from './filesys.js';
import { searchForAnswer, getSearchStatus, hasSearchableFiles, warmupSearchKnowledge, searchImages } from './search-engine.js';
import { isOnline, searchWeb, getWeather } from './online.js';
import {
  isOnlineAllowed,
  optInToOnline,
  optOutOfOnline,
  offlineBlockedMessage,
  isOnlineSessionOptedIn,
  isOfflineHardLocked,
} from './policy.js';
import { applyUsageIntentHint, getLearningStatus } from './usage-learning.js';
import { inferOfflineIntent } from './offline-brain.js';
import { evaluateAnswerQuality, buildClarificationPrompt } from './answer-guard.js';
import { queryKnowledgeGraph, getKnowledgeGraphStats } from './knowledge-graph.js';
import { buildSafeActionPlan, formatBlockedPlanSteps } from './action-planner.js';
import { installPlugin, listPlugins, runPlugin, removePlugin } from './plugin-manager.js';
import { buildConversationalReply } from './conversation-responder.js';
import {
  createAutomationRule,
  removeAutomationRule,
  listAutomationRules,
  matchAutomationRule,
} from './automation-engine.js';
import { getRuntimePerformanceProfile } from './performance-governor.js';
import {
  generateLocalLlmAnswer,
  initLocalLlmWorker,
} from './local-llm-client.js';

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
  plus: '+', add: '+', added: '+', 'added to': '+',
  minus: '-', subtract: '-', subtracted: '-', 'take away': '-',
  times: '*', multiply: '*', 'multiplied by': '*',
  'divided by': '/', divide: '/',
  'to the power of': '**', 'power': '**', 'raised to': '**',
  mod: '%', modulo: '%', remainder: '%',
  percent: '%', percentage: '%',
};

/**
 * Convert English word math to numeric expression
 * e.g. "five plus three" → "5 + 3", "twenty times four" → "20 * 4"
 */
function parseWordMath(text) {
  let expr = text.toLowerCase().trim();
  // Remove leading question words
  expr = expr.replace(/^(?:what\s+is|calculate|compute|solve|how\s+much\s+is|eval)\s+/i, '');
  expr = expr.replace(/\?$/, '').trim();

  // Handle "square root of X"
  expr = expr.replace(/square\s+root\s+of\s+(\S+)/gi, (_, n) => {
    const num = WORD_NUMS[n] !== undefined ? WORD_NUMS[n] : n;
    return `Math.sqrt(${num})`;
  });
  // Handle "X squared" / "X cubed"
  expr = expr.replace(/(\S+)\s+squared/gi, (_, n) => {
    const num = WORD_NUMS[n] !== undefined ? WORD_NUMS[n] : n;
    return `(${num})**2`;
  });
  expr = expr.replace(/(\S+)\s+cubed/gi, (_, n) => {
    const num = WORD_NUMS[n] !== undefined ? WORD_NUMS[n] : n;
    return `(${num})**3`;
  });

  // Replace multi-word operators first ("divided by", "multiplied by", etc.)
  for (const [phrase, op] of Object.entries(WORD_OPERATORS)) {
    if (phrase.includes(' ')) {
      const regex = new RegExp(phrase.replace(/\s+/g, '\\s+'), 'gi');
      expr = expr.replace(regex, ` ${op} `);
    }
  }
  // Replace single-word operators
  const tokens = expr.split(/\s+/);
  const result = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (WORD_OPERATORS[t] && !t.includes(' ')) {
      result.push(WORD_OPERATORS[t]);
    } else if (WORD_NUMS[t] !== undefined) {
      // Handle compound numbers like "twenty three" → 23
      let num = WORD_NUMS[t];
      // Look ahead for compound (e.g. "twenty three" → 23)
      if (num >= 20 && num <= 90 && i + 1 < tokens.length && WORD_NUMS[tokens[i + 1]] !== undefined && WORD_NUMS[tokens[i + 1]] < 10) {
        num += WORD_NUMS[tokens[i + 1]];
        i++;
      }
      // Look ahead for multipliers (e.g. "five hundred" → 500)
      if (i + 1 < tokens.length && WORD_MULTIPLIERS[tokens[i + 1]]) {
        num *= WORD_MULTIPLIERS[tokens[i + 1]];
        i++;
        // After multiplier, check for addition (e.g. "five hundred twenty" → 520)
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

/** Check if text contains word-based math */
function isWordMath(text) {
  const lower = text.toLowerCase()
    .replace(/^(?:what\s+is|calculate|compute|solve|how\s+much\s+is|eval)\s+/i, '')
    .replace(/\?$/, '').trim();

  // Check: word-number + word-operator ("five plus three")
  const hasWordNumbers = Object.keys(WORD_NUMS).some(w => {
    const regex = new RegExp(`\\b${w}\\b`);
    return regex.test(lower);
  });
  const hasOps = Object.keys(WORD_OPERATORS).some(w => {
    const regex = new RegExp(`\\b${w.replace(/\s+/g, '\\s+')}\\b`);
    return regex.test(lower);
  });

  // Original: both word numbers and word operators
  if (hasWordNumbers && hasOps) return true;

  // NEW: mixed digit + word operator ("8 plus 9", "10 times 5", "100 divided by 4")
  if (hasOps && /\d/.test(lower)) return true;

  return false;
}

export const INTENTS = {
  LAUNCH_APP: 'LAUNCH_APP',
  SET_ALARM: 'SET_ALARM',
  CANCEL_ALARM: 'CANCEL_ALARM',
  SET_TIMER: 'SET_TIMER',
  CANCEL_TIMER: 'CANCEL_TIMER',
  TIMER_STATUS: 'TIMER_STATUS',
  STOPWATCH: 'STOPWATCH',
  CALENDAR: 'CALENDAR',
  MEDIA: 'MEDIA',
  NOTE: 'NOTE',
  LIST_NOTES: 'LIST_NOTES',
  DELETE_NOTES: 'DELETE_NOTES',
  MUTE_TOGGLE: 'MUTE_TOGGLE',
  CALCULATE: 'CALCULATE',
  CONVERT: 'CONVERT',
  FILE_SEARCH: 'FILE_SEARCH',
  SCAN_FILES: 'SCAN_FILES',
  OPEN_FILE: 'OPEN_FILE',
  STORAGE_STATS: 'STORAGE_STATS',
  BUILD_KNOWLEDGE: 'BUILD_KNOWLEDGE',
  ASK_KNOWLEDGE: 'ASK_KNOWLEDGE',
  NEXT_CLASS: 'NEXT_CLASS',
  TODAY_SCHEDULE: 'TODAY_SCHEDULE',
  KNOWLEDGE_STATUS: 'KNOWLEDGE_STATUS',
  BATTERY: 'BATTERY',
  FLASHLIGHT: 'FLASHLIGHT',
  CLIPBOARD: 'CLIPBOARD',
  CLIPBOARD_READ: 'CLIPBOARD_READ',
  CONTACT_LOOKUP: 'CONTACT_LOOKUP',
  WAKE_LOCK: 'WAKE_LOCK',
  SHARE: 'SHARE',
  FULLSCREEN: 'FULLSCREEN',
  TIME_QUERY: 'TIME_QUERY',
  WORLD_CLOCK: 'WORLD_CLOCK',
  VIBRATE: 'VIBRATE',
  WEATHER: 'WEATHER',
  GO_ONLINE: 'GO_ONLINE',
  GO_OFFLINE: 'GO_OFFLINE',
  INTERNET_SEARCH: 'INTERNET_SEARCH',
  OPEN_TARGET: 'OPEN_TARGET',
  OPEN_TARGET_CLARIFY: 'OPEN_TARGET_CLARIFY',
  MULTIMODAL_CAPTURE: 'MULTIMODAL_CAPTURE',
  AUTOMATION_CREATE: 'AUTOMATION_CREATE',
  AUTOMATION_LIST: 'AUTOMATION_LIST',
  AUTOMATION_DELETE: 'AUTOMATION_DELETE',
  AUTOMATION_RUN: 'AUTOMATION_RUN',
  VISION: 'VISION',
  PLUGIN: 'PLUGIN',
  CONVERSATIONAL: 'CONVERSATIONAL',
  GREETING: 'GREETING',
  HELP: 'HELP',
  BRAIN_PLAN: 'BRAIN_PLAN',
  UNKNOWN: 'UNKNOWN',
};

// Context tracker for follow-up commands
let lastContext = {
  intent: null,
  entity: null,
  timestamp: 0,
};

let pendingOpenChoice = null;

function isPendingOpenChoiceFresh() {
  return !!pendingOpenChoice && (Date.now() - pendingOpenChoice.timestamp) < 120000;
}

function clearPendingOpenChoice() {
  pendingOpenChoice = null;
}

/**
 * Parse user input into a structured intent
 */
function buildIntentFromBrainInference(inference, rawInput) {
  if (!inference || !inference.intent) return null;
  const base = {
    intent: inference.intent,
    raw: rawInput,
    brain_inferred: true,
    brain_confidence: inference.confidence,
    brain_reason: inference.reason,
  };

  if (inference.intent === INTENTS.LAUNCH_APP && inference.entity) {
    return { ...base, app: inference.entity };
  }
  if (inference.intent === INTENTS.OPEN_FILE && inference.entity) {
    return { ...base, file: inference.entity };
  }

  return base;
}

function looksLikeFileReference(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/[\\/]/.test(raw)) return true;
  if (/\.[a-z0-9]{1,7}$/i.test(raw)) return true;
  return /\b(pdf|docx?|xlsx?|pptx?|txt|md|json|csv|jpg|jpeg|png|webp|bmp|heic|heif|tif|tiff)\b/i.test(raw);
}

function shouldSearchKnowledgeByDefault(rawInput) {
  const text = String(rawInput || '').trim().toLowerCase();
  if (!text) return false;
  if (looksLikeFileReference(text)) return true;

  if (/(?:\b(?:find|search|look\s+for|locate|where\s+is|open)\b.*\b(?:file|files|document|documents|pdf|content|folder|storage)\b)/i.test(text)) {
    return true;
  }

  if (/(?:\b(?:in|from)\s+my\s+(?:files|documents|storage)\b|\bopen\s+file\b|\bscan\s+my\s+files\b)/i.test(text)) {
    return true;
  }

  if (/^(?:what|who|where|when|why|how)\b/.test(text) && /\bmy\b/.test(text)) {
    return true;
  }

  if (/\b(?:resume|invoice|certificate|report|statement|id\s*card|aadhaar|passport|marksheet|phone\s*number|email|dob|birthday|age)\b/i.test(text)) {
    return true;
  }

  if (/\bhow\s+many\b.*\b(?:files|documents|photos|images|pdfs)\b/i.test(text)) {
    return true;
  }

  return false;
}

function isCasualChatMessage(rawInput) {
  const text = String(rawInput || '').trim().toLowerCase();
  if (!text) return false;
  if (shouldSearchKnowledgeByDefault(text)) return false;

  if (/^(?:chat|let'?s\s+chat|can\s+we\s+chat|talk\s+to\s+me|just\s+talk|small\s+talk)\b/i.test(text)) return true;
  if (/^(?:tell\s+me\s+about|let'?s\s+talk\s+about|can\s+you\s+explain|what\s+do\s+you\s+think\s+about)\b/i.test(text)) return true;
  if (/\b(?:joke|story|poem|quote|motivate|motivation|advice|tip|fun\s+fact|riddle)\b/i.test(text)) return true;
  if (/\b(?:i\s+am|i'?m|i\s+feel|feeling|bored|lonely|sad|happy|stressed|anxious|excited)\b/i.test(text)) return true;
  if (/^(?:what|who|where|when|why|how)\b/.test(text) && !/\b(?:file|files|document|documents|storage|pdf|folder)\b/.test(text)) return true;

  return false;
}

function looksLikeGeneralKnowledgeQuestion(rawInput) {
  const text = String(rawInput || '').trim().toLowerCase();
  if (!text) return false;
  if (shouldSearchKnowledgeByDefault(text)) return false;

  const questionLead = /^(?:what|who|where|when|why|how|which|explain|define|tell\s+me\s+about)\b/.test(text);
  if (!questionLead) return false;

  // Keep command-like requests on deterministic intent routes.
  if (/\b(?:weather|temperature|forecast|time|date|day|alarm|timer|stopwatch|battery|flashlight|open|launch|play|scan|file|files|document|documents|storage)\b/.test(text)) {
    return false;
  }

  // Keep social prompts on conversational responses.
  if (/(?:how\s+are\s+you|who\s+are\s+you|your\s+name|tell\s+me\s+a\s+joke|joke|story|poem|quote)\b/.test(text)) {
    return false;
  }

  return true;
}

export function parseCommand(input, opts = {}) {
  const rawInput = String(input || '').trim();
  const text = rawInput.toLowerCase();
  const allowBrainPlan = opts?.allowBrainPlan !== false;
  const fromAutomation = opts?.fromAutomation === true;

  if (!text) {
    return { intent: INTENTS.UNKNOWN, raw: rawInput };
  }

  if (isPendingOpenChoiceFresh()) {
    const chooseApp = /^(?:app|application|open\s+app|launch\s+app|first|1|the\s+app)$/i.test(text);
    const chooseFile = /^(?:file|document|open\s+file|second|2|the\s+file)$/i.test(text);
    if (chooseApp) {
      const selected = pendingOpenChoice;
      clearPendingOpenChoice();
      lastContext = { intent: INTENTS.LAUNCH_APP, entity: selected.appName, timestamp: Date.now() };
      return { intent: INTENTS.LAUNCH_APP, app: selected.appName, raw: rawInput, disambiguated: true };
    }
    if (chooseFile) {
      const selected = pendingOpenChoice;
      clearPendingOpenChoice();
      lastContext = { intent: INTENTS.OPEN_FILE, entity: selected.fileName, timestamp: Date.now() };
      return {
        intent: INTENTS.OPEN_FILE,
        file: selected.fileName,
        fileId: selected.fileId,
        raw: rawInput,
        disambiguated: true,
      };
    }
  }

  const createAutomationMatch = rawInput.match(/^(?:when|if)\s+i\s+say\s+["']?(.+?)["']?\s+(?:do|then)\s+(.+)$/i);
  if (createAutomationMatch) {
    return {
      intent: INTENTS.AUTOMATION_CREATE,
      trigger: createAutomationMatch[1].trim(),
      action: createAutomationMatch[2].trim(),
      raw: rawInput,
    };
  }

  const deleteAutomationMatch = rawInput.match(/^(?:remove|delete)\s+automation\s+(.+)$/i);
  if (deleteAutomationMatch) {
    return {
      intent: INTENTS.AUTOMATION_DELETE,
      target: deleteAutomationMatch[1].trim(),
      raw: rawInput,
    };
  }

  if (/^(?:list|show)\s+automations?$/i.test(text)) {
    return { intent: INTENTS.AUTOMATION_LIST, raw: rawInput };
  }

  if (!fromAutomation) {
    const matchedAutomation = matchAutomationRule(rawInput);
    if (matchedAutomation) {
      return {
        intent: INTENTS.AUTOMATION_RUN,
        trigger: matchedAutomation.trigger,
        actionCommand: matchedAutomation.action,
        ruleId: matchedAutomation.id,
        raw: rawInput,
      };
    }
  }

  if (allowBrainPlan) {
    const safePlan = buildSafeActionPlan(
      rawInput,
      (step) => parseCommand(step, { allowBrainPlan: false }),
    );

    if (safePlan.safe && safePlan.steps.length > 1) {
      return {
        intent: INTENTS.BRAIN_PLAN,
        steps: safePlan.steps,
        blockedSteps: safePlan.blocked,
        plannerWarnings: safePlan.warnings,
        reasoning: safePlan.reasoning,
        raw: rawInput,
      };
    }
  }

  if (/^(?:scan|analy[sz]e|read|extract)\s+(?:an?\s+)?(?:image|photo|screenshot|document)\b/i.test(text)
    || /^(?:camera\s+ocr|ocr\s+camera|analy[sz]e\s+screenshot)$/i.test(text)) {
    return { intent: INTENTS.MULTIMODAL_CAPTURE, raw: rawInput };
  }

  // Greeting (expanded)
  if (/^(hi|hello|hey|good\s*(morning|afternoon|evening|night)|what'?s?\s*up|howdy|yo|sup|greetings|namaste|hola)/i.test(text)) {
    return { intent: INTENTS.GREETING, raw: input };
  }

  // Help
  if (/^(help|what can you do|commands|capabilities|features|options|menu)$/i.test(text)) {
    return { intent: INTENTS.HELP, raw: input };
  }

  // === CONVERSATIONAL ENGLISH PATTERNS ===
  // Thanks / Gratitude
  if (/^(?:thanks?|thank\s+you|thx|ty|appreciate|grateful|you'?re?\s+(?:the\s+)?(?:best|awesome|great|amazing))/i.test(text)) {
    return { intent: INTENTS.CONVERSATIONAL, subtype: 'thanks', raw: input };
  }
  // How are you / Feelings about Nice
  if (/^(?:how\s+are\s+you|how'?s?\s+it\s+going|how\s+do\s+you\s+feel|are\s+you\s+(?:ok|okay|fine|good|happy)|you\s+(?:ok|okay|good))/i.test(text)) {
    return { intent: INTENTS.CONVERSATIONAL, subtype: 'howareyou', raw: input };
  }
  // Identity questions
  if (/(?:who\s+(?:are\s+you|made\s+you|created\s+you|built\s+you)|who\s+is\s+the\s+owner\s+of\s+nice\s+assistant|who\s+owns\s+nice\s+assistant|owner\s+of\s+nice\s+assistant|what(?:'?s|\s+is)\s+your\s+name|your\s+name|what\s+are\s+you|tell\s+me\s+about\s+you)/i.test(text)) {
    return { intent: INTENTS.CONVERSATIONAL, subtype: 'identity', raw: input };
  }
  // User feelings
  if (/^(?:i(?:'?m|\s+am|\s+feel)\s+(?:sad|happy|tired|bored|lonely|angry|stressed|anxious|excited|great|good|fine|okay|sick|unwell|not\s+(?:feeling|doing)\s+(?:well|good)))/i.test(text)) {
    const mood = text.match(/(?:sad|happy|tired|bored|lonely|angry|stressed|anxious|excited|great|good|fine|okay|sick|unwell|not\s+(?:feeling|doing)\s+(?:well|good))/i);
    return { intent: INTENTS.CONVERSATIONAL, subtype: 'feeling', mood: mood ? mood[0].toLowerCase() : 'unknown', raw: input };
  }
  // Goodbye
  if (/^(?:bye|goodbye|good\s*bye|see\s+you|later|good\s*night|take\s+care|cya|ttyl)/i.test(text)) {
    return { intent: INTENTS.CONVERSATIONAL, subtype: 'goodbye', raw: input };
  }
  // Jokes
  if (/(?:tell\s+me\s+a\s+joke|joke|make\s+me\s+laugh|something\s+funny|funny)/i.test(text)) {
    return { intent: INTENTS.CONVERSATIONAL, subtype: 'joke', raw: input };
  }
  // Compliments
  if (/(?:you(?:'?re| are)\s+(?:smart|clever|amazing|wonderful|great|cool|nice|awesome|brilliant|fantastic|helpful|the best)|i\s+(?:love|like)\s+you|good\s+(?:job|work))/i.test(text)) {
    return { intent: INTENTS.CONVERSATIONAL, subtype: 'compliment', raw: input };
  }
  // Yes/No/Ok acknowledgments
  if (/^(?:ok(?:ay)?|alright|sure|yep|yup|nope|no|nah|got\s+it|understood|cool|nice|great|awesome|perfect|right)$/i.test(text)) {
    return { intent: INTENTS.CONVERSATIONAL, subtype: 'acknowledge', raw: input };
  }
  // Age
  if (/(?:how\s+old\s+are\s+you|your\s+age|when\s+were\s+you\s+(?:born|created|made))/i.test(text)) {
    return { intent: INTENTS.CONVERSATIONAL, subtype: 'age', raw: input };
  }
  // Meaning of life / Philosophy
  if (/(?:meaning\s+of\s+life|purpose\s+of\s+life|why\s+(?:do\s+we|are\s+we)\s+(?:exist|here|live))/i.test(text)) {
    return { intent: INTENTS.CONVERSATIONAL, subtype: 'philosophy', raw: input };
  }

  // Follow-up: "open it", "do it", "yes" Ã¢â‚¬â€ must check BEFORE launch to avoid capturing "open it" as launch
  // Context expires after 2 minutes to prevent stale follow-ups
  const contextFresh = lastContext.entity && (Date.now() - lastContext.timestamp) < 120000;
  if (/^(?:and|also|what\s+about|how\s+about)\b/i.test(text) && contextFresh) {
    if (lastContext.intent === INTENTS.ASK_KNOWLEDGE || lastContext.intent === INTENTS.FILE_SEARCH || lastContext.intent === INTENTS.INTERNET_SEARCH) {
      const followupPart = rawInput.replace(/^(?:and|also|what\s+about|how\s+about)\s*/i, '').trim();
      const prior = String(lastContext.entity || '').trim();
      const mergedQuestion = [prior, followupPart || rawInput].filter(Boolean).join('; ');
      lastContext = { intent: INTENTS.ASK_KNOWLEDGE, entity: mergedQuestion, timestamp: Date.now() };
      clearPendingOpenChoice();
      return { intent: INTENTS.ASK_KNOWLEDGE, question: mergedQuestion, raw: rawInput, followUp: true };
    }
    if (lastContext.intent === INTENTS.WEATHER) {
      lastContext = { intent: INTENTS.WEATHER, entity: rawInput, timestamp: Date.now() };
      clearPendingOpenChoice();
      return { intent: INTENTS.WEATHER, raw: rawInput, followUp: true };
    }
  }
  if (/^(open\s+it|do\s+it|yes|go\s+ahead|confirm)$/i.test(text) && contextFresh) {
    if (lastContext.intent === INTENTS.FILE_SEARCH) {
      clearPendingOpenChoice();
      return { intent: INTENTS.OPEN_FILE, file: lastContext.entity, raw: rawInput, followUp: true };
    }
    if (lastContext.intent === INTENTS.OPEN_FILE) {
      clearPendingOpenChoice();
      return { intent: INTENTS.OPEN_FILE, file: lastContext.entity, raw: rawInput, followUp: true };
    }
    clearPendingOpenChoice();
    return { intent: lastContext.intent, entity: lastContext.entity, raw: rawInput, followUp: true };
  }
  // Pure parser rule: treat file-like standalone input as OPEN_FILE without hitting storage APIs.
  if (!/^(?:open|launch|start|run)\b/i.test(text) && looksLikeFileReference(rawInput)) {
    clearPendingOpenChoice();
    lastContext = { intent: INTENTS.OPEN_FILE, entity: rawInput, timestamp: Date.now() };
    return {
      intent: INTENTS.OPEN_FILE,
      file: rawInput,
      raw: rawInput,
      fileLikeDirectInput: true,
    };
  }

  // ===== APP ALIAS DICTIONARY (for offline app launching) =====
  const APP_ALIASES = {
    'gmail': 'Gmail', 'email': 'Gmail', 'mail': 'Gmail',
    'whatsapp': 'WhatsApp', 'wa': 'WhatsApp',
    'instagram': 'Instagram', 'insta': 'Instagram', 'ig': 'Instagram',
    'youtube': 'YouTube', 'yt': 'YouTube',
    'chrome': 'Chrome', 'browser': 'Chrome',
    'maps': 'Google Maps', 'google maps': 'Google Maps', 'navigation': 'Google Maps',
    'settings': 'Settings', 'setting': 'Settings',
    'camera': 'Camera', 'cam': 'Camera',
    'photos': 'Google Photos', 'gallery': 'Gallery',
    'clock': 'Clock', 'alarm': 'Clock', 'alarms': 'Clock',
    'calculator': 'Calculator', 'calc': 'Calculator',
    'calendar': 'Google Calendar',
    'spotify': 'Spotify', 'music': 'Music',
    'twitter': 'Twitter', 'x': 'Twitter',
    'facebook': 'Facebook', 'fb': 'Facebook',
    'telegram': 'Telegram', 'tg': 'Telegram',
    'discord': 'Discord',
    'snapchat': 'Snapchat', 'snap': 'Snapchat',
    'netflix': 'Netflix',
    'amazon': 'Amazon',
    'linkedin': 'LinkedIn',
    'pinterest': 'Pinterest',
    'zoom': 'Zoom',
    'tiktok': 'TikTok',
    'reddit': 'Reddit',
    'notes': 'Google Keep', 'keep': 'Google Keep',
    'translate': 'Google Translate',
    'drive': 'Google Drive', 'docs': 'Google Docs',
    'messages': 'Messages', 'sms': 'Messages', 'text': 'Messages',
    'phone': 'Phone', 'dialer': 'Phone', 'call': 'Phone',
    'contacts': 'Contacts',
    'files': 'Files', 'file manager': 'Files',
    'play store': 'Play Store', 'store': 'Play Store',
  };

  // Explicit "open ..." router:
  // 1) plain app aliases -> launch app
  // 2) explicit/obvious file targets -> open file
  const openTargetMatch = rawInput.match(/^open\s+(.+)/i);
  if (openTargetMatch) {
    const rawTarget = openTargetMatch[1].trim();
    const explicitAppTarget = /^app(?:lication)?\s+/i.test(rawTarget);
    const explicitFileTarget = /^file\s+/i.test(rawTarget)
      || /\b(file|document|pdf|image|photo|folder)\b/i.test(rawTarget);
    const requestedName = rawTarget
      .replace(/^(?:the|my|a)\s+/i, '')
      .replace(/^app(?:lication)?\s+/i, '')
      .replace(/^file\s+/i, '')
      .trim();

    if (requestedName) {
      const requestedLower = requestedName.toLowerCase().replace(/\s+(?:app|application)$/i, '');
      const appAliasMatch = APP_ALIASES[requestedLower] || null;
      const fileLikeTarget = looksLikeFileReference(requestedName);

      if (explicitFileTarget || fileLikeTarget) {
        clearPendingOpenChoice();
        lastContext = { intent: INTENTS.OPEN_FILE, entity: requestedName, timestamp: Date.now() };
        return {
          intent: INTENTS.OPEN_FILE,
          file: requestedName,
          raw: rawInput,
          explicitFileTarget: true,
          fileLikeTarget,
        };
      }

      clearPendingOpenChoice();
      lastContext = { intent: INTENTS.OPEN_TARGET, entity: requestedName, timestamp: Date.now() };
      return {
        intent: INTENTS.OPEN_TARGET,
        target: requestedName,
        appAlias: appAliasMatch,
        explicitAppTarget,
        explicitFileTarget: false,
        fileLikeTarget: false,
        raw: rawInput,
      };
    }
  }

  // Launch App (but not media commands like 'play' or 'queue')
  const launchMatch = text.match(/(?:open|launch|start|run)\s+(.+)/i);
  if (launchMatch && !/^(?:play|queue)\s/i.test(text) && !/^open\s+file\s+/i.test(text)) {
    let appName = launchMatch[1].trim();
    // Remove common filler words
    appName = appName.replace(/^(?:the|my|a)\s+/i, '').replace(/\s+(?:app|application)$/i, '');
    if (looksLikeFileReference(appName)) {
      return { intent: INTENTS.OPEN_FILE, file: appName, raw: input };
    }
    // Look up alias or title-case the input
    const resolved = APP_ALIASES[appName.toLowerCase()] || appName.replace(/\b\w/g, c => c.toUpperCase());
    lastContext = { intent: INTENTS.LAUNCH_APP, entity: resolved, timestamp: Date.now() };
    return { intent: INTENTS.LAUNCH_APP, app: resolved, raw: input };
  }

  // Cancel Alarm
  if (/^(?:cancel|clear|stop|delete)\s*(?:all\s+)?alarms?$/i.test(text)) {
    return { intent: INTENTS.CANCEL_ALARM, raw: input };
  }

  // Set Alarm
  const alarmMatch = text.match(/(?:set|create)\s+(?:an?\s+)?alarm\s+(?:for|at)\s+(.+)/i)
    || text.match(/(?:wake\s+me\s+up)\s+(?:at|by)\s+(.+)/i);
  if (alarmMatch) {
    const time = alarmMatch[1].replace(/\b\w/g, c => c.toUpperCase());
    lastContext = { intent: INTENTS.SET_ALARM, entity: time, timestamp: Date.now() };
    return { intent: INTENTS.SET_ALARM, time, raw: input };
  }

  // Timer
  if (/^(?:cancel|stop|clear)\s*timer$/i.test(text)) {
    return { intent: INTENTS.CANCEL_TIMER, raw: input };
  }
  if (/^(?:timer|how\s+much\s+time)\s*(?:left|remaining|status)?$/i.test(text)) {
    return { intent: INTENTS.TIMER_STATUS, raw: input };
  }
  const timerMatch = text.match(/(?:set\s+)?(?:a\s+)?timer\s+(?:for\s+)?(.+)/i)
    || text.match(/(?:countdown)\s+(.+)/i);
  if (timerMatch) {
    return { intent: INTENTS.SET_TIMER, duration: timerMatch[1].trim(), raw: input };
  }

  // Stopwatch
  if (/^(?:start|begin)\s*(?:a\s+)?stopwatch$/i.test(text)) {
    return { intent: INTENTS.STOPWATCH, action: 'start', raw: input };
  }
  if (/^(?:stop|pause|end)\s*(?:the\s+)?stopwatch$/i.test(text)) {
    return { intent: INTENTS.STOPWATCH, action: 'stop', raw: input };
  }
  if (/^(?:reset|clear)\s*(?:the\s+)?stopwatch$/i.test(text)) {
    return { intent: INTENTS.STOPWATCH, action: 'reset', raw: input };
  }

  // Calendar / Schedule
  const calMatch = text.match(/(?:schedule|add|create|set)\s+(?:a\s+)?(?:meeting|event|appointment|reminder)?\s*(.+?)(?:\s+(?:on|for|at|tomorrow|today|next)\s+(.+))?$/i)
    || text.match(/(?:remember|remind\s+me)\s+(?:to\s+)?(.+?)(?:\s+(?:on|for|at|tomorrow|today|next)\s+(.+))?$/i)
    || text.match(/(?:add\s+to\s+calendar|calendar\s+event|calendar)\s+(.+?)(?:\s+(?:on|for|at|tomorrow|today|next)\s+(.+))?$/i);
  if (calMatch && (text.includes('schedule') || text.includes('meeting') || text.includes('calendar') || text.includes('event') || text.includes('appointment') || text.includes('tomorrow') || text.includes('remind'))) {
    let event = calMatch[1].replace(/^(?:meeting|event|appointment|reminder|to)\s+/i, '').trim();
    event = event.replace(/\b\w/g, c => c.toUpperCase()).trim() || 'New Event';
    const when = calMatch[2] ? calMatch[2].trim() : (text.includes('tomorrow') ? 'Tomorrow at 9am' : 'Today');
    const eventDate = parseEventDate(when);
    const startTime = eventDate.getTime();
    const endTime = startTime + 3600000;
    lastContext = { intent: INTENTS.CALENDAR, entity: event, timestamp: Date.now() };
    return {
      intent: INTENTS.CALENDAR,
      event,
      title: event,
      when,
      startTime,
      endTime,
      raw: input,
    };
  }

  // Media
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

  // Note management
  if (/^(?:show|list|view|read|my)\s*(?:all\s+)?notes?$/i.test(text)) {
    return { intent: INTENTS.LIST_NOTES, raw: input };
  }
  if (/^(?:delete|clear|remove|erase)\s*(?:all\s+)?notes?$/i.test(text)) {
    return { intent: INTENTS.DELETE_NOTES, raw: input };
  }

  // Vision / object detection (stub for roadmap)
  if (/\b(vision|object\s+detect|detect\s+objects|what's\s+in\s+this\s+image)\b/i.test(text)) {
    return { intent: INTENTS.VISION, raw: input };
  }

  // Plugin system (stub)
  if (/\b(plugin|extension|skill\s+install|add\s+skill|add\s+plugin)\b/i.test(text)) {
    return { intent: INTENTS.PLUGIN, raw: input };
  }

  // Mute/Unmute TTS
  if (/^(?:mute|unmute|toggle\s*(?:voice|tts|sound|speech)|shut\s+up|be\s+quiet|speak|voice\s*(?:on|off))$/i.test(text)) {
    return { intent: INTENTS.MUTE_TOGGLE, raw: input };
  }

  // Contact Lookup (Milestone 2)
  const contactMatch = text.match(/^(?:find|lookup|look\s+up|search(?:\s+for)?)\s+contacts?\s*(?:for\s+)?(.+)/i)
    || text.match(/^(?:phone\s*(?:number)?|mobile(?:\s*number)?|contact(?:\s+info|\s+details)?)\s+(?:of|for)\s+(.+)/i)
    || text.match(/^contact\s+([a-z0-9\s._'-]+?)[!?.]*$/i)
    || text.match(/^(?:who\s+is|who's)\s+([a-z0-9\s._'-]+?)[!?.]*$/i);
  if (contactMatch) {
    const rawTarget = contactMatch[1].replace(/[?!.]+$/, '').trim();
    const cleanName = rawTarget.replace(/^(?:the|my|a)\s+/i, '').trim();
    const lowerClean = cleanName.toLowerCase();
    if (cleanName && lowerClean !== 'us' && lowerClean !== 'support' && lowerClean !== 'contacts') {
      lastContext = { intent: INTENTS.CONTACT_LOOKUP, entity: cleanName, timestamp: Date.now() };
      return {
        intent: INTENTS.CONTACT_LOOKUP,
        name: cleanName,
        query: cleanName,
        raw: input,
      };
    }
  }

  // Battery
  if (/^(?:battery|battery\s*(?:level|status|life|percent|charge)|how\s+much\s+battery|charge\s*(?:level|status)?|what(?:'s|\s+is)\s+(?:my\s+)?battery(?:\s+level|\s+status|\s+percent|\s+life)?)[!?.]*$/i.test(text) || /\b(?:battery\s*(?:level|status|life|percent|charge)|charge\s+status)\b/i.test(text)) {
    return { intent: INTENTS.BATTERY, raw: input };
  }

  // Flashlight
  if (/^(?:flashlight|torch|flash\s*light)\s*(?:on|off)?$/i.test(text) || /^(?:turn\s+(?:on|off)\s+(?:the\s+)?(?:flashlight|torch))$/i.test(text)) {
    return { intent: INTENTS.FLASHLIGHT, raw: input };
  }

  // Clipboard Read (Milestone 2)
  if (/^(?:read\s+(?:the\s+)?clipboard|what(?:'s|\s+is)\s+(?:on\s+)?(?:my\s+)?clipboard|paste\s+(?:from\s+)?(?:the\s+)?clipboard|paste(?:\s+clipboard)?|show\s+(?:the\s+)?clipboard|view\s+(?:the\s+)?clipboard|get\s+clipboard|clipboard\s+content)[!?.]*$/i.test(text) || text.replace(/[!?.]*$/, '') === 'clipboard') {
    return { intent: INTENTS.CLIPBOARD_READ, raw: input };
  }

  // Clipboard / Copy
  const copyMatch = text.match(/^(?:copy(?:\s+to\s+clipboard)?|clipboard)\s+(.+)/i);
  if (copyMatch) {
    return { intent: INTENTS.CLIPBOARD, text: copyMatch[1].trim(), raw: input };
  }

  // Wake Lock / Screen
  if (/^(?:keep\s+screen\s+on|screen\s+on|stay\s+awake|don'?t?\s+sleep|screen\s+off|screen\s+lock)$/i.test(text)) {
    return { intent: INTENTS.WAKE_LOCK, raw: input };
  }

  // Share
  const shareMatch = text.match(/^share\s+(.+)/i);
  if (shareMatch) {
    return { intent: INTENTS.SHARE, text: shareMatch[1].trim(), raw: input };
  }

  // Fullscreen
  if (/^(?:fullscreen|full\s+screen|exit\s+fullscreen)$/i.test(text)) {
    return { intent: INTENTS.FULLSCREEN, raw: input };
  }

  // Vibrate
  if (/^(?:vibrate|buzz|haptic)$/i.test(text)) {
    return { intent: INTENTS.VIBRATE, raw: input };
  }

  // World Clock
  const worldMatch = text.match(/^(?:what(?:'?s)?\s+(?:the\s+)?time\s+in|time\s+in|clock\s+in)\s+(.+)/i);
  if (worldMatch) {
    return { intent: INTENTS.WORLD_CLOCK, city: worldMatch[1].trim(), raw: input };
  }

  // Date & Time query Ã¢â‚¬â€ catches bare "time", "date", "day", "clock"
  if (/^(?:what(?:'?s?)?\s+(?:the\s+)?(?:time|date|day)|current\s+(?:time|date)|today(?:'?s?)?\s*(?:date)?|what\s+day\s+is\s+(?:it|today)|^time$|^date$|^day$|^clock$|^what\s+time$|tell\s+(?:me\s+)?(?:the\s+)?(?:time|date)|show\s+(?:me\s+)?(?:the\s+)?(?:time|date))/i.test(text)) {
    return { intent: INTENTS.TIME_QUERY, raw: input };
  }

  // Weather query
  if (/(?:weather|temperature|forecast|how\s+(?:hot|cold|warm)\s+is\s+it|is\s+it\s+(?:raining|sunny|cloudy))/i.test(text)) {
    clearPendingOpenChoice();
    lastContext = { intent: INTENTS.WEATHER, entity: rawInput, timestamp: Date.now() };
    return { intent: INTENTS.WEATHER, raw: input };
  }

  // Session-level online mode toggles
  if (/^(?:go|switch)\s+online$/i.test(text)
    || /^(?:enable|turn\s+on|allow)\s+(?:online|internet|web)(?:\s+mode)?$/i.test(text)) {
    return { intent: INTENTS.GO_ONLINE, raw: input };
  }
  if (/^(?:go|switch)\s+offline$/i.test(text)
    || /^(?:disable|turn\s+off|block|stop)\s+(?:online|internet|web)(?:\s+mode)?$/i.test(text)) {
    return { intent: INTENTS.GO_OFFLINE, raw: input };
  }

  // Note
  const noteMatch = text.match(/(?:note|write\s+down|jot\s+down|add\s+note|take\s+a\s+note)[:\s]+(.+)/i)
    || text.match(/(?:note|write|jot):\s*(.+)/i);
  if (noteMatch) {
    const content = noteMatch[1].trim();
    lastContext = { intent: INTENTS.NOTE, entity: content, timestamp: Date.now() };
    return { intent: INTENTS.NOTE, content, raw: input };
  }

  // Unit Conversion
  const convertMatch = text.match(/convert\s+([\d.]+)\s+(\w+)\s+to\s+(\w+)/i)
    || text.match(/([\d.]+)\s+(\w+)\s+(?:to|in)\s+(\w+)/i);
  if (convertMatch && !text.match(/(?:what|how|calc)/i)) {
    const value = parseFloat(convertMatch[1]);
    const from = convertMatch[2].toLowerCase();
    const to = convertMatch[3].toLowerCase();
    return { intent: INTENTS.CONVERT, value, from, to, raw: input };
  }

  // Calculate Ã¢â‚¬â€ enhanced to handle percentages and word math
  const pctMatch = text.match(/(?:what\s+is\s+)?(\d+)\s*(?:%|percent|percentage)\s*(?:of)\s+(\d+[\d.]*)/i);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    const val = parseFloat(pctMatch[2]);
    return { intent: INTENTS.CALCULATE, expression: `${pct}% of ${val}`, pctCalc: { pct, val }, raw: input };
  }

  // Word-based math: "five plus three", "twenty times four"
  if (isWordMath(text)) {
    const wordExpr = parseWordMath(text);
    return { intent: INTENTS.CALCULATE, expression: wordExpr, wordMath: true, raw: input };
  }

  // Pure Math or Explicit calculation
  const calcMatch = text.match(/^(?:calculate|compute|solve|eval(?:uate)?)\s+(.+)/i)
    || text.match(/what\s+is\s+([a-z0-9\s+\-*/().^%]+)$/i) // e.g. "what is 5 * 2"
    || text.match(/^([\d\s+\-*/().^%]+)$/);

  if (calcMatch && /^[\d\s+\-*/().xyz^%]+$/i.test(calcMatch[1].trim())) {
    const expr = calcMatch[1].trim();
    return { intent: INTENTS.CALCULATE, expression: expr, raw: input };
  }

  // Scan/Index Files
  if (/^(?:scan|index|grant\s+access|access\s+(?:my\s+)?files|scan\s+(?:my\s+)?(?:files|storage|phone|device)|connect\s+storage)$/i.test(text)) {
    return { intent: INTENTS.SCAN_FILES, raw: input };
  }

  // Build Knowledge / Read Files
  if (/(?:read|learn|study|analyze|index)\s+(?:my\s+)?(?:files|documents|docs|content|books|textbook)/i.test(text)
    || /^(?:build\s+knowledge|read\s+everything|analyze\s+storage)$/i.test(text)) {
    return { intent: INTENTS.BUILD_KNOWLEDGE, raw: input };
  }

  // Next Class / Timetable
  if (/(?:next|upcoming)\s+(?:class|lecture|period|lesson|subject)/i.test(text)
    || /what(?:'s|\s+is)\s+(?:my\s+)?next\s+(?:class|lecture|period)/i.test(text)) {
    return { intent: INTENTS.NEXT_CLASS, raw: input };
  }

  // Today's Schedule
  if (/(?:today'?s?|my)\s+(?:schedule|timetable|classes|lectures)/i.test(text)
    || /(?:show|what)\s+(?:is\s+)?(?:my\s+)?(?:schedule|timetable)/i.test(text)) {
    return { intent: INTENTS.TODAY_SCHEDULE, raw: input };
  }

  // Knowledge Status
  if (/^(?:knowledge\s*(?:status|info|base)|what\s+(?:do\s+you|have\s+you)\s+(?:know|read|learned))$/i.test(text)) {
    return { intent: INTENTS.KNOWLEDGE_STATUS, raw: input };
  }

  // Storage Stats
  if (/^(?:how\s+many\s+files|storage\s*(?:info|stats|status)|file\s*(?:count|stats)|my\s+files)$/i.test(text)) {
    return { intent: INTENTS.STORAGE_STATS, raw: input };
  }

  // Open File
  const openFileMatch = text.match(/^open\s+file\s+(.+)/i);
  if (openFileMatch) {
    const requestedName = openFileMatch[1].trim();
    clearPendingOpenChoice();
    lastContext = { intent: INTENTS.OPEN_FILE, entity: requestedName, timestamp: Date.now() };
    return {
      intent: INTENTS.OPEN_FILE,
      file: requestedName,
      raw: rawInput,
      explicitFileTarget: true,
    };
  }

  // File Search (real)
  // NOTE: Keep explicit internet-search detection before this broad file-search regex.
  const internetSearchMatch = text.match(/(?:search\s+web|google\s+for|search\s+online)\s+(.*)/i);
  if (internetSearchMatch) {
    const q = internetSearchMatch[1];
    return { intent: INTENTS.INTERNET_SEARCH, query: q, raw: rawInput };
  }

  const fileMatch = text.match(/(?:find|search|look\s+for|locate|where\s+is)\s+(?:file\s+)?(.+)/i);
  if (fileMatch) {
    const file = fileMatch[1].trim();
    lastContext = { intent: INTENTS.FILE_SEARCH, entity: file, timestamp: Date.now() };
    return { intent: INTENTS.FILE_SEARCH, file, raw: rawInput };
  }

  // ===== SMART INTENT GUARD =====
  // Before falling through to file search, check if this looks like a
  // command/task vs an information query. This prevents words like
  // "time", "battery", "settings" from triggering file search.

  // These are single-word commands that should NOT trigger file search
  const TASK_WORDS = new Set([
    'time', 'date', 'day', 'clock', 'battery', 'charge',
    'flashlight', 'torch', 'vibrate', 'mute', 'unmute',
    'settings', 'setting', 'fullscreen', 'screenshot',
    'wifi', 'bluetooth', 'airplane', 'silent', 'brightness',
    'volume', 'calculator', 'calendar', 'camera', 'alarm',
    'timer', 'stopwatch', 'notes', 'note', 'weather',
  ]);

  // If the input is a single word that matches a task command, handle it
  if (TASK_WORDS.has(text)) {
    // Route known single-word commands
    if (text === 'time' || text === 'clock') return { intent: INTENTS.TIME_QUERY, raw: input };
    if (text === 'date' || text === 'day') return { intent: INTENTS.TIME_QUERY, raw: input };
    if (text === 'battery' || text === 'charge') return { intent: INTENTS.BATTERY, raw: input };
    if (text === 'flashlight' || text === 'torch') return { intent: INTENTS.FLASHLIGHT, raw: input };
    if (text === 'weather') {
      clearPendingOpenChoice();
      lastContext = { intent: INTENTS.WEATHER, entity: rawInput, timestamp: Date.now() };
      return { intent: INTENTS.WEATHER, raw: input };
    }
    if (text === 'vibrate') return { intent: INTENTS.VIBRATE, raw: input };
    if (text === 'mute' || text === 'unmute') return { intent: INTENTS.MUTE_TOGGLE, raw: input };
    if (text === 'fullscreen') return { intent: INTENTS.FULLSCREEN, raw: input };
    if (text === 'calculator' || text === 'calc') return { intent: INTENTS.LAUNCH_APP, app: 'Calculator', raw: input };
    if (text === 'calendar') return { intent: INTENTS.LAUNCH_APP, app: 'Google Calendar', raw: input };
    if (text === 'camera') return { intent: INTENTS.LAUNCH_APP, app: 'Camera', raw: input };
    if (text === 'settings' || text === 'setting') return { intent: INTENTS.LAUNCH_APP, app: 'Settings', raw: input };
    if (text === 'alarm' || text === 'alarms') return { intent: INTENTS.LAUNCH_APP, app: 'Clock', raw: input };
    if (text === 'timer') return { intent: INTENTS.TIMER_STATUS, raw: input };
    if (text === 'stopwatch') return { intent: INTENTS.STOPWATCH, action: 'start', raw: input };
    if (text === 'notes' || text === 'note') return { intent: INTENTS.LIST_NOTES, raw: input };
  }

  const brainFallback = buildIntentFromBrainInference(inferOfflineIntent(rawInput), rawInput);
  if (brainFallback) {
    if (
      brainFallback.intent === INTENTS.ASK_KNOWLEDGE
      && !shouldSearchKnowledgeByDefault(rawInput)
      && !looksLikeGeneralKnowledgeQuestion(rawInput)
    ) {
      return { intent: INTENTS.CONVERSATIONAL, subtype: 'general', raw: rawInput };
    }
    clearPendingOpenChoice();
    return brainFallback;
  }

  if (looksLikeGeneralKnowledgeQuestion(rawInput)) {
    clearPendingOpenChoice();
    lastContext = { intent: INTENTS.ASK_KNOWLEDGE, entity: rawInput, timestamp: Date.now() };
    return { intent: INTENTS.ASK_KNOWLEDGE, question: rawInput, raw: rawInput, generalKnowledge: true };
  }

  if (isCasualChatMessage(rawInput)) {
    clearPendingOpenChoice();
    return { intent: INTENTS.CONVERSATIONAL, subtype: 'general', raw: rawInput };
  }

  // Search device files only when the request explicitly asks for personal/file-derived knowledge.
  if (text.length > 2 && shouldSearchKnowledgeByDefault(rawInput)) {
    clearPendingOpenChoice();
    lastContext = { intent: INTENTS.ASK_KNOWLEDGE, entity: rawInput, timestamp: Date.now() };
    return { intent: INTENTS.ASK_KNOWLEDGE, question: rawInput, raw: rawInput };
  }

  clearPendingOpenChoice();
  return { intent: INTENTS.UNKNOWN, raw: rawInput };
}

const RESPONSE_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'i', 'in', 'is',
  'it', 'me', 'my', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'what', 'when', 'where',
  'which', 'who', 'why', 'with', 'you', 'your', 'tell', 'about', 'please', 'can', 'could',
  'would', 'should', 'any', 'into', 'does', 'did', 'have', 'has', 'had', 'this', 'those',
  'these', 'there', 'their', 'them', 'than', 'then', 'also', 'just', 'show', 'find',
]);

function extractRelevanceTerms(text) {
  return [...new Set(String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !RESPONSE_STOPWORDS.has(t)))];
}

function looksLikeSearchMiss(text) {
  const lower = String(text || '').toLowerCase();
  return !lower
    || lower.includes("couldn't find")
    || lower.includes('could not find')
    || lower.includes('no local results')
    || lower.includes('do not have access to your files')
    || lower.includes('not available while offline')
    || (lower.includes('searched through') && lower.includes('could not find'));
}

function isAnswerAppropriate(question, answerText) {
  if (!answerText || looksLikeSearchMiss(answerText)) return false;
  const queryTerms = extractRelevanceTerms(question);
  if (queryTerms.length === 0) return true;

  const haystack = String(answerText || '').toLowerCase();
  let hits = 0;
  for (const term of queryTerms) {
    if (haystack.includes(term)) hits += 1;
  }

  if (queryTerms.length <= 2) return hits >= 1;
  return hits >= Math.min(2, Math.ceil(queryTerms.length * 0.4));
}

function shouldUseEmbeddingRerankForQuestion(question, baseOpts = {}) {
  const text = String(question || '').trim().toLowerCase();
  const terms = extractRelevanceTerms(question);
  const definitionLike = /^(what\s+is|what\s+are|define|meaning\s+of)\b/i.test(text);

  if (definitionLike && terms.length <= 4) return false;
  if (terms.length <= 2) return false;

  return baseOpts.useEmbeddingsRerank !== false;
}

function tuneOfflineSearchOptsForQuestion(question, baseOpts = {}) {
  const text = String(question || '').trim().toLowerCase();
  const terms = extractRelevanceTerms(question);
  const definitionLike = /^(what\s+is|what\s+are|define|meaning\s+of)\b/i.test(text);

  const tuned = {
    ...baseOpts,
    useEmbeddingsRerank: shouldUseEmbeddingRerankForQuestion(question, baseOpts),
  };

  if (definitionLike && terms.length <= 4) {
    tuned.bm25CandidateLimit = Math.min(Number(baseOpts.bm25CandidateLimit || 24), 12);
    tuned.rerankTopK = Math.min(Number(baseOpts.rerankTopK || 5), 3);
  }

  return tuned;
}

function getDeviceMemoryGbForSearch() {
  if (typeof navigator === 'undefined') return null;
  const memory = Number(navigator.deviceMemory);
  if (!Number.isFinite(memory) || memory <= 0) return null;
  return memory;
}

function getCpuCoresForSearch() {
  if (typeof navigator === 'undefined') return null;
  const cores = Number(navigator.hardwareConcurrency);
  if (!Number.isFinite(cores) || cores <= 0) return null;
  return cores;
}

function isVeryLowRamSearchProfile() {
  const memory = getDeviceMemoryGbForSearch();
  const cores = getCpuCoresForSearch();
  if (Number.isFinite(memory) && memory <= 2) return true;
  if (Number.isFinite(cores) && cores <= 2) return true;
  return false;
}

function isLowRamSearchProfile() {
  const memory = getDeviceMemoryGbForSearch();
  const cores = getCpuCoresForSearch();
  if (Number.isFinite(memory) && memory <= 4) return true;
  if (Number.isFinite(cores) && cores <= 4) return true;
  return false;
}

function buildOfflineSearchOpts(progressCb = null) {
  const perf = getRuntimePerformanceProfile();
  const veryLowRam = perf.tier === 'low' && ((perf.memoryGb || 0) <= 2 || (perf.cpuCores || 0) <= 2);
  const lowRam = perf.tier === 'low';
  return {
    useEmbeddingsRerank: perf.search.useEmbeddingsRerank && !lowRam ? true : perf.search.useEmbeddingsRerank,
    bm25CandidateLimit: perf.search.bm25CandidateLimit || (veryLowRam ? 12 : (lowRam ? 16 : 24)),
    rerankTopK: perf.search.rerankTopK || (veryLowRam ? 2 : (lowRam ? 3 : 5)),
    fullScanThrottleMs: perf.search.fullScanThrottleMs || (veryLowRam ? 4 : 1),
    includeFilenameFallback: 'always',
    forceFullScan: true,
    progressCb: typeof progressCb === 'function' ? progressCb : null,
  };
}

export const LOCAL_LLM_TOGGLE_KEY = 'nice_local_llm_enabled';

function readBooleanSetting(key, fallback = true) {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined || raw === '') return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

export function isLocalLlmEnabledPreference() {
  return readBooleanSetting(LOCAL_LLM_TOGGLE_KEY, true);
}

export function setLocalLlmEnabledPreference(enabled) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_LLM_TOGGLE_KEY, enabled ? 'true' : 'false');
    }
  } catch {
    // Ignore storage failures, keep runtime fallback behavior.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nice:local-llm-policy-updated', {
      detail: getLocalLlmRuntimeState(),
    }));
  }
}

function isLocalLlmEnabledByPolicy() {
  return isLocalLlmEnabledPreference();
}

function getLocalLlmDecision() {
  if (!isLocalLlmEnabledByPolicy()) {
    return { allowed: false, reason: 'disabled_by_user' };
  }

  const perf = getRuntimePerformanceProfile();
  const memory = Number(perf.memoryGb);
  const cores = Number(perf.cpuCores);
  const lowBattery = typeof perf.batteryLevel === 'number' && perf.batteryLevel > 0 && perf.batteryLevel <= 0.2 && perf.charging === false;
  if (lowBattery) {
    return { allowed: false, reason: 'low_battery', perf };
  }

  // On native devices, unknown capability signals should fail safe.
  const missingSignals = !Number.isFinite(memory) && !Number.isFinite(cores);
  if (perf.native && missingSignals) {
    return { allowed: false, reason: 'unknown_device_capability', perf };
  }

  // Keep low-end devices stable; fallback to deterministic synthesis there.
  if (perf.tier === 'low' && Number.isFinite(memory) && memory > 0 && memory < 4) {
    return { allowed: false, reason: 'low_memory_tier', perf };
  }
  if (perf.tier === 'low' && Number.isFinite(cores) && cores > 0 && cores <= 4 && perf.energyMode !== 'performance') {
    return { allowed: false, reason: 'low_cpu_tier', perf };
  }
  return { allowed: true, reason: 'allowed', perf };
}

export function getLocalLlmRuntimeState() {
  const decision = getLocalLlmDecision();
  const perf = decision.perf || getRuntimePerformanceProfile();
  return {
    enabledByUser: isLocalLlmEnabledByPolicy(),
    allowedNow: decision.allowed,
    reason: decision.reason,
    tier: perf.tier,
    native: !!perf.native,
    memoryGb: Number.isFinite(Number(perf.memoryGb)) ? Number(perf.memoryGb) : null,
    cpuCores: Number.isFinite(Number(perf.cpuCores)) ? Number(perf.cpuCores) : null,
    batteryLevel: typeof perf.batteryLevel === 'number' ? perf.batteryLevel : null,
    charging: typeof perf.charging === 'boolean' ? perf.charging : null,
    energyMode: perf.energyMode || 'balanced',
  };
}

function shouldUseLocalLlmForCurrentDevice() {
  return getLocalLlmDecision().allowed;
}

function extractLikelySourceNames(answerText) {
  const text = String(answerText || '');
  const names = [];

  const sourceMatches = text.matchAll(/Source:\s*([^\n]+)/gi);
  for (const match of sourceMatches) {
    const block = String(match[1] || '').trim();
    if (!block) continue;
    for (const part of block.split(',').map(v => v.trim()).filter(Boolean)) {
      if (!names.includes(part)) names.push(part);
      if (names.length >= 4) return names;
    }
  }

  const fileMatches = text.matchAll(/File:\s*\*{0,2}([^*\n(]+?)(?:\*{0,2}|\s*\()/gi);
  for (const match of fileMatches) {
    const name = String(match[1] || '').trim();
    if (!name) continue;
    if (!names.includes(name)) names.push(name);
    if (names.length >= 4) return names;
  }

  return names;
}

function sanitizeOfflineContext(answerText) {
  const stripped = String(answerText || '')
    .replace(/\[Open this file in app\]\([^)]+\)/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_>#]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return stripped.slice(0, 2800);
}

function extractOfflineConfidenceScore(answerText) {
  const text = String(answerText || '');
  const match = text.match(/confidence:\s*(\d{1,3})\s*%/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

async function tryLocalLlmAnswer(question, offlineAnswerText) {
  if (!shouldUseLocalLlmForCurrentDevice()) return null;
  const confidence = extractOfflineConfidenceScore(offlineAnswerText);
  if (Number.isFinite(confidence) && confidence < 70) return null;

  const context = sanitizeOfflineContext(offlineAnswerText);
  if (!context || context.length < 140) return null;
  if (context.length > 2200) return null;

  const perf = getRuntimePerformanceProfile();
  const maxNewTokens = perf.tier === 'high' ? 200 : 150;

  try {
    await initLocalLlmWorker();
    const generated = await generateLocalLlmAnswer({
      question,
      context,
      maxNewTokens,
    });
    const clean = String(generated || '').trim();
    if (!clean) return null;
    if (!isAnswerAppropriate(question, clean)) return null;

    const sources = extractLikelySourceNames(offlineAnswerText);
    if (sources.length > 0) {
      return `${clean}\n\nSources: ${sources.join(', ')}`;
    }
    return clean;
  } catch (error) {
    console.warn('[Nice] Local LLM answer route unavailable, using deterministic offline answer:', error?.message || error);
    return null;
  }
}

async function resolveKnowledgeQuery(question, offlineSearchOpts, opts = {}) {
  const queryText = String(question || '').trim();
  const preferOnline = !!opts.preferOnline;
  const requireOnlineOnly = !!opts.requireOnlineOnly;
  const progressCb = typeof opts.progressCb === 'function' ? opts.progressCb : null;
  let webResult = null;
  let offlineResult = null;
  let webQuality = null;
  let offlineQuality = null;

  if (preferOnline && isOnlineAllowed('webSearch') && isOnline()) {
    try {
      webResult = await searchWeb(queryText);
    } catch {
      webResult = null;
    }
    webQuality = evaluateAnswerQuality(queryText, webResult, { source: 'web' });
    if (webQuality.acceptable && isAnswerAppropriate(queryText, webResult)) {
      return { source: 'web', text: webResult };
    }
  }

  if (!requireOnlineOnly) {
    const tunedOfflineOpts = tuneOfflineSearchOptsForQuestion(queryText, offlineSearchOpts);
    if (typeof progressCb === 'function') {
      progressCb('analyze', 0, 0, {
        text: 'Analyzing your request and planning offline retrieval...',
      });
    }
    try {
      offlineResult = await searchForAnswer(queryText, {
        ...tunedOfflineOpts,
        progressCb,
      });
    } catch {
      offlineResult = null;
    }
    offlineQuality = evaluateAnswerQuality(queryText, offlineResult, { source: 'offline' });
    if (offlineQuality.acceptable && isAnswerAppropriate(queryText, offlineResult)) {
      const localLlmText = await tryLocalLlmAnswer(queryText, offlineResult);
      if (localLlmText) {
        return { source: 'offline_local_llm', text: localLlmText };
      }
      return { source: 'offline', text: offlineResult };
    }
  }

  if (webResult && !looksLikeSearchMiss(webResult) && (webQuality?.score || 0) >= 42) {
    return {
      source: 'web_weak',
      text: `I found an online result, but it may only be partially related:\n\n${webResult}`,
    };
  }

  if (offlineResult && !looksLikeSearchMiss(offlineResult) && (offlineQuality?.score || 0) >= 42) {
    return {
      source: 'offline_weak',
      text: `I found something locally, but it may be only partially related:\n\n${offlineResult}`,
    };
  }

  // Knowledge-graph fallback: reuse high-signal historical local facts with citations.
  const kgFacts = queryKnowledgeGraph(queryText, { limit: 2 });
  if (kgFacts.length > 0) {
    const lines = kgFacts.map((fact, idx) => {
      const citation = (fact.citations || [])
        .slice(0, 2)
        .map(c => c.fileName)
        .filter(Boolean)
        .join(', ');
      const citationLine = citation ? `\nSource: ${citation}` : '';
      return `**${idx + 1}.** ${fact.answer}${citationLine}`;
    });

    return {
      source: 'knowledge_graph',
      text: `I could not verify a fresh high-confidence match right now, but from my offline knowledge graph I found:\n\n${lines.join('\n\n')}`,
    };
  }

  const shortQuery = queryText.substring(0, 80);
  const bestQuality = [webQuality, offlineQuality]
    .filter(Boolean)
    .sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
  const clarification = buildClarificationPrompt(queryText, bestQuality);
  if (preferOnline && isOnlineAllowed('webSearch') && isOnline()) {
    return {
      source: 'none',
      text: `I could not find a reliable answer for "${shortQuery}" from the internet or your device files.\n\n${clarification}`,
    };
  }

  const offlineHint = isOfflineHardLocked()
    ? 'Try adding more specific keywords and make sure relevant local files are indexed.'
    : 'Try adding more specific keywords or enable Online Mode.';

  return {
    source: 'none',
    text: `I could not find a reliable local answer for "${shortQuery}". ${offlineHint}\n\n${clarification}`,
  };
}

function resolveOpenTargetAtRuntime(parsed) {
  const target = String(parsed?.target || '').trim();
  if (!target) {
    clearPendingOpenChoice();
    return { intent: INTENTS.UNKNOWN, raw: parsed?.raw || '' };
  }

  const normalizedTarget = target
    .replace(/^(?:the|my|a)\s+/i, '')
    .replace(/^app(?:lication)?\s+/i, '')
    .replace(/^file\s+/i, '')
    .trim();

  const requestedName = normalizedTarget || target;
  const explicitAppTarget = parsed?.explicitAppTarget === true;
  const explicitFileTarget = parsed?.explicitFileTarget === true;
  const fileLikeTarget = parsed?.fileLikeTarget === true || looksLikeFileReference(requestedName);
  const appAlias = typeof parsed?.appAlias === 'string' && parsed.appAlias.trim()
    ? parsed.appAlias.trim()
    : null;
  const fallbackAppName = requestedName.replace(/\b\w/g, c => c.toUpperCase());

  let exactRequestedFile = null;
  let topCandidate = null;

  try {
    exactRequestedFile = findExactFileByName(requestedName);
  } catch {
    exactRequestedFile = null;
  }

  if (!exactRequestedFile) {
    try {
      const candidates = searchFiles(requestedName);
      if (Array.isArray(candidates) && candidates.length > 0) {
        [topCandidate] = candidates;
      }
    } catch {
      topCandidate = null;
    }
  }

  const topScore = Number(topCandidate?.score || 0);
  const strongFileEvidence = !!(exactRequestedFile || (topCandidate && topScore >= 45));

  if (explicitAppTarget && (appAlias || fallbackAppName)) {
    const appName = appAlias || fallbackAppName;
    clearPendingOpenChoice();
    lastContext = { intent: INTENTS.LAUNCH_APP, entity: appName, timestamp: Date.now() };
    return { intent: INTENTS.LAUNCH_APP, app: appName, raw: parsed?.raw || target, explicitAppTarget: true };
  }

  if (appAlias && !explicitAppTarget && !explicitFileTarget && !fileLikeTarget && strongFileEvidence) {
    const candidate = exactRequestedFile || topCandidate;
    pendingOpenChoice = {
      appName: appAlias,
      fileName: candidate?.name || requestedName,
      fileId: candidate?.id || null,
      target: requestedName,
      timestamp: Date.now(),
    };
    return {
      intent: INTENTS.OPEN_TARGET_CLARIFY,
      target: requestedName,
      app: appAlias,
      file: candidate?.name || requestedName,
      fileId: candidate?.id || null,
      raw: parsed?.raw || target,
    };
  }

  if (exactRequestedFile && (explicitFileTarget || fileLikeTarget || !appAlias)) {
    clearPendingOpenChoice();
    lastContext = { intent: INTENTS.OPEN_FILE, entity: exactRequestedFile.name, timestamp: Date.now() };
    return {
      intent: INTENTS.OPEN_FILE,
      file: exactRequestedFile.name,
      fileId: exactRequestedFile.id,
      raw: parsed?.raw || target,
      exactFileMatch: true,
    };
  }

  const tokenCount = requestedName.split(/\s+/).filter(Boolean).length;
  const likelyFileRequest =
    topCandidate && (
      explicitFileTarget
      || fileLikeTarget
      || (!appAlias && topScore >= 42)
      || (!appAlias && tokenCount >= 2 && topScore >= 30)
    );

  if (likelyFileRequest) {
    clearPendingOpenChoice();
    lastContext = { intent: INTENTS.OPEN_FILE, entity: topCandidate.name, timestamp: Date.now() };
    return {
      intent: INTENTS.OPEN_FILE,
      file: topCandidate.name,
      fileId: topCandidate.id,
      raw: parsed?.raw || target,
      fuzzyFileMatch: true,
    };
  }

  if (appAlias && !explicitFileTarget && !fileLikeTarget) {
    clearPendingOpenChoice();
    lastContext = { intent: INTENTS.LAUNCH_APP, entity: appAlias, timestamp: Date.now() };
    return { intent: INTENTS.LAUNCH_APP, app: appAlias, raw: parsed?.raw || target, appAliasMatch: true };
  }

  if (explicitFileTarget || fileLikeTarget) {
    clearPendingOpenChoice();
    lastContext = { intent: INTENTS.OPEN_FILE, entity: requestedName, timestamp: Date.now() };
    return { intent: INTENTS.OPEN_FILE, file: requestedName, raw: parsed?.raw || target };
  }

  const appName = appAlias || fallbackAppName;
  clearPendingOpenChoice();
  lastContext = { intent: INTENTS.LAUNCH_APP, entity: appName, timestamp: Date.now() };
  return { intent: INTENTS.LAUNCH_APP, app: appName, raw: parsed?.raw || target };
}
/**
 * Generate a response and execute real actions for a parsed intent
 */
export function generateResponse(parsed, runtime = {}) {
  parsed = applyUsageIntentHint(
    (parsed && typeof parsed === 'object') ? parsed : { intent: INTENTS.UNKNOWN, raw: '' },
    parsed?.raw || '',
  );
  const delay = 30; // Instant - real assistant speed
  const defaultProgressCb = typeof runtime.progressCb === 'function' ? runtime.progressCb : null;
  const offlineSearchOpts = buildOfflineSearchOpts(defaultProgressCb);

  switch (parsed.intent) {
    case INTENTS.GREETING: {
      const hour = new Date().getHours();
      const timeGreet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const onlineStatus = isOnlineSessionOptedIn() && isOnline() ? 'Ã°Å¸Å’Â Online Mode' : 'Ã°Å¸â€œÂ´ Offline-First';
      return {
        text: `${timeGreet}! Ã°Å¸ËœÅ  I'm **Nice**. Today is **${dateStr}** (${onlineStatus}). I can help with alarms, music, files, OCR search, app actions, and math.`,
        delay,
      };
    }

    case INTENTS.HELP: {
      const policyLines = isOfflineHardLocked()
        ? '- Offline-only build (internet is disabled)'
        : '- Offline by default\n- Enable Online Mode in Settings or say "go online" for web/weather';
      const perf = getRuntimePerformanceProfile();
      const learning = getLearningStatus();
      const learningLine = learning.enabled
        ? `- Encrypted personalization memory: ON (${learning.intentsTracked} intents tracked)`
        : '- Encrypted personalization memory: OFF (enable in Settings)';
      return {
        text: '**Core Features**\n- "scan my files"\n- Ask file-content questions (text/PDF/OCR)\n- "find <file>" / "open file <file>"\n- Alarms, timers, stopwatch, notes\n- App launch, flashlight, battery, vibrate\n- Math and conversion\n- Local automation rules: `when I say <trigger> do <action>`\n- Multimodal capture: say `analyze screenshot` and attach/capture image\n\n**Voice**\n- Tap mic for speech input\n- Optional wake word in Settings\n\n**Intelligence**\n- Confidence-guarded answers\n- Local knowledge graph with citations\n- Hybrid retrieval (BM25 + embedding rerank + verifier)\n- Local LLM answer synthesis from retrieved file evidence (fully offline)\n- Performance governor profile: **' + perf.tier.toUpperCase() + '** (' + String(perf.energyMode || 'balanced').toUpperCase() + ')\n' + learningLine + '\n\n**Connectivity Policy**\n' + policyLines + '\n\n**Experimental (non-blocking)**\n- Translation and semantic image search are available but not part of v1 acceptance.',
        delay,
      };
    }

    case INTENTS.MULTIMODAL_CAPTURE: {
      return {
        text: 'Offline multimodal mode is ready.\n\n1. Tap the attach icon.\n2. Capture/select an image, screenshot, or document.\n3. Press Send to run offline OCR and ask follow-up questions from extracted content.',
        intent_tag: 'MULTIMODAL',
        delay,
      };
    }

    case INTENTS.AUTOMATION_CREATE: {
      const created = createAutomationRule(parsed.trigger, parsed.action);
      if (!created.success) {
        return { text: created.message || 'Could not create automation rule.', intent_tag: 'AUTOMATION', delay };
      }
      return {
        text: `Automation saved.\nTrigger: **${created.rule.trigger}**\nAction: **${created.rule.action}**\n\nThis runs fully offline on-device.`,
        intent_tag: 'AUTOMATION',
        delay,
      };
    }

    case INTENTS.AUTOMATION_LIST: {
      const rules = listAutomationRules();
      if (rules.length === 0) {
        return { text: 'No automations yet. Example: `when I say start study mode do set timer for 45 minutes`', intent_tag: 'AUTOMATION', delay };
      }
      const rows = rules.slice(0, 10).map((rule, idx) => `${idx + 1}. **${rule.trigger}** -> ${rule.action}`);
      return { text: `Offline automations:\n\n${rows.join('\n')}`, intent_tag: 'AUTOMATION', delay };
    }

    case INTENTS.AUTOMATION_DELETE: {
      const removed = removeAutomationRule(parsed.target);
      if (removed.removed > 0) {
        return { text: `Removed ${removed.removed} automation rule(s).`, intent_tag: 'AUTOMATION', delay };
      }
      return { text: `No automation matched "${parsed.target}".`, intent_tag: 'AUTOMATION', delay };
    }

    case INTENTS.AUTOMATION_RUN: {
      return {
        text: `Running automation **${parsed.trigger}**...`,
        intent_tag: 'AUTOMATION',
        delay,
        asyncAction: async (progressCb) => {
          const automationParsed = parseCommand(parsed.actionCommand, {
            allowBrainPlan: true,
            fromAutomation: true,
          });
          const nested = generateResponse(automationParsed, runtime);
          if (!nested?.asyncAction) {
            return `Automation "${parsed.trigger}" executed:\n\n${nested?.text || 'Done.'}`;
          }
          const nestedResult = await nested.asyncAction(progressCb);
          return `Automation "${parsed.trigger}" executed:\n\n${nestedResult || nested.text || 'Done.'}`;
        },
      };
    }

    case INTENTS.BRAIN_PLAN: {
      const steps = Array.isArray(parsed.steps)
        ? parsed.steps.filter((step) => step && step.intent && step.intent !== INTENTS.UNKNOWN)
        : [];
      const blockedSummary = formatBlockedPlanSteps(parsed.blockedSteps || []);
      if (steps.length === 0) {
        return {
          text: blockedSummary
            ? `I could not build a safe executable offline plan.\n\nBlocked steps:\n${blockedSummary}`
            : 'I could not build an executable offline plan from that command.',
          intent_tag: 'BRAIN_PLAN',
          delay,
        };
      }

      const warningLine = blockedSummary
        ? `\n\nBlocked unsafe steps:\n${blockedSummary}`
        : '';

      return {
        text: `Offline brain planned **${steps.length}** safe step${steps.length > 1 ? 's' : ''}. Executing locally...${warningLine}`,
        intent_tag: 'BRAIN_PLAN',
        delay,
        asyncAction: async (progressCb) => {
          const results = [];
          let failures = 0;

          for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const stepLabel = step.raw || step.intent || `Step ${i + 1}`;

            if (typeof progressCb === 'function') {
              progressCb('preview', i + 1, steps.length, {
                text: `Step ${i + 1}/${steps.length}: ${stepLabel}`,
              });
            }

            try {
              const stepResponse = generateResponse(step, runtime);
              let stepText = stepResponse?.text || 'Done.';
              if (typeof stepResponse?.asyncAction === 'function') {
                stepText = await stepResponse.asyncAction(progressCb);
              }
              results.push(`**${i + 1}. ${stepLabel}**\n${stepText}`);
            } catch (error) {
              failures += 1;
              results.push(`**${i + 1}. ${stepLabel}**\nFailed: ${error?.message || 'Unknown error'}`);
            }
          }

          const completed = steps.length - failures;
          const summary = failures === 0
            ? `Offline brain completed ${completed}/${steps.length} steps successfully.`
            : `Offline brain completed ${completed}/${steps.length} steps (${failures} failed).`;

          return `${summary}\n\n${results.join('\n\n---\n\n')}`;
        },
      };
    }

    case INTENTS.CONVERSATIONAL:
      return buildConversationalReply(parsed, delay);

    case INTENTS.OPEN_TARGET: {
      const resolved = resolveOpenTargetAtRuntime(parsed);
      if (!resolved || resolved.intent === INTENTS.OPEN_TARGET) {
        return {
          text: 'Please tell me exactly what to open, like "open app Settings" or "open file resume.pdf".',
          intent_tag: 'OPEN_TARGET',
          delay,
        };
      }
      return generateResponse(resolved, runtime);
    }

    case INTENTS.OPEN_TARGET_CLARIFY: {
      const label = parsed?.target || parsed?.raw || 'that request';
      const appName = parsed?.app || 'that app';
      const fileName = parsed?.file || 'that file';
      return {
        text: `I found both an app and a file for **${label}**.\nSay **"open app ${appName}"** to launch the app, or **"open file ${fileName}"** to open the document.`,
        intent_tag: 'CLARIFY',
        delay,
      };
    }

    case INTENTS.LAUNCH_APP: {
      const r = launchApp(parsed.app);
      if (r.asyncAction) {
        return {
          text: `Sure thing! Opening **${parsed.app}**... Ã°Å¸Å¡â‚¬`, intent_tag: 'LAUNCH_APP', delay,
          asyncAction: r.asyncAction,
        };
      }
      return { text: `Sure thing! ${r.message || 'Done!'}`, intent_tag: 'LAUNCH_APP', delay };
    }

    case INTENTS.SET_ALARM: {
      const r = setRealAlarm(parsed.time);
      return {
        text: r.success ? `Of course! ${r.message} Ã¢ÂÂ° I'll make sure you're on time!` : `I'm sorry, I couldn't quite understand that time. ${r.message}. Try: "Set alarm for 7 AM" or "Set alarm for in 5 minutes". Ã°Å¸ËœÅ `,
        intent_tag: 'SET_ALARM', delay,
      };
    }

    case INTENTS.CANCEL_ALARM: {
      const count = cancelAllAlarms();
      return { text: count > 0 ? `Done! I've cancelled ${count} alarm${count > 1 ? 's' : ''} for you. Ã¢Å“â€¦ Rest easy!` : 'You\'re all clear Ã¢â‚¬â€ no active alarms to cancel! Ã°Å¸ËœÅ ', intent_tag: 'CANCEL_ALARM', delay };
    }

    case INTENTS.SET_TIMER: {
      const r = setTimer(parsed.duration);
      return { text: r.success ? `You got it! ${r.message} Ã¢ÂÂ±Ã¯Â¸Â` : `No worries, but I couldn't understand the duration. ${r.message} Ã°Å¸ËœÅ `, intent_tag: 'SET_TIMER', delay };
    }

    case INTENTS.CANCEL_TIMER:
      cancelTimer();
      return { text: 'Timer cancelled. Ã¢Å“â€¦', intent_tag: 'CANCEL_TIMER', delay };

    case INTENTS.TIMER_STATUS:
      return { text: getTimerStatus(), intent_tag: 'TIMER_STATUS', delay };

    case INTENTS.STOPWATCH: {
      let r;
      if (parsed.action === 'start') r = startStopwatch();
      else if (parsed.action === 'stop') r = stopStopwatch();
      else r = resetStopwatch();
      return { text: r.message, intent_tag: 'STOPWATCH', delay };
    }

    case INTENTS.CALENDAR: {
      const eventName = parsed.event || parsed.title || 'Event';
      return {
        text: `📅 Scheduling **${eventName}**...`,
        intent_tag: 'CALENDAR',
        delay,
        asyncAction: async () => {
          const r = await createCalendarEvent(eventName, parsed.when, {
            startTime: parsed.startTime,
            endTime: parsed.endTime,
          });
          return r.message || `Scheduled **${eventName}** in your calendar. 📅`;
        },
      };
    }

    case INTENTS.MEDIA:
      if (parsed.action === 'play') {
        return {
          text: `Searching for **${parsed.song}**... Ã°Å¸Å½Âµ`, intent_tag: 'MEDIA_PLAY', delay,
          asyncAction: async () => {
            const msg = await playMusic(parsed.song);
            return msg || `Now playing **${parsed.song}** Ã°Å¸Å½Âµ`;
          },
        };
      }
      if (parsed.action === 'pause') {
        pauseMusic();
        return { text: 'Music paused Ã¢ÂÂ¸Ã¯Â¸Â', intent_tag: 'MEDIA_PAUSE', delay };
      }
      if (parsed.action === 'resume') {
        resumeMusic();
        return { text: 'Resuming playback Ã¢â€“Â¶Ã¯Â¸Â', intent_tag: 'MEDIA_RESUME', delay };
      }
      if (parsed.action === 'stop') {
        stopMusic();
        return { text: 'Music stopped Ã¢ÂÂ¹Ã¯Â¸Â', intent_tag: 'MEDIA_STOP', delay };
      }
      return { text: `Adjusting volume: ${parsed.detail}`, intent_tag: 'MEDIA_VOLUME', delay };

    case INTENTS.NOTE: {
      saveNote(parsed.content);
      const c = getNotes().length;
      return { text: `Got it! I've saved your note: "${parsed.content}" Ã°Å¸â€œÂ (${c} note${c > 1 ? 's' : ''} total). It's safe with me! Ã°Å¸â€™Å“`, intent_tag: 'NOTE', delay };
    }

    case INTENTS.LIST_NOTES:
      return { text: formatNotesForDisplay(), intent_tag: 'LIST_NOTES', delay };

    case INTENTS.DELETE_NOTES:
      deleteAllNotes();
      return { text: 'All notes deleted. Ã°Å¸â€”â€˜Ã¯Â¸Â', intent_tag: 'DELETE_NOTES', delay };

    case INTENTS.MUTE_TOGGLE: {
      const on = toggleTTS();
      return { text: on ? 'Voice output turned **ON** Ã°Å¸â€Å ' : 'Voice output turned **OFF** Ã°Å¸â€â€¡', intent_tag: 'TTS_TOGGLE', delay };
    }

    case INTENTS.CONTACT_LOOKUP: {
      const target = parsed.name || parsed.query || '';
      return {
        text: `Looking up contact **${target}**...`,
        intent_tag: 'CONTACT_LOOKUP',
        delay,
        asyncAction: async () => {
          const r = await lookupContact(target);
          return r.message || `No contact details found for **${target}**.`;
        },
      };
    }

    case INTENTS.BATTERY: {
      // getBatteryStatus is async, but we handle it here
      return { text: 'Ã°Å¸â€â€¹ Checking battery...', intent_tag: 'BATTERY', delay, asyncAction: async () => await getBatteryStatus() };
    }

    case INTENTS.FLASHLIGHT: {
      return { text: 'Ã°Å¸â€Â¦ Toggling flashlight...', intent_tag: 'FLASHLIGHT', delay, asyncAction: async () => { const r = await toggleFlashlight(); return r.message; } };
    }

    case INTENTS.CLIPBOARD_READ: {
      return {
        text: '📋 Reading clipboard...',
        intent_tag: 'CLIPBOARD_READ',
        delay,
        asyncAction: async () => {
          const r = await readFromClipboard();
          if (!r.success) {
            return r.message || 'Could not read from clipboard.';
          }
          if (!r.hasContent || !r.text) {
            return 'Your clipboard is empty. 📋';
          }
          return `**Clipboard Content:**\n\n${r.text}`;
        },
      };
    }

    case INTENTS.CLIPBOARD: {
      return { text: 'Ã°Å¸â€œâ€¹ Copying...', intent_tag: 'CLIPBOARD', delay, asyncAction: async () => { const r = await copyToClipboard(parsed.text); return r.message; } };
    }

    case INTENTS.WAKE_LOCK: {
      return { text: 'Ã°Å¸â€â€™ Adjusting screen...', intent_tag: 'WAKE_LOCK', delay, asyncAction: async () => await toggleWakeLock() };
    }

    case INTENTS.SHARE: {
      return { text: 'Ã°Å¸â€œÂ² Sharing...', intent_tag: 'SHARE', delay, asyncAction: async () => { const r = await shareContent(parsed.text); return r.message; } };
    }

    case INTENTS.FULLSCREEN:
      return { text: toggleFullscreen(), intent_tag: 'FULLSCREEN', delay };

    case INTENTS.VIBRATE:
      vibrateDevice([100, 50, 100, 50, 200]);
      return { text: 'Buzz! Ã°Å¸â€œÂ³', intent_tag: 'VIBRATE', delay };

    case INTENTS.TIME_QUERY: {
      const dt = getCurrentDateTime();
      return { text: `Here you go! Ã°Å¸ËœÅ  ${dt.full}`, intent_tag: 'TIME', delay };
    }

    case INTENTS.WORLD_CLOCK:
      return { text: getWorldTime(parsed.city), intent_tag: 'WORLD_CLOCK', delay };

    case INTENTS.CALCULATE: {
      // Handle percentage calculations
      if (parsed.pctCalc) {
        const { pct, val } = parsed.pctCalc;
        const result = (pct / 100) * val;
        const formatted = Number.isInteger(result) ? result.toString() : result.toFixed(2);
        return {
          text: `Sure! **${pct}% of ${val}** = **${formatted}** Ã¢Å“Â¨`,
          result_block: `${pct}% of ${val} = ${formatted}`,
          intent_tag: 'CALCULATE', delay,
        };
      }
      const result = safeEvaluate(parsed.expression);
      const displayExpr = parsed.wordMath ? parsed.raw : parsed.expression;
      return {
        text: result.error ? `I'm sorry, I couldn't compute that. ${result.error}. Could you rephrase it? Ã°Å¸ËœÅ ` : `Here you go! **${displayExpr}** = **${result.value}** Ã¢Å“Â¨`,
        result_block: result.error ? null : `${displayExpr} = ${result.value}`,
        intent_tag: 'CALCULATE', delay,
      };
    }

    case INTENTS.CONVERT: {
      const c = convertUnit(parsed.value, parsed.from, parsed.to);
      return {
        text: c.error ? `Sorry, I can't convert ${parsed.from} to ${parsed.to} yet.`
          : `**${parsed.value} ${parsed.from}** = **${c.value} ${parsed.to}**`,
        result_block: c.error ? null : `${parsed.value} ${parsed.from} Ã¢â€ â€™ ${c.value} ${parsed.to}`,
        intent_tag: 'CONVERT', delay,
      };
    }

    case INTENTS.SCAN_FILES: {
      return {
        text: 'Scanning your files now...',
        intent_tag: 'SCAN_FILES',
        delay,
        asyncAction: async () => {
          const result = await grantFolderAccess();
          if (result?.success) {
            try {
              const warm = await warmupSearchKnowledge({ maxFiles: Infinity });
              const learnedMsg = `\n\nLearning complete: processed ${warm.processed} searchable files, built ${warm.cachedProfiles} local learning profiles for better offline answers.`;
              return (result.message || `Indexed ${result.count || 0} files.`) + learnedMsg;
            } catch {
              return result.message || `Indexed ${result.count || 0} files.`;
            }
          }
          return `I could not scan files right now. ${result?.message || 'Permission may be missing.'}`;
        },
      };
    }

    case INTENTS.STORAGE_STATS:
      return { text: getStorageStats(), intent_tag: 'STORAGE', delay };

    case INTENTS.OPEN_FILE: {
      let targetFile = null;
      if (parsed.fileId) {
        targetFile = findFileById(parsed.fileId);
      }
      if (!targetFile && parsed.file) {
        targetFile = findExactFileByName(parsed.file);
      }
      if (!targetFile && parsed.file) {
        const results = searchFiles(parsed.file);
        targetFile = results.length > 0 ? results[0] : null;
      }

      if (!targetFile) {
        return { text: `No file matching "${parsed.file}" found. Try "scan my files" first.`, delay };
      }
      return {
        text: `Opening **${targetFile.name}**...`, intent_tag: 'OPEN_FILE', delay,
        asyncAction: async () => {
          const r = await openFile(targetFile);
          return r.message;
        },
      };
    }

    case INTENTS.FILE_SEARCH: {
      // Content-first offline search (with filename fallback shown below content matches)
      const count = getIndexedFileCount();
      if (count === 0) {
        return {
          text: `I do not have a file index yet. Say **"scan my files"** first, then search for "${parsed.file}" again.`,
          intent_tag: 'FILE_SEARCH',
          delay,
        };
      }
      return {
        text: 'Searching your indexed files for content matches...',
        intent_tag: 'FILE_SEARCH',
        delay,
        asyncAction: async (progressCb) => {
          const searchOpts = {
            ...offlineSearchOpts,
            progressCb: typeof progressCb === 'function' ? progressCb : defaultProgressCb,
          };
          const offlineResult = await searchForAnswer(parsed.file || parsed.raw, searchOpts);
          if (offlineResult && !offlineResult.includes("couldn't find") && !offlineResult.includes("couldn't access")) {
            lastContext = { intent: INTENTS.FILE_SEARCH, entity: parsed.file || parsed.raw, timestamp: Date.now() };
            return offlineResult;
          }
          return `I searched your indexed files but could not find matches for "${parsed.file}".`;
        },
      };
    }

    case INTENTS.BUILD_KNOWLEDGE:
      return { text: 'Ã°Å¸â€Â No pre-building needed! I search your files **on-demand** Ã¢â‚¬â€ zero duplication.\n\nJust ask me anything Ã¢â‚¬â€ like "What\'s John\'s phone number?" or "Tell me about photosynthesis" Ã¢â‚¬â€ and I\'ll search through your files instantly! Ã°Å¸â€™Å“', delay };

    case INTENTS.ASK_KNOWLEDGE: {
      const searchQ = parsed.question || parsed.raw;
      const preferOnline = isOnlineAllowed('webSearch') && isOnline();
      return {
        text: preferOnline
          ? 'Searching online first, then checking your files if needed...'
          : 'Searching through your files...',
        intent_tag: 'SEARCH',
        delay,
        asyncAction: async (progressCb) => {
          const resolved = await resolveKnowledgeQuery(searchQ, offlineSearchOpts, {
            preferOnline,
            progressCb: typeof progressCb === 'function' ? progressCb : defaultProgressCb,
          });
          return resolved.text;
        },
      };
    }

    case INTENTS.NEXT_CLASS:
    case INTENTS.TODAY_SCHEDULE: {
      return {
        text: 'Ã°Å¸â€Â Looking for your schedule...', intent_tag: 'SEARCH', delay,
        asyncAction: async (progressCb) => {
          // Use on-device search to find schedule/timetable files
          const searchOpts = {
            ...offlineSearchOpts,
            progressCb: typeof progressCb === 'function' ? progressCb : defaultProgressCb,
          };
          const result = await searchForAnswer(parsed.raw, searchOpts);
          if (result && !result.includes("couldn't find") && !result.includes("couldn't access")) {
            return result;
          }
          return 'I couldn\'t find a timetable or schedule in your files. Ã°Å¸â€œâ€¦ Make sure you have a schedule file saved on your device.';
        },
      };
    }

    case INTENTS.KNOWLEDGE_STATUS:
      {
        const kg = getKnowledgeGraphStats();
        return {
          text: `${getSearchStatus()}\n- Knowledge graph facts: ${kg.facts}\n- Knowledge graph nodes: ${kg.nodes}`,
          intent_tag: 'SEARCH',
          delay,
        };
      }

    case INTENTS.VISION: {
      return {
        text: 'Searching your images for that…',
        intent_tag: 'VISION',
        delay,
        asyncAction: async () => await searchImages(parsed.raw),
      };
    }

    case INTENTS.PLUGIN: {
      const lower = parsed.raw.toLowerCase();
      if (/list/.test(lower)) {
        const plugins = listPlugins();
        if (plugins.length === 0) return { text: 'No plugins installed. Say "install plugin Flashcards as I will drill you with {input}"', intent_tag: 'PLUGIN', delay };
        const lines = plugins.map(p => `- **${p.name}**: ${p.description || '(no description)'}`).join('\n');
        return { text: `Installed plugins:\n${lines}`, intent_tag: 'PLUGIN', delay };
      }

      const installMatch = parsed.raw.match(/install\s+plugin\s+(.+?)\s+as\s+(.+)/i);
      if (installMatch) {
        const name = installMatch[1].trim();
        const response = installMatch[2].trim();
        const plugin = installPlugin({ name, response, description: 'User-installed quick reply' });
        return { text: `Installed plugin **${plugin.name}**. Use "run plugin ${plugin.name} with <text>"`, intent_tag: 'PLUGIN', delay };
      }

      const runMatch = parsed.raw.match(/run\s+plugin\s+(.+?)(?:\s+with\s+(.+))?$/i);
      if (runMatch) {
        const name = runMatch[1].trim();
        const input = (runMatch[2] || '').trim();
        const result = runPlugin(name, input);
        if (!result) return { text: `Plugin "${name}" not found. Say "list plugins" to view installed ones.`, intent_tag: 'PLUGIN', delay };
        return { text: result.output || '(no output)', intent_tag: 'PLUGIN', delay };
      }

      const removeMatch = parsed.raw.match(/remove\s+plugin\s+(.+)/i);
      if (removeMatch) {
        const name = removeMatch[1].trim();
        removePlugin(name);
        return { text: `Removed plugin "${name}".`, intent_tag: 'PLUGIN', delay };
      }

      return {
        text: 'Plugin manager ready. Examples:\n- "list plugins"\n- "install plugin Flashcards as I will drill you with {input}"\n- "run plugin Flashcards with operating systems chapter 3"\n- "remove plugin Flashcards"',
        intent_tag: 'PLUGIN',
        delay,
      };
    }

    case INTENTS.WEATHER: {
      if (!isOnlineAllowed('weather')) {
        return {
          text: `${offlineBlockedMessage('weather')}\n\nI do not use local file search for live weather. Enable online mode and ask again for today's report.`,
          intent_tag: 'WEATHER',
          delay,
        };
      }
      if (!navigator.geolocation) {
        return { text: 'Location is not available on this device.', delay };
      }
      return {
        text: 'Ã°Å¸Å’Â¤Ã¯Â¸Â Checking the weather for you...', intent_tag: 'WEATHER', delay,
        asyncAction: async () => {
          try {
            const pos = await new Promise((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, maximumAge: 180000 });
            });
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            const result = await getWeather(lat, lon);
            return result;
          } catch {
            return 'I could not access your location. Enable location permission and try again.';
          }
        },
      };
    }

    case INTENTS.GO_ONLINE: {
      const enabled = optInToOnline();
      if (!enabled || isOfflineHardLocked()) {
        return {
          text: 'Offline-only mode is enforced. Internet access cannot be enabled in this build.',
          intent_tag: 'ONLINE_MODE',
          delay,
        };
      }
      return {
        text: '\uD83C\uDF10 Online mode enabled for this session. Weather and web search are now available. Say **"go offline"** anytime to disable.',
        intent_tag: 'ONLINE_MODE',
        delay,
      };
    }

    case INTENTS.GO_OFFLINE: {
      optOutOfOnline();
      return {
        text: isOfflineHardLocked()
          ? 'Offline-only mode is active. Network features remain disabled.'
          : '\uD83D\uDCF4 Offline mode restored. Network features are disabled again.',
        intent_tag: 'ONLINE_MODE',
        delay,
      };
    }

    case INTENTS.INTERNET_SEARCH: {
      if (!isOnlineAllowed('webSearch')) {
        const query = parsed.query || parsed.raw;
        return {
          text: `${offlineBlockedMessage('webSearch')}\n\nSearching your local files instead...`,
          intent_tag: 'SEARCH',
          delay,
          asyncAction: async (progressCb) => {
            const resolved = await resolveKnowledgeQuery(query, offlineSearchOpts, {
              preferOnline: false,
              progressCb: typeof progressCb === 'function' ? progressCb : defaultProgressCb,
            });
            return resolved.text;
          },
        };
      }

      const query = parsed.query || parsed.raw;
      return {
        text: 'Searching the web...',
        intent_tag: 'WEB_SEARCH',
        delay,
        asyncAction: async (progressCb) => {
          const liveProgressCb = typeof progressCb === 'function' ? progressCb : defaultProgressCb;
          const webResolved = await resolveKnowledgeQuery(query, offlineSearchOpts, {
            preferOnline: true,
            requireOnlineOnly: true,
            progressCb: liveProgressCb,
          });

          if (webResolved.source === 'web' || webResolved.source === 'web_weak') {
            return webResolved.text;
          }

          const offlineResolved = await resolveKnowledgeQuery(query, offlineSearchOpts, {
            preferOnline: false,
            progressCb: liveProgressCb,
          });
          if (offlineResolved.source !== 'none') {
            return `I could not get a strong internet answer. Here is a local result:\n\n${offlineResolved.text}`;
          }

          return webResolved.text;
        },
      };
    }

    case INTENTS.UNKNOWN: {
      return {
        text: 'I am sorry, I could not fully classify that request. I can continue chatting politely, or if you want document-based answers, please say: search my files for <topic>.',
        delay,
      };
    }

    default: {
      const query = parsed.raw;
      const preferOnline = isOnlineAllowed('webSearch') && isOnline();

      return {
        text: preferOnline
          ? 'Searching online first, then checking your files if needed...'
          : 'Searching your files...',
        intent_tag: 'SEARCH',
        delay,
        asyncAction: async (progressCb) => {
          const resolved = await resolveKnowledgeQuery(query, offlineSearchOpts, {
            preferOnline,
            progressCb: typeof progressCb === 'function' ? progressCb : defaultProgressCb,
          });
          return resolved.text;
        },
      };
    }
  }
}

/**
 * Safe math evaluator Ã¢â‚¬â€ pure recursive descent parser (no eval/Function)
 * Supports: +, -, *, /, **, %, parentheses, decimals, negative numbers
 */
function safeEvaluate(expr) {
  try {
    // First, try word math conversion
    let preprocessed = expr;
    if (/[a-zA-Z]/.test(expr) && !/^Math\./.test(expr)) {
      preprocessed = parseWordMath(expr);
    }

    // Handle Math.sqrt() inline before parsing
    while (preprocessed.includes('Math.sqrt(')) {
      const sqrtMatch = preprocessed.match(/Math\.sqrt\(([\d.]+)\)/);
      if (sqrtMatch) {
        const val = parseFloat(sqrtMatch[1]);
        const sqrtResult = Math.sqrt(val);
        const formatted = Number.isInteger(sqrtResult) ? sqrtResult.toString() : sqrtResult.toFixed(4).replace(/\.?0+$/, '');
        preprocessed = preprocessed.replace(sqrtMatch[0], formatted);
      } else {
        break;
      }
    }

    // Clean and validate the expression
    let cleaned = preprocessed
      .replace(/[×x]/gi, '*')
      .replace(/[÷]/g, '/')
      .replace(/\^/g, '**')
      .replace(/[^0-9+\-*/.()%\s]/g, '')
      .trim();

    if (!cleaned || cleaned.length > 200) {
      return { error: 'Invalid expression' };
    }

    // Tokenize
    const tokens = [];
    let i = 0;
    while (i < cleaned.length) {
      if (/\s/.test(cleaned[i])) { i++; continue; }

      // Number (including decimals)
      if (/[0-9.]/.test(cleaned[i])) {
        let num = '';
        while (i < cleaned.length && /[0-9.]/.test(cleaned[i])) {
          num += cleaned[i++];
        }
        tokens.push({ type: 'num', value: parseFloat(num) });
        if (isNaN(tokens[tokens.length - 1].value)) return { error: 'Invalid number' };
        continue;
      }

      // Operators
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

    // Recursive descent parser
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
        const exp = parsePower(); // right-associative
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

    // Format nicely
    const formatted = Number.isInteger(result) ? result.toString() : result.toFixed(4).replace(/\.?0+$/, '');
    return { value: formatted };
  } catch (e) {
    return { error: e.message || 'Could not parse expression' };
  }
}

/**
 * Unit conversion engine
 */
function convertUnit(value, from, to) {
  const conversions = {
    // Length
    'miles_km': 1.60934, 'miles_kilometers': 1.60934,
    'km_miles': 0.621371, 'kilometers_miles': 0.621371,
    'feet_meters': 0.3048, 'ft_m': 0.3048,
    'meters_feet': 3.28084, 'm_ft': 3.28084,
    'inches_cm': 2.54, 'in_cm': 2.54,
    'cm_inches': 0.393701, 'cm_in': 0.393701,
    // Weight
    'pounds_kg': 0.453592, 'lbs_kg': 0.453592, 'lb_kg': 0.453592,
    'kg_pounds': 2.20462, 'kg_lbs': 2.20462, 'kg_lb': 2.20462,
    'ounces_grams': 28.3495, 'oz_g': 28.3495,
    'grams_ounces': 0.035274, 'g_oz': 0.035274,
    // Temperature (special handling)
    'celsius_fahrenheit': null, 'c_f': null,
    'fahrenheit_celsius': null, 'f_c': null,
    // Volume
    'liters_gallons': 0.264172, 'l_gal': 0.264172,
    'gallons_liters': 3.78541, 'gal_l': 3.78541,
  };

  const key = `${from}_${to}`;
  const factor = conversions[key];

  if (factor === undefined) {
    return { error: true };
  }

  // Temperature special case
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

/**
 * Local file search with offline retrieval and ranking
 */











