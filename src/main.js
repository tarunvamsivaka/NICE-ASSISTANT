/**
 * Nice - Main Application Entry Point
 * Initializes all modules and wires up the interactive demo
 */

import './style.css';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  parseCommand,
  generateResponse,
  getLocalLlmRuntimeState,
  isLocalLlmEnabledPreference,
  setLocalLlmEnabledPreference,
} from './assistant.js';
import { speak, setTTSEnabled, setTTSSpeed, refreshInstalledAppsCatalog } from './actions.js';
import {
  loadFileIndex,
  getIndexedFileCount,
  autoRescanFromSavedHandle,
  grantFolderAccess,
  checkStoragePermission,
  runIncrementalIndexMaintenance,
  openFile,
  searchFiles,
  findFileById,
  findExactFileByName,
} from './filesys.js';
import { hasSearchableFiles, extractAttachedFileText, invalidateSearchCaches } from './search-engine.js';
import { getPolicyState, optInToOnline, optOutOfOnline, isOfflineHardLocked } from './policy.js';
import { MIC_STATES, setMicState, canStartActiveListening, resetMicState } from './mic-arbiter.js';
import {
  recordTaskObservation,
  getPersonalizedCommandSuggestions,
  getLearningStatus,
  getLearningConsent,
  setLearningConsent,
} from './usage-learning.js';
import { getProactiveSuggestions } from './proactive-engine.js';
import { getRuntimePerformanceProfile, initPerformanceGovernor } from './performance-governor.js';
import { initWaveform } from './animations.js';

// ===== DOM REFERENCES =====
const chatWindow = document.getElementById('chatWindow');
const commandInput = document.getElementById('commandInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const waveformContainer = document.getElementById('waveformContainer');

// ===== STATE =====
let isProcessing = false;
let activeProcessingCount = 0;
let waveform = null; // Initialized by initWaveform() after DOMContentLoaded
let isListening = false;

// ===== FILE ATTACHMENT STATE =====
let attachedFile = null;       // The File object
let attachedFileContent = '';  // The read text content
let fileContextActive = false; // Whether questions should target the file

// ===== PWA STATE =====
let deferredInstallPrompt = null;
const installBanner = document.getElementById('installBanner');
const installBtn = document.getElementById('installBtn');
const installDismiss = document.getElementById('installDismiss');

// ===== SPEECH RECOGNITION STATE =====
let recognition = null;
let recognitionTimeout = null;
let whisperReady = false; // Track whether Whisper ML loaded successfully
let whisperInitTimer = null;
let whisperInitAttempted = false;
let whisperRetryCount = 0;
const LOW_END_DEVICE = (() => {
  const mem = Number(navigator?.deviceMemory || 0);
  const cores = Number(navigator?.hardwareConcurrency || 0);
  const isNative = !!(window?.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform());
  const memoryKnown = Number.isFinite(mem) && mem > 0;
  const coresKnown = Number.isFinite(cores) && cores > 0;

  // On native WebView, unknown hardware signals should fail-safe to low-end profile.
  if (isNative && (!memoryKnown || !coresKnown)) return true;

  return (memoryKnown && mem <= 4) || (coresKnown && cores <= 4);
})();
let pendingChatScroll = false;
let filePickerBusy = false;
const pendingCommandQueue = [];
const MAX_PENDING_COMMANDS = 6;
let queueDrainTimer = null;
let lastSuggestionsAt = 0;
const SUGGESTION_MIN_INTERVAL_MS = 320;
let lastUiInteractionTs = Date.now();

function markUiInteraction() {
  lastUiInteractionTs = Date.now();
}

function isUiIdleFor(minIdleMs = 0) {
  const requiredIdleMs = Math.max(0, Number(minIdleMs) || 0);
  return (Date.now() - lastUiInteractionTs) >= requiredIdleMs;
}

function safeMatchMedia(query) {
  try {
    return !!(window.matchMedia && window.matchMedia(query).matches);
  } catch {
    return false;
  }
}

function setProcessingState(next) {
  if (next) {
    activeProcessingCount += 1;
  } else {
    activeProcessingCount = Math.max(0, activeProcessingCount - 1);
  }
  isProcessing = activeProcessingCount > 0;
  if (sendBtn) {
    // Keep send enabled so users can submit a new query while another one is running.
    sendBtn.disabled = false;
    sendBtn.setAttribute('aria-busy', isProcessing ? 'true' : 'false');
  }
  if (commandInput) {
    commandInput.readOnly = false;
  }
}

function getMaxConcurrentCommandTasks() {
  const perf = getRuntimePerformanceProfile();
  if (LOW_END_DEVICE) return 1;
  if (perf?.native) {
    return perf.tier === 'high' && perf.energyMode === 'performance' ? 2 : 1;
  }
  if (perf?.tier === 'high') return 3;
  return 2;
}

function scheduleQueuedCommandDrain(delayMs = 120) {
  if (queueDrainTimer || pendingCommandQueue.length === 0) return;
  const safeDelay = Math.max(0, Number(delayMs) || 0);
  queueDrainTimer = setTimeout(async () => {
    queueDrainTimer = null;
    if (pendingCommandQueue.length === 0) return;
    if (activeProcessingCount >= getMaxConcurrentCommandTasks()) {
      scheduleQueuedCommandDrain(180);
      return;
    }

    const next = pendingCommandQueue.shift();
    if (!next) return;

    try {
      await processInput(next);
    } catch (e) {
      console.warn('[Nice] Queued command failed:', e?.message || e);
    }

    if (pendingCommandQueue.length > 0) {
      scheduleQueuedCommandDrain(60);
    }
  }, safeDelay);
}

function getMaxRenderedChatMessages() {
  const perf = getRuntimePerformanceProfile();
  if (LOW_END_DEVICE) return 18;
  if (perf?.native) {
    return perf.tier === 'high' && perf.energyMode === 'performance' ? 32 : 22;
  }
  return 48;
}

function pruneRenderedChatMessages() {
  if (!chatWindow) return;
  const maxRendered = getMaxRenderedChatMessages();
  const nodes = chatWindow.querySelectorAll('.chat-msg');
  const overflow = nodes.length - maxRendered;
  if (overflow <= 0) return;
  for (let i = 0; i < overflow; i += 1) {
    nodes[i]?.remove();
  }
}

function queueChatScrollToBottom() {
  if (pendingChatScroll || !chatWindow) return;
  pendingChatScroll = true;
  requestAnimationFrame(() => {
    pendingChatScroll = false;
    chatWindow.scrollTop = chatWindow.scrollHeight;
  });
}

function scheduleBackgroundTask(task, { delay = 0, timeout = 2500 } = {}) {
  const runner = () => {
    try {
      const result = task();
      // Catch rejections from async tasks (returned promises)
      if (result && typeof result.catch === 'function') {
        result.catch((e) => {
          console.warn('[Nice] Async background task failed:', e?.message || e);
        });
      }
    } catch (e) {
      console.warn('[Nice] Background task failed:', e?.message || e);
    }
  };

  setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(runner, { timeout });
      return;
    }
    setTimeout(runner, 0);
  }, Math.max(0, delay));
}

function shouldRunAutoRescan(indexedCount) {
  if (indexedCount <= 0) return true;
  const lastScanTs = Number(localStorage.getItem('nice_last_scan_ts') || '0');
  if (!Number.isFinite(lastScanTs) || lastScanTs <= 0) return true;
  const elapsed = Date.now() - lastScanTs;
  const thresholdMs = LOW_END_DEVICE ? 6 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
  return elapsed >= thresholdMs;
}

// ===== SPLASH SCREEN =====
function dismissSplash() {
  const splash = document.getElementById('splashScreen');
  const appShell = document.getElementById('assistantApp');
  if (!splash) {
    if (appShell) appShell.classList.add('app-ready');
    showWelcome();
    return;
  }
  // Mobile-first splash timing with reduced motion and low-perf awareness.
  const prefersReducedMotion = safeMatchMedia('(prefers-reduced-motion: reduce)');
  const isMobileViewport = safeMatchMedia('(max-width: 768px)');
  const lowPerfShell = document.documentElement.classList.contains('low-perf') || document.documentElement.classList.contains('reduced-motion');
  const nativePlatform = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const fastNativeSplash = nativePlatform && (lowPerfShell || isMobileViewport || prefersReducedMotion);

  const splashDuration = fastNativeSplash
    ? 80
    : prefersReducedMotion
      ? 360
      : isMobileViewport
        ? (lowPerfShell ? 460 : 620)
        : (lowPerfShell ? 700 : 1200);
  const splashExitDelay = fastNativeSplash ? 80 : (isMobileViewport ? 280 : 360);

  setTimeout(() => {
    splash.classList.add('splash-hide');
    if (appShell) appShell.classList.add('app-ready');
    setTimeout(() => {
      splash.remove();
      showWelcome();
    }, splashExitDelay);
  }, splashDuration);
}

// ===== WELCOME GREETING =====
function showWelcome() {
  const greetingEl = document.getElementById('welcomeGreeting');
  const subtextEl = document.getElementById('welcomeSubtext');
  const dateEl = document.getElementById('welcomeDate');
  if (!greetingEl) return;

  const hour = new Date().getHours();
  let greeting;
  if (hour < 5) greeting = 'Good night';
  else if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';
  else if (hour < 21) greeting = 'Good evening';
  else greeting = 'Good night';

  greetingEl.textContent = greeting;
  if (subtextEl) {
    subtextEl.textContent = 'Private on-device assistant ready. Ask anything, search files, or control your phone.';
  }
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    });
  }
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
  initPerformanceGovernor();
  optimizeForDevice();
  dismissSplash();
  registerServiceWorker();
  setupInstallPrompt();

  // Initialize waveform animation for voice recording UI
  waveform = initWaveform();

  const startupPerf = getRuntimePerformanceProfile();
  const startupLowNative = !!startupPerf?.native && startupPerf.tier !== 'high';
  // Restore chat history off the critical startup path.
  scheduleBackgroundTask(() => {
    loadChatHistory();
  }, {
    delay: startupLowNative ? 1100 : 450,
    timeout: 1500,
  });

  // Auto-load file index from IndexedDB after first paint.
  scheduleBackgroundTask(() => {
    loadFileIndex().then(count => {
      if (count > 0) {
        console.log(`[Nice] Loaded ${count} indexed files`);
      }
      // Don't auto-call grantFolderAccess on startup - let the permission modal handle it
    });
  }, {
    delay: startupLowNative ? 1800 : 250,
    timeout: startupLowNative ? 2200 : 1400,
  });

  // ===== ONE-TIME PERMISSION REQUEST (first launch only) =====
  async function requestAllPermissionsOnce() {
    if (!Capacitor.isNativePlatform()) return;

    if (localStorage.getItem('nice_permissions_flow_v1') === 'complete') {
      return;
    }
    localStorage.setItem('nice_permissions_flow_v1', 'complete');

    await refreshStoragePermissionState();

    // Defer initial indexing to protect launch smoothness.
    if (getIndexedFileCount() > 0) return;

    const perf = getRuntimePerformanceProfile();
    const deferredIndexDelayMs = perf?.tier === 'low' ? 22000 : 14000;

    scheduleBackgroundTask(async () => {
      if (isProcessing || isListening) return;
      try {
        let result = await autoRescanFromSavedHandle();
        if (!result?.success) {
          result = await grantFolderAccess();
        }
        if (result?.success) {
          console.log('[Nice] Indexed ' + result.count + ' files after deferred native permission flow');
        } else {
          console.warn('[Nice] Deferred file indexing unavailable:', result?.message || 'permission missing');
        }
      } catch (e) {
        console.warn('[Nice] Deferred initial indexing error:', e);
      }

      await refreshStoragePermissionState();
    }, {
      delay: deferredIndexDelayMs,
      timeout: 9000,
    });
  }

  // Start periodic file-change detection after startup settles.
  scheduleBackgroundTask(() => startFileWatcher(), {
    delay: startupLowNative ? 20000 : 6000,
    timeout: 2200,
  });

  // Request all permissions on first launch after initial UI settles.
  scheduleBackgroundTask(() => requestAllPermissionsOnce(), {
    delay: 1800,
    timeout: 3000,
  });

  // Auto-rescan only when needed; defer to avoid competing with first interaction.
  scheduleBackgroundTask(async () => {
    if (isProcessing || isListening) return;
    const minIdleMs = LOW_END_DEVICE ? 45000 : 20000;
    if (!document.hidden && !isUiIdleFor(minIdleMs)) return;

    const indexedCount = getIndexedFileCount();
    if (!shouldRunAutoRescan(indexedCount)) return;

    const rescan = await autoRescanFromSavedHandle();
    if (rescan.success) {
      console.log(`[Nice] Auto-rescanned ${rescan.count} files from saved directory`);
    }
    await refreshStoragePermissionState();
  }, {
    delay: LOW_END_DEVICE ? 26000 : 18000,
    timeout: LOW_END_DEVICE ? 10000 : 6000,
  });

  // Warm known installed-app catalog so "open <app>" resolves faster and avoids false negatives.
  scheduleBackgroundTask(async () => {
    try {
      const installed = await refreshInstalledAppsCatalog(false);
      if (installed.length > 0) {
        console.log(`[Nice] Installed app catalog ready (${installed.length} known apps)`);
      }
    } catch (e) {
      console.warn('[Nice] Installed app catalog warmup failed:', e);
    }
  }, {
    delay: LOW_END_DEVICE ? 28000 : 9000,
    timeout: LOW_END_DEVICE ? 8000 : 5000,
  });

  // ===== CHAT EVENT HANDLERS =====
  // Form submit (prevents page reload!)
  const chatForm = document.getElementById('chatForm');
  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      processInput();
    });
  }
  if (chatWindow) {
    chatWindow.addEventListener('click', handleChatWindowClick);
    chatWindow.addEventListener('scroll', () => markUiInteraction(), { passive: true });
  }

  document.addEventListener('touchstart', () => markUiInteraction(), { passive: true });
  document.addEventListener('mousedown', () => markUiInteraction(), { passive: true });
  document.addEventListener('keydown', () => markUiInteraction(), { passive: true });

  // Settings gear toggle
  const settingsGearBtn = document.getElementById('settingsGearBtn');
  const settingsDrawer = document.getElementById('settingsDrawer');
  const settingsCloseBtn = document.getElementById('settingsCloseBtn');
  if (settingsGearBtn && settingsDrawer) {
    settingsGearBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevents touch from bubbling and instantly closing
      settingsDrawer.classList.toggle('open');
    });
  }
  if (settingsCloseBtn && settingsDrawer) {
    settingsCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsDrawer.classList.remove('open');
    });
  }

  // File attachment
  const attachBtn = document.getElementById('attachBtn');
  const fileAttachInput = document.getElementById('fileAttachInput');
  if (attachBtn && fileAttachInput) {
    attachBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await openFilePicker(fileAttachInput);
    });
    fileAttachInput.addEventListener('change', handleFileAttach);
  }

  // File preview remove
  const filePreviewRemove = document.getElementById('filePreviewRemove');
  if (filePreviewRemove) {
    filePreviewRemove.addEventListener('click', clearFileAttachment);
  }

  // Settings: Dark mode toggle
  const darkModeToggle = document.getElementById('settingDarkMode');
  if (darkModeToggle) {
    const isDark = localStorage.getItem('nice_dark_mode') !== 'false';
    darkModeToggle.checked = isDark;
    if (!isDark) document.body.classList.add('light-theme');
    darkModeToggle.addEventListener('change', () => {
      document.body.classList.toggle('light-theme', !darkModeToggle.checked);
      localStorage.setItem('nice_dark_mode', darkModeToggle.checked);
    });
  }

  // Settings: Font size
  const fontSizeSlider = document.getElementById('settingFontSize');
  const fontSizeLabel = document.getElementById('fontSizeLabel');
  if (fontSizeSlider) {
    const saved = localStorage.getItem('nice_font_size') || '100';
    fontSizeSlider.value = saved;
    document.documentElement.style.fontSize = saved + '%';
    if (fontSizeLabel) fontSizeLabel.textContent = saved + '%';
    const updateFont = () => {
      document.documentElement.style.fontSize = fontSizeSlider.value + '%';
      if (fontSizeLabel) fontSizeLabel.textContent = fontSizeSlider.value + '%';
      localStorage.setItem('nice_font_size', fontSizeSlider.value);
    };
    fontSizeSlider.addEventListener('input', updateFont);
    fontSizeSlider.addEventListener('change', updateFont);
  }
  // Settings: Voice speed
  const voiceSpeedSlider = document.getElementById('settingVoiceSpeed');
  const speedLabel = document.getElementById('speedLabel');
  if (voiceSpeedSlider) {
    const savedSpeed = Number(localStorage.getItem('nice_voice_speed') || '1.0');
    const initialSpeed = Number.isFinite(savedSpeed) ? savedSpeed : 1.0;
    voiceSpeedSlider.value = String(initialSpeed);
    setTTSSpeed(initialSpeed);
    if (speedLabel) speedLabel.textContent = initialSpeed.toFixed(1) + 'x';

    const updateSpeed = () => {
      const speed = Number(voiceSpeedSlider.value || '1.0');
      setTTSSpeed(speed);
      if (speedLabel) speedLabel.textContent = speed.toFixed(1) + 'x';
      try { localStorage.setItem('nice_voice_speed', String(speed)); } catch { }
    };
    voiceSpeedSlider.addEventListener('input', updateSpeed);
    voiceSpeedSlider.addEventListener('change', updateSpeed);
  }

  // Settings: Update stats
  updateSettingsStats();
  setupPolicyControls();
  setupLearningControls();
  setupLocalLlmControls();
  updateBubbleState('Inactive');
  refreshStoragePermissionState();

  window.addEventListener('nice:index-updated', () => {
    updateSettingsStats();
    refreshStoragePermissionState();
  });

  window.addEventListener('nice:performance-updated', () => {
    startFileWatcher();
    showSuggestions();
  });

  window.addEventListener('nice:bubble-state', (event) => {
    const next = event?.detail?.state || 'Inactive';
    updateBubbleState(next);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshStoragePermissionState();
      return;
    }
    // Free in-memory search caches while app is backgrounded to reduce RAM pressure.
    scheduleBackgroundTask(() => invalidateSearchCaches(), {
      delay: 1200,
      timeout: 1800,
    });
  });

  // Speech recognition
  if (!LOW_END_DEVICE) {
    scheduleBackgroundTask(() => initWhisperWorker(), {
      delay: 2500,
      timeout: 8000,
    });
  }
  if (micBtn) {
    micBtn.addEventListener('click', () => {
      if (!whisperInitAttempted) initWhisperWorker();
      toggleListening();
    });
  }

  // NOTE: showWelcome() is already called by dismissSplash() - no need to call it again.
});

// ===== PROCESS USER INPUT =====
async function processInput(queuedRawInput = null) {
  const isQueuedInvocation = typeof queuedRawInput === 'string';
  const rawInput = isQueuedInvocation
    ? String(queuedRawInput || '').trim()
    : (commandInput?.value?.trim?.() || '');
  const multimodalRequest = /^(?:scan|analy[sz]e|read|extract)\s+(?:an?\s+)?(?:image|photo|screenshot|document)\b/i.test(rawInput)
    || /^(?:camera\s+ocr|ocr\s+camera|analy[sz]e\s+screenshot)$/i.test(rawInput);

  if (!isQueuedInvocation && rawInput) {
    const maxConcurrent = getMaxConcurrentCommandTasks();
    if (activeProcessingCount >= maxConcurrent) {
      if (pendingCommandQueue.length >= MAX_PENDING_COMMANDS) {
        addMessage('assistant', `I am still processing earlier requests. Please wait a moment and try again.`);
        return;
      }
      pendingCommandQueue.push(rawInput);
      if (commandInput) commandInput.value = '';
      addMessage('assistant', `Queued your request (#${pendingCommandQueue.length}). I will process it shortly.`);
      scheduleQueuedCommandDrain(120);
      return;
    }
  }

  if (multimodalRequest && !isProcessing) {
    setProcessingState(true);
    if (!isQueuedInvocation && commandInput) commandInput.value = '';
    try {
      addMessage('user', rawInput);
      const picker = document.getElementById('fileAttachInput');
      if (!picker) {
        addMessage('assistant', 'Image capture is not available on this screen.');
        return;
      }
      await openFilePicker(picker, { imageOnly: true, preferCamera: true });
      addMessage('assistant', 'Capture or select an image, then press Send to run offline OCR and ask questions from it.');
    } catch (err) {
      console.warn('[Nice] Multimodal picker failed:', err?.message || err);
      addMessage('assistant', 'Could not open camera/file picker. Please try attaching an image manually.');
    } finally {
      setProcessingState(false);
      if (!isQueuedInvocation && commandInput) commandInput.focus();
      scheduleQueuedCommandDrain(60);
    }
    return;
  }

  // If a file is attached but no text entered, trigger file analysis.
  if (!rawInput && attachedFile && !fileContextActive && !isProcessing) {
    setProcessingState(true);
    if (!isQueuedInvocation && commandInput) commandInput.value = '';

    const welcome = document.getElementById('chatWelcome');
    if (welcome) { welcome.style.display = 'none'; welcome.classList.add('hidden'); }

    addMessage('user', `Attached: ${attachedFile.name}`);
    const typingEl = showTyping();

    try {
      attachedFileContent = await extractAttachedFileText(attachedFile);
      if (!attachedFileContent) {
        throw new Error('Could not extract readable text from this file.');
      }

      fileContextActive = true;
      const lines = attachedFileContent.split('\n').length;
      const words = attachedFileContent.split(/\s+/).filter(w => w).length;
      const preview = attachedFileContent.substring(0, 200).replace(/\n/g, ' ');

      const text = `I've analyzed **${attachedFile.name}**.\n\n` +
        `**File Stats:**\n- ${lines} lines, ${words} words\n\n` +
        `**Preview:**\n> ${preview}${attachedFileContent.length > 200 ? '...' : ''}\n\n` +
        `I'm ready to answer questions about this file.\n\n` +
        `_Say **"clear file"** to stop focusing on this file._`;

      const msgEl = addMessage('assistant', '', true);
      const bubble = msgEl.querySelector('.msg-bubble');
      bubble.innerHTML = formatMarkdown(text);
      chatMessages.push({ role: 'assistant', content: toHistoryContent(normalizeDisplayText(text)), ts: Date.now() });
      saveChatHistory();
      speakSafe(`I've analyzed ${attachedFile.name}. It has ${lines} lines and ${words} words.`);
    } catch (error) {
      console.warn('[Nice] File analysis failed:', error?.message || error);
      addMessage('assistant', "I couldn't read that file. Please try another supported file.");
      clearFileAttachment();
    } finally {
      if (typingEl && typingEl.isConnected) typingEl.remove();
      setProcessingState(false);
      if (!isQueuedInvocation && commandInput) commandInput.focus();
      scheduleQueuedCommandDrain(60);
    }

    return;
  }

  if (!rawInput) return;

  const input = rawInput.length > 2000 ? rawInput.substring(0, 2000) : rawInput;
  setProcessingState(true);
  if (!isQueuedInvocation && commandInput) commandInput.value = '';

  let typingEl = null;
  let parsed = null;
  let commandStartedAt = 0;
  let assistantHistoryIndex = -1;

  try {
    // Clear file context command.
    if (/^(?:clear\s+file|remove\s+file|forget\s+file|stop\s+file|exit\s+file|done\s+with\s+file)$/i.test(input)) {
      clearFileAttachment();
      const welcome = document.getElementById('chatWelcome');
      if (welcome) { welcome.style.display = 'none'; welcome.classList.add('hidden'); }
      addMessage('user', input);
      const msgEl = addMessage('assistant', '', true);
      const bubble = msgEl.querySelector('.msg-bubble');
      bubble.innerHTML = formatMarkdown("File context cleared. I'm back to normal mode. How can I help?");
      chatMessages.push({ role: 'assistant', content: 'File context cleared. I am back to normal mode.', ts: Date.now() });
      saveChatHistory();
      speakSafe('File context cleared.');
      return;
    }

    // If file context is active, answer from file content.
    if (fileContextActive && attachedFileContent) {
      const welcome = document.getElementById('chatWelcome');
      if (welcome) { welcome.style.display = 'none'; welcome.classList.add('hidden'); }
      addMessage('user', input);
      typingEl = showTyping();
      await sleep(200);
      if (typingEl && typingEl.isConnected) typingEl.remove();
      typingEl = null;

      const answer = answerFromFileContext(input, attachedFileContent, attachedFile?.name || 'file');
      const msgEl = addMessage('assistant', '', true);
      const bubble = msgEl.querySelector('.msg-bubble');
      bubble.innerHTML = formatMarkdown(answer);
      chatMessages.push({ role: 'assistant', content: toHistoryContent(normalizeDisplayText(answer)), ts: Date.now() });
      saveChatHistory();
      speakSafe(answer.replace(/[*#_>|`]/g, '').substring(0, 300));
      showSuggestions();
      return;
    }

    // Normal request flow.
    const welcome = document.getElementById('chatWelcome');
    if (welcome) { welcome.style.display = 'none'; welcome.classList.add('hidden'); }

    addMessage('user', input);
    typingEl = showTyping();

    parsed = parseCommand(input);
    commandStartedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const response = await generateResponse(parsed);
    const responseText = normalizeDisplayText(response?.text || 'I could not generate a response.');
    const responseResultBlock = response?.result_block ? normalizeDisplayText(response.result_block) : null;

    await sleep(response?.delay || 100);

    if (typingEl && typingEl.isConnected) typingEl.remove();
    typingEl = null;

    let html = formatMarkdown(responseText);
    if (response?.intent_tag) {
      html += `<div class="msg-intent">${sanitizeHTML(response.intent_tag)}</div>`;
    }
    if (responseResultBlock) {
      html += `<div class="msg-result">${sanitizeHTML(responseResultBlock)}</div>`;
    }

    const msgEl = addMessage('assistant', '', true);
    const bubble = msgEl.querySelector('.msg-bubble');
    bubble.innerHTML = html;

    assistantHistoryIndex = chatMessages.push({ role: 'assistant', content: toHistoryContent(responseText), ts: Date.now() }) - 1;
    saveChatHistory();

    if (response?.asyncAction) {
      try {
        const progressWriter = createAsyncProgressWriter(bubble, response.intent_tag);
        const intentTag = String(response?.intent_tag || '').toUpperCase();
        const isLongRunningSearchFlow = intentTag === 'SEARCH' || intentTag === 'FILE_SEARCH';
        const explicitTimeoutMs = Number(response?.asyncTimeoutMs);
        const hasExplicitTimeout = Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0;
        const shouldDisableTimeout = isLongRunningSearchFlow || explicitTimeoutMs === 0;

        let asyncResult;
        if (shouldDisableTimeout) {
          asyncResult = await response.asyncAction(progressWriter);
        } else {
          const asyncTimeoutMs = hasExplicitTimeout ? explicitTimeoutMs : 240000;
          asyncResult = await runWithTimeout(
            response.asyncAction(progressWriter),
            asyncTimeoutMs,
            'assistant_async',
          );
        }
        if (asyncResult) {
          const normalizedAsyncResult = normalizeDisplayText(asyncResult);
          if (shouldStreamAssistantText(response.intent_tag, normalizedAsyncResult)) {
            await streamAssistantResult(bubble, normalizedAsyncResult, response.intent_tag);
          } else {
            setAssistantBubbleText(bubble, normalizedAsyncResult, response.intent_tag);
          }
          if (assistantHistoryIndex >= 0 && chatMessages[assistantHistoryIndex]?.role === 'assistant') {
            chatMessages[assistantHistoryIndex].content = toHistoryContent(normalizedAsyncResult);
            saveChatHistory();
          }
          speakSafe(normalizedAsyncResult);
        } else {
          speakSafe(responseText);
        }
        trackTaskLearning(parsed, true, commandStartedAt);
      } catch (error) {
        const message = String(error?.message || '');
        if (message.includes('assistant_async_timeout')) {
          bubble.innerHTML = formatMarkdown('This task took too long and was safely stopped. Please try a more specific request.');
        } else {
          bubble.innerHTML = formatMarkdown('Something went wrong. Please try again.');
        }
        console.warn('[Nice] Async action failed:', error?.message || error);
        trackTaskLearning(parsed, false, commandStartedAt);
      }
    } else {
      speakSafe(responseText);
      trackTaskLearning(parsed, true, commandStartedAt);
    }

    showSuggestions();
  } catch (error) {
    console.error('[Nice] processInput failed:', error);
    if (typingEl && typingEl.isConnected) typingEl.remove();
    addMessage('assistant', 'I ran into an issue processing that request. Please try again.');
    trackTaskLearning(parsed, false, commandStartedAt);
  } finally {
    setProcessingState(false);
    if (!isQueuedInvocation && commandInput) commandInput.focus();
    scheduleQueuedCommandDrain(80);
  }
}

function parseInlineOpenFileHref(rawHref) {
  try {
    const parsed = new URL(String(rawHref || ''), window.location.origin);
    if (parsed.pathname !== '/__nice_open_file__') return null;
    const fileId = parsed.searchParams.get('id') || '';
    const fileName = parsed.searchParams.get('name') || '';
    if (!fileId && !fileName) return null;
    const chunkHash = parsed.searchParams.get('chunk') || '';
    const chunkIndexRaw = parsed.searchParams.get('chunkIndex');
    const chunkIndex = Number.isFinite(Number(chunkIndexRaw)) ? Number(chunkIndexRaw) : null;
    const query = parsed.searchParams.get('q') || '';
    const snippet = parsed.searchParams.get('snippet') || '';
    return { fileId, fileName, chunkHash, chunkIndex, query, snippet };
  } catch {
    return null;
  }
}

async function openInlineSearchResultFile({
  fileId,
  fileName,
  chunkHash = '',
  chunkIndex = null,
  query = '',
  snippet = '',
}) {
  let fileEntry = null;

  if (fileId) {
    fileEntry = findFileById(fileId);
  }
  if (!fileEntry && fileName) {
    fileEntry = findExactFileByName(fileName);
  }
  if (!fileEntry && fileName) {
    const fallbackMatches = searchFiles(fileName);
    fileEntry = fallbackMatches.length > 0 ? fallbackMatches[0] : null;
  }

  if (!fileEntry) {
    addMessage('assistant', `I could not find "${fileName || 'that file'}" in the current index. Try running "scan my files" again.`);
    return;
  }

  setProcessingState(true);
  try {
    const highlight = {
      chunkHash,
      chunkIndex,
      query,
      snippet,
    };
    const result = await openFile(fileEntry, { highlight });
    addMessage('assistant', result?.message || `Opened **${fileEntry.name}**.`);
  } catch (error) {
    addMessage('assistant', `I couldn't open **${fileEntry.name}** right now. ${error?.message || ''}`.trim());
  } finally {
    setProcessingState(false);
  }
}

async function handleChatWindowClick(event) {
  const target = event?.target;
  if (!(target instanceof Element)) return;

  const copyBtn = target.closest('.copy-code-btn');
  if (copyBtn) {
    const container = copyBtn.closest('.code-block-container');
    const codeEl = container ? container.querySelector('code') : null;
    if (codeEl) {
      try {
        await navigator.clipboard.writeText(codeEl.textContent || '');
        const prevText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = prevText;
          copyBtn.classList.remove('copied');
        }, 2000);
      } catch (err) {
        console.warn('[Nice] Copy code failed:', err);
      }
    }
    return;
  }

  const link = target.closest('a[href]');
  if (!link) return;

  const action = parseInlineOpenFileHref(link.getAttribute('href'));
  if (!action) return;

  event.preventDefault();
  event.stopPropagation();
  await openInlineSearchResultFile(action);
}

// ===== HELPERS =====
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runWithTimeout(promiseLike, timeoutMs, label = 'operation') {
  const safeTimeoutMs = Math.max(1, Number(timeoutMs) || 1);
  let timeoutId = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`${label}_timeout`)), safeTimeoutMs);
    });
    return await Promise.race([promiseLike, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

const CP1252_UNICODE_TO_BYTE = new Map([
  ['\u20AC', 0x80], ['\u201A', 0x82], ['\u0192', 0x83], ['\u201E', 0x84],
  ['\u2026', 0x85], ['\u2020', 0x86], ['\u2021', 0x87], ['\u02C6', 0x88],
  ['\u2030', 0x89], ['\u0160', 0x8A], ['\u2039', 0x8B], ['\u0152', 0x8C],
  ['\u017D', 0x8E], ['\u2018', 0x91], ['\u2019', 0x92], ['\u201C', 0x93],
  ['\u201D', 0x94], ['\u2022', 0x95], ['\u2013', 0x96], ['\u2014', 0x97],
  ['\u02DC', 0x98], ['\u2122', 0x99], ['\u0161', 0x9A], ['\u203A', 0x9B],
  ['\u0153', 0x9C], ['\u017E', 0x9E], ['\u0178', 0x9F],
]);

const MOJIBAKE_HINT_RE = /(?:[\u00C2\u00C3\u00E2\u00F0][\u0080-\u00BF]|\uFFFD)/;
const MOJIBAKE_SCORE_RE = /(?:[\u00C2\u00C3\u00E2\u00F0][\u0080-\u00BF]|\uFFFD)/g;

function toCP1252Bytes(str) {
  const bytes = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xFF) {
      bytes.push(cp);
      continue;
    }
    const mapped = CP1252_UNICODE_TO_BYTE.get(ch);
    if (mapped === undefined) return null;
    bytes.push(mapped);
  }
  return bytes;
}

function decodeMojibakeOnce(str) {
  const bytes = toCP1252Bytes(str);
  if (!bytes) return str;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return str;
  }
}

function mojibakeScore(str) {
  const matches = str.match(MOJIBAKE_SCORE_RE);
  return matches ? matches.length : 0;
}

function repairMojibake(str) {
  let out = str;
  for (let i = 0; i < 2; i += 1) {
    if (!MOJIBAKE_HINT_RE.test(out)) break;
    const decoded = decodeMojibakeOnce(out);
    if (!decoded || decoded === out) break;
    if (mojibakeScore(decoded) <= mojibakeScore(out)) {
      out = decoded;
      continue;
    }
    break;
  }
  return out;
}

function normalizeDisplayText(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);

  // Normalize line endings first, then repair UTF-8/CP1252 mojibake.
  text = text.replace(/\r\n/g, '\n');
  text = repairMojibake(text);

  // Remove control chars, but keep valid Unicode symbols (including emoji).
  text = text
    .replace(/\uFFFD/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[\u007F-\u009F]/g, '');

  // Keep whitespace readable.
  text = text.replace(/[ \t]{2,}/g, ' ');

  return text;
}

function speakSafe(text) {
  speak(normalizeDisplayText(text));
}

function getLearningEntity(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';
  switch (parsed.intent) {
    case 'LAUNCH_APP':
      return parsed.app || '';
    case 'SET_ALARM':
      return parsed.time || '';
    case 'SET_TIMER':
      return parsed.duration || '';
    case 'CALENDAR':
      return parsed.event || '';
    case 'MEDIA':
      return parsed.song || parsed.action || '';
    case 'NOTE':
      return parsed.content || '';
    case 'FILE_SEARCH':
      return parsed.file || parsed.raw || '';
    case 'OPEN_FILE':
      return parsed.file || '';
    case 'ASK_KNOWLEDGE':
      return parsed.question || parsed.raw || '';
    case 'BRAIN_PLAN':
      return `steps:${Array.isArray(parsed.steps) ? parsed.steps.length : 0}`;
    default:
      return '';
  }
}

function trackTaskLearning(parsed, success, startedAt = 0) {
  if (!parsed || typeof parsed !== 'object' || !parsed.intent) return;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const base = Number.isFinite(startedAt) ? startedAt : now;
  const latencyMs = Math.max(0, Math.round(now - base));
  try {
    recordTaskObservation({
      rawInput: parsed.raw || '',
      intent: parsed.intent,
      success: !!success,
      latencyMs,
      entity: getLearningEntity(parsed),
    });
  } catch {
    // Usage learning must remain non-blocking.
  }
}

function formatAsyncProgressText(stage, current, total, detail) {
  const safeStage = String(stage || '').toLowerCase();
  const currentValue = Number.isFinite(current) ? current : 0;
  const totalValue = Number.isFinite(total) ? total : 0;
  const detailLabel = typeof detail === 'string' ? detail : '';
  const detailPayload = detail && typeof detail === 'object' ? detail : null;

  if (safeStage === 'preview' && detailPayload?.text) {
    return detailPayload.text;
  }

  if (safeStage === 'start') {
    return 'Starting offline search...';
  }

  if (safeStage === 'analyze') {
    return detailPayload?.text || 'Analyzing your request for offline search...';
  }

  if (safeStage === 'scan') {
    const percent = totalValue > 0
      ? Math.min(100, Math.round((currentValue / totalValue) * 100))
      : 0;
    const activeName = detailLabel || detailPayload?.fileName || '';
    const activeLine = activeName ? `\n_Current: ${activeName}_` : '';
    return `Searching local files... **${percent}%** (${currentValue}/${totalValue})${activeLine}`;
  }

  if (safeStage === 'queued') {
    const position = Math.max(1, currentValue || 1);
    return `Search queue is busy. Waiting for slot #${position}...`;
  }

  if (safeStage === 'rerank') {
    return `Refining best matches... (${currentValue}/${totalValue})`;
  }

  if (safeStage === 'done') {
    const contentHits = Number(detailPayload?.contentHits || 0);
    const filenameHits = Number(detailPayload?.filenameHits || 0);
    if (contentHits > 0 || filenameHits > 0) {
      return `Finalizing offline answer from top matches... (content: ${contentHits}, filename: ${filenameHits})`;
    }
    return 'Finalizing offline answer from local files...';
  }

  return null;
}

function renderPlainBubble(bubble, text, intentTag, className = 'msg-progress') {
  const normalizedText = normalizeDisplayText(text);
  bubble.textContent = '';

  const body = document.createElement('div');
  body.className = className;
  body.textContent = normalizedText;
  bubble.appendChild(body);

  if (intentTag) {
    const intent = document.createElement('div');
    intent.className = 'msg-intent';
    intent.textContent = String(intentTag);
    bubble.appendChild(intent);
  }
}

function shouldUseFastTextRender(text, intentTag = '') {
  const normalized = normalizeDisplayText(text);
  const perf = getRuntimePerformanceProfile();
  if (!perf?.native) return false;

  const lowTierNative = LOW_END_DEVICE || perf.tier !== 'high' || perf.energyMode !== 'performance';
  if (!lowTierNative) return false;

  const lineCount = (normalized.match(/\n/g)?.length || 0) + 1;
  const tag = String(intentTag || '').toUpperCase();

  if (tag === 'SEARCH' || tag === 'FILE_SEARCH' || tag === 'WEB_SEARCH') {
    return normalized.length > 1200 || lineCount > 36;
  }

  return normalized.length > 1800 || lineCount > 54;
}

function renderProgressBubble(bubble, text, intentTag, markdown = false) {
  const normalizedText = normalizeDisplayText(text);
  if (markdown) {
    bubble.innerHTML = formatMarkdown(normalizedText);
    if (intentTag) {
      bubble.innerHTML += `<div class="msg-intent">${sanitizeHTML(intentTag)}</div>`;
    }
    return;
  }

  renderPlainBubble(bubble, normalizedText, intentTag, 'msg-progress');
}

function createAsyncProgressWriter(bubble, intentTag) {
  let lastUpdateAt = 0;
  let lastScanValue = -1;
  let lastScanPercent = -1;
  let lastRenderedText = '';

  const perf = getRuntimePerformanceProfile();
  const minScanIntervalMs = perf?.native ? (LOW_END_DEVICE ? 900 : 420) : 150;
  const minOtherIntervalMs = perf?.native ? (LOW_END_DEVICE ? 520 : 260) : 90;
  const minScanDeltaPercent = perf?.native && LOW_END_DEVICE ? 2 : 1;

  return (stage, current, total, detail) => {
    const now = Date.now();
    const safeStage = String(stage || '').toLowerCase();

    if (safeStage === 'scan') {
      const scanPercent = total > 0 ? Math.min(100, Math.round((Number(current || 0) / Number(total || 1)) * 100)) : -1;
      if (current === lastScanValue && scanPercent === lastScanPercent) return;
      const percentDelta = (scanPercent >= 0 && lastScanPercent >= 0)
        ? Math.abs(scanPercent - lastScanPercent)
        : 100;
      if ((now - lastUpdateAt) < minScanIntervalMs && percentDelta < minScanDeltaPercent) return;
      lastScanValue = current;
      lastScanPercent = scanPercent;
    } else if ((now - lastUpdateAt) < minOtherIntervalMs && safeStage !== 'preview' && safeStage !== 'done') {
      return;
    }

    const text = formatAsyncProgressText(safeStage, current, total, detail);
    if (!text) return;
    const normalizedText = normalizeDisplayText(text);
    if (normalizedText === lastRenderedText && safeStage !== 'done') return;

    lastRenderedText = normalizedText;
    lastUpdateAt = now;

    const useMarkdown = safeStage === 'preview' || safeStage === 'done';
    renderProgressBubble(bubble, normalizedText, intentTag, useMarkdown);
  };
}

const STREAMING_INTENT_TAGS = new Set(['SEARCH', 'FILE_SEARCH', 'WEB_SEARCH']);

function setAssistantBubbleText(bubble, text, intentTag) {
  const normalizedText = normalizeDisplayText(text);
  if (shouldUseFastTextRender(normalizedText, intentTag)) {
    renderPlainBubble(bubble, normalizedText, intentTag, 'msg-plain');
    return;
  }

  bubble.innerHTML = formatMarkdown(normalizedText);
  if (intentTag) {
    bubble.innerHTML += `<div class="msg-intent">${sanitizeHTML(intentTag)}</div>`;
  }
}

function shouldStreamAssistantText(intentTag, text) {
  const perf = getRuntimePerformanceProfile();
  if (!perf.ui.streamAssistantText || LOW_END_DEVICE) return false;
  if (perf.native && perf.energyMode !== 'performance') return false;
  const tag = String(intentTag || '').toUpperCase();
  if (!STREAMING_INTENT_TAGS.has(tag)) return false;
  const normalized = normalizeDisplayText(text);
  if (perf.native && normalized.length > 2400) return false;
  return normalized.length >= 120;
}

async function streamAssistantResult(bubble, text, intentTag) {
  const normalized = normalizeDisplayText(text);
  const totalLen = normalized.length;
  if (totalLen === 0) {
    setAssistantBubbleText(bubble, normalized, intentTag);
    return;
  }

  const perf = getRuntimePerformanceProfile();
  const nativeMode = !!perf?.native;
  const chunkSize = nativeMode
    ? (totalLen > 3000 ? 420 : totalLen > 1500 ? 320 : 240)
    : (totalLen > 3000 ? 240 : totalLen > 1500 ? 160 : 100);
  const frameDelayMs = nativeMode ? 28 : 18;
  let cursor = 0;

  while (cursor < totalLen) {
    cursor = Math.min(totalLen, cursor + chunkSize);
    bubble.textContent = normalized.slice(0, cursor);
    await sleep(frameDelayMs);
  }

  setAssistantBubbleText(bubble, normalized, intentTag);
}

function showTyping() {
  const msg = document.createElement('div');
  msg.className = 'chat-msg assistant';
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = 'N';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  msg.appendChild(avatar);
  msg.appendChild(bubble);
  chatWindow.appendChild(msg);
  pruneRenderedChatMessages();
  queueChatScrollToBottom();
  return msg;
}

function sanitizeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function answerFromFileContext(question, content, filename) {
  const q = String(question || '').toLowerCase().trim();
  const lines = String(content || '').split('\n');
  const words = String(content || '').split(/\s+/).filter(w => w);

  if (/how many lines|line count|total lines/i.test(q)) {
    return `**${filename}** has **${lines.length}** lines.`;
  }
  if (/how many words|word count|total words/i.test(q)) {
    return `**${filename}** has **${words.length}** words.`;
  }

  const sentenceChunks = String(content || '')
    .replace(/\r/g, '\n')
    .split(/[\n.?!]+/g)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => s.length >= 12);

  const stop = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'for', 'of', 'and', 'or', 'in', 'on', 'at',
    'what', 'where', 'when', 'who', 'why', 'how', 'tell', 'show', 'find', 'about', 'please', 'my',
  ]);
  const terms = q
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !stop.has(t));

  if (/summarize|summary|overview|what is this/i.test(q)) {
    const preview = sentenceChunks.slice(0, 4).join('. ').trim();
    return `**Summary from ${filename}**\n\n${preview}${preview ? '.' : ''}\n\nConfidence: 60%`;
  }

  const scored = sentenceChunks.map((sentence, idx) => {
    const hay = sentence.toLowerCase();
    let hits = 0;
    for (const term of terms) {
      if (hay.includes(term)) hits += 1;
    }
    const density = terms.length > 0 ? (hits / terms.length) : 0;
    const score = (hits * 2) + density + (sentence.length > 240 ? -0.4 : 0);
    return { sentence, idx: idx + 1, hits, density, score };
  }).filter(item => item.hits > 0);

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 4);

  if (top.length === 0) {
    return `I searched **${filename}** but could not find a reliable match for that question.\n\nTry using exact terms from the file or ask for a summary.`;
  }

  const overlap = terms.length > 0 ? (top[0].hits / terms.length) : 0.5;
  const confidence = Math.max(35, Math.min(92, Math.round((overlap * 65) + 25)));
  const answerLines = top.slice(0, 2).map(item => item.sentence);
  const evidenceLines = top.map((item, i) => `${i + 1}. Line ${item.idx}: ${item.sentence}`);

  return `**Answer from ${filename}**\n\n${answerLines.join('\n\n')}\n\nConfidence: ${confidence}%\n\nEvidence:\n${evidenceLines.join('\n')}`;
}

async function openFilePicker(fileInput, opts = {}) {
  if (!fileInput || filePickerBusy) return;
  filePickerBusy = true;
  const imageOnly = opts?.imageOnly === true;
  const preferCamera = opts?.preferCamera === true;
  const originalAccept = fileInput.getAttribute('accept');
  const originalCapture = fileInput.getAttribute('capture');

  if (imageOnly) {
    fileInput.setAttribute('accept', 'image/*,.jpg,.jpeg,.png,.webp,.bmp');
    if (preferCamera) fileInput.setAttribute('capture', 'environment');
  }

  try {
    // File System Access API first when available.
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const pickerOpts = {
          multiple: false,
          excludeAcceptAllOption: false,
        };
        if (imageOnly) {
          pickerOpts.types = [{
            description: 'Images',
            accept: {
              'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.bmp'],
            },
          }];
        }
        const [handle] = await window.showOpenFilePicker({
          ...pickerOpts,
        });
        if (handle) {
          const file = await handle.getFile();
          applyAttachedFile(file);
          return;
        }
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.warn('[Nice] showOpenFilePicker failed:', error?.message || error);
        }
      }
    }

    // Native picker path in some Chromium builds.
    if (typeof fileInput.showPicker === 'function') {
      try {
        fileInput.showPicker();
        return;
      } catch (error) {
        console.warn('[Nice] fileInput.showPicker failed:', error?.message || error);
      }
    }

    // Android WebView fallback.
    try {
      fileInput.click();
    } catch (error) {
      console.warn('[Nice] File picker click failed:', error?.message || error);
      addMessage('assistant', 'Unable to open file picker. Please retry and check storage permission.');
    }
  } finally {
    if (imageOnly) {
      if (originalAccept === null) fileInput.removeAttribute('accept');
      else fileInput.setAttribute('accept', originalAccept);
      if (originalCapture === null) fileInput.removeAttribute('capture');
      else fileInput.setAttribute('capture', originalCapture);
    }
    setTimeout(() => {
      filePickerBusy = false;
    }, 220);
  }
}
function applyAttachedFile(file) {
  if (!file) return;
  attachedFile = file;
  attachedFileContent = '';
  fileContextActive = false;

  const preview = document.getElementById('filePreview');
  const nameEl = document.getElementById('filePreviewName');
  const attachBtn = document.getElementById('attachBtn');

  if (preview) preview.style.display = 'flex';
  if (nameEl) nameEl.textContent = file.name;
  if (attachBtn) attachBtn.classList.add('has-file');

  if (commandInput) {
    commandInput.placeholder = `Ask about ${file.name} or press Send to analyze...`;
    commandInput.focus();
  }
}

function handleFileAttach(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  applyAttachedFile(file);
}

function clearFileAttachment() {
  attachedFile = null;
  attachedFileContent = '';
  fileContextActive = false;

  const preview = document.getElementById('filePreview');
  const input = document.getElementById('fileAttachInput');
  const attachBtn = document.getElementById('attachBtn');

  if (preview) preview.style.display = 'none';
  if (input) input.value = '';
  if (attachBtn) attachBtn.classList.remove('has-file');

  if (commandInput) {
    commandInput.placeholder = 'Ask me anything...';
  }
}

function updateSettingsStats() {
  const filesEl = document.getElementById('statFilesIndexed');
  const scanEl = document.getElementById('statLastScan');
  if (filesEl) filesEl.textContent = localStorage.getItem('nice_file_count') || '0';
  if (scanEl) scanEl.textContent = localStorage.getItem('nice_last_scan') || 'Never';
  updateLearningStateLabel();
  updateLocalLlmStateLabel();
}

function updateOnlineModeStateLabel() {
  const label = document.getElementById('statOnlineMode');
  if (!label) return;
  if (isOfflineHardLocked()) {
    label.textContent = 'Offline Locked';
    return;
  }
  const policy = getPolicyState();
  label.textContent = policy.onlineSessionOptIn ? 'Enabled (session)' : 'Disabled';
}

function setupPolicyControls() {
  const toggle = document.getElementById('settingOnlineMode');
  updateOnlineModeStateLabel();
  if (!toggle) return;
  if (isOfflineHardLocked()) {
    toggle.checked = false;
    toggle.disabled = true;
    toggle.title = 'Offline-only build';
  }

  const syncToggle = () => {
    toggle.checked = !isOfflineHardLocked() && getPolicyState().onlineSessionOptIn;
    updateOnlineModeStateLabel();
  };

  syncToggle();
  toggle.addEventListener('change', () => {
    if (isOfflineHardLocked()) {
      toggle.checked = false;
      syncToggle();
      return;
    }
    if (toggle.checked) {
      optInToOnline();
    } else {
      optOutOfOnline();
    }
    syncToggle();
  });

  window.addEventListener('nice:policy-updated', syncToggle);
}

function updateLearningStateLabel() {
  const label = document.getElementById('statLearningState');
  if (!label) return;
  const status = getLearningStatus();
  label.textContent = status.enabled
    ? `Enabled (${status.intentsTracked} intents)`
    : 'Disabled';
}

function setupLearningControls() {
  const toggle = document.getElementById('settingAutoLearn');
  if (!toggle) return;

  const sync = () => {
    toggle.checked = getLearningConsent();
    updateLearningStateLabel();
  };

  sync();
  toggle.addEventListener('change', () => {
    setLearningConsent(!!toggle.checked);
    sync();
  });

  window.addEventListener('nice:learning-policy-updated', sync);
}

function localLlmReasonLabel(reason) {
  switch (reason) {
    case 'allowed':
      return 'Enabled';
    case 'disabled_by_user':
      return 'Disabled';
    case 'low_battery':
      return 'Paused (low battery)';
    case 'unknown_device_capability':
      return 'Unavailable (device capability unknown)';
    case 'low_memory_tier':
      return 'Paused (low memory)';
    case 'low_cpu_tier':
      return 'Paused (low CPU)';
    default:
      return 'Paused';
  }
}

function updateLocalLlmStateLabel() {
  const label = document.getElementById('statLocalLlmState');
  if (!label) return;
  const state = getLocalLlmRuntimeState();
  label.textContent = localLlmReasonLabel(state.reason);
}

function setupLocalLlmControls() {
  const toggle = document.getElementById('settingLocalLlm');
  if (!toggle) return;

  const sync = () => {
    toggle.checked = isLocalLlmEnabledPreference();
    updateLocalLlmStateLabel();
  };

  sync();
  toggle.addEventListener('change', () => {
    setLocalLlmEnabledPreference(!!toggle.checked);
    sync();
  });

  window.addEventListener('nice:local-llm-policy-updated', sync);
  window.addEventListener('nice:performance-updated', updateLocalLlmStateLabel);
}

function updateBubbleState(text) {
  const el = document.getElementById('statBubbleState');
  if (el) el.textContent = normalizeDisplayText(text);
}

function updatePermissionState(text) {
  const el = document.getElementById('statPermissionState');
  if (el) el.textContent = normalizeDisplayText(text);
}

async function refreshStoragePermissionState() {
  try {
    const granted = await checkStoragePermission();
    updatePermissionState(granted ? 'Granted' : 'Permission Required');
    localStorage.setItem('nice_storage_granted', granted ? 'true' : 'false');
    return granted;
  } catch (e) {
    console.warn('[Nice] Permission state refresh failed:', e?.message || e);
    const fallbackGranted = localStorage.getItem('nice_storage_granted') === 'true';
    updatePermissionState(fallbackGranted ? 'Granted' : 'Permission Required');
    return fallbackGranted;
  }
}


// ===== CHAT HISTORY PERSISTENCE =====
const CHAT_STORAGE_KEY = 'nice_chat_history';
const MAX_CHAT_HISTORY = 50;
const MAX_IN_MEMORY_MESSAGES = 200;
const MAX_HISTORY_ENTRY_CHARS = 2800;
const CHAT_HISTORY_SAVE_DEBOUNCE_MS_NATIVE = 380;
const CHAT_HISTORY_SAVE_DEBOUNCE_MS_WEB = 180;
let chatMessages = [];
let chatHistorySaveTimer = null;

function toHistoryContent(text) {
  const normalized = normalizeDisplayText(text);
  if (normalized.length <= MAX_HISTORY_ENTRY_CHARS) return normalized;
  return `${normalized.slice(0, MAX_HISTORY_ENTRY_CHARS)}…`;
}

function getHistoryPersistLimit() {
  const perf = getRuntimePerformanceProfile();
  if (LOW_END_DEVICE && perf?.native) return 24;
  if (perf?.native) return 36;
  return MAX_CHAT_HISTORY;
}

function persistChatHistoryNow() {
  try {
    const limit = Math.max(12, getHistoryPersistLimit());
    const toSave = chatMessages.slice(-limit).map((m) => ({
      ...m,
      content: toHistoryContent(m.content),
    }));
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(toSave));
  } catch { /* storage full - silently ignore */ }
}

function saveChatHistory() {
  if (chatHistorySaveTimer) clearTimeout(chatHistorySaveTimer);
  const perf = getRuntimePerformanceProfile();
  const debounceMs = perf?.native ? CHAT_HISTORY_SAVE_DEBOUNCE_MS_NATIVE : CHAT_HISTORY_SAVE_DEBOUNCE_MS_WEB;
  chatHistorySaveTimer = setTimeout(() => {
    chatHistorySaveTimer = null;
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => persistChatHistoryNow(), { timeout: 1200 });
      return;
    }
    setTimeout(() => persistChatHistoryNow(), 0);
  }, debounceMs);
}

function loadChatHistory() {
  try {
    const stored = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!stored) return false;
    const msgs = JSON.parse(stored);
    if (!Array.isArray(msgs) || msgs.length === 0) return false;

    // Restore messages to DOM in one fragment to avoid repeated layout work.
    const fragment = document.createDocumentFragment();
    const maxRendered = getMaxRenderedChatMessages();
    const restored = msgs.slice(-maxRendered);
    for (const m of restored) {
      const msg = document.createElement('div');
      msg.className = `chat-msg ${m.role}`;
      const avatar = document.createElement('div');
      avatar.className = 'msg-avatar';
      avatar.textContent = m.role === 'user' ? 'U' : 'N';
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      bubble.innerHTML = formatMarkdown(m.content);
      msg.appendChild(avatar);
      msg.appendChild(bubble);
      fragment.appendChild(msg);
    }
    chatWindow.appendChild(fragment);
    chatMessages = msgs.slice(-MAX_CHAT_HISTORY);
    pruneRenderedChatMessages();
    queueChatScrollToBottom();
    return true;
  } catch {
    return false;
  }
}

function addMessage(role, content, empty = false) {
  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'user' ? 'U' : 'N';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (!empty) {
    const normalizedContent = normalizeDisplayText(content);
    bubble.innerHTML = formatMarkdown(normalizedContent);
    // Save to chat history
    chatMessages.push({ role, content: toHistoryContent(normalizedContent), ts: Date.now() });
    saveChatHistory();
  }

  msg.appendChild(avatar);
  msg.appendChild(bubble);
  chatWindow.appendChild(msg);
  pruneRenderedChatMessages();
  queueChatScrollToBottom();

  // Cap in-memory chat messages to prevent unbounded memory growth
  if (chatMessages.length > MAX_IN_MEMORY_MESSAGES) {
    chatMessages = chatMessages.slice(-MAX_IN_MEMORY_MESSAGES);
  }

  // Show smart suggestions after assistant messages
  if (role === 'assistant' && !empty && content.length > 0) {
    showSuggestions();
  }

  return msg;
}

// ===== SMART SUGGESTION CHIPS =====
const SUGGESTION_SETS = [
  ['What time is it?', 'Play a song', 'Set a timer'],
  ['Search my files', 'Open calculator', 'Take a note'],
  ['Scan my files', 'What can you do?', 'Tell me a joke'],
  ['My schedule today', 'Set an alarm', 'Battery status'],
];

function showSuggestions() {
  if (!chatWindow) return;

  const perf = getRuntimePerformanceProfile();
  if (perf?.native && perf.energyMode !== 'performance') {
    return;
  }
  if (activeProcessingCount > 0 && LOW_END_DEVICE) {
    return;
  }

  const now = Date.now();
  const minInterval = (LOW_END_DEVICE || perf?.native)
    ? Math.max(900, SUGGESTION_MIN_INTERVAL_MS)
    : SUGGESTION_MIN_INTERVAL_MS;
  if ((now - lastSuggestionsAt) < minInterval) return;
  lastSuggestionsAt = now;

  // Remove any existing suggestions
  const old = chatWindow.querySelector('.suggestion-chips');
  if (old) old.remove();

  const container = document.createElement('div');
  container.className = 'suggestion-chips';
  const suggestionLimit = Math.max(3, Number(perf?.ui?.suggestionLimit || 3));
  const proactive = getProactiveSuggestions({ limit: suggestionLimit });
  const personalized = getPersonalizedCommandSuggestions({ limit: suggestionLimit });
  const set = proactive.length >= 3
    ? proactive.slice(0, suggestionLimit)
    : (personalized.length >= 3
      ? personalized.slice(0, suggestionLimit)
      : SUGGESTION_SETS[Math.floor(Math.random() * SUGGESTION_SETS.length)]);

  for (const text of set) {
    const chip = document.createElement('button');
    chip.className = 'suggestion-chip';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      container.remove();
      const inputEl = document.getElementById('commandInput');
      if (inputEl) {
        inputEl.value = text;
        processInput();
      }
    });
    container.appendChild(chip);
  }

  chatWindow.appendChild(container);
  queueChatScrollToBottom();
}



// ===== REAL VOICE RECOGNITION (Offline Whisper ML) =====

let whisperWorker = null;
let mediaRecorder = null;
let audioChunks = [];
let audioStream = null;

function initWhisperWorker() {
  if (whisperWorker && whisperInitAttempted) return;
  whisperInitAttempted = true;

  const resetWhisper = () => {
    if (whisperInitTimer) {
      clearTimeout(whisperInitTimer);
      whisperInitTimer = null;
    }
    if (whisperWorker) {
      try { whisperWorker.terminate(); } catch { }
      whisperWorker = null;
    }
    whisperReady = false;
  };

  const retryWhisperInit = () => {
    if (whisperRetryCount >= 1) return;
    whisperRetryCount += 1;
    resetWhisper();
    setTimeout(() => initWhisperWorker(), 250);
  };

  try {
    whisperWorker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });

    whisperWorker.onmessage = (e) => {
      const { type, message, text, error } = e.data;

      if (type === 'status') {
        updateListeningStatus(message, true);
        return;
      }
      if (type === 'ready') {
        if (whisperInitTimer) {
          clearTimeout(whisperInitTimer);
          whisperInitTimer = null;
        }
        console.log('[Nice] Whisper ML engine ready');
        whisperReady = true;
        updateListeningStatus('Voice engine ready.', false);
        return;
      }
      if (type === 'result') {
        commandInput.value = text;
        commandInput.style.fontStyle = '';
        commandInput.style.opacity = '';
        updateListeningStatus('', false);
        setMicState(MIC_STATES.IDLE, 'transcription_complete');

        if (text.trim().length > 0) {
          setTimeout(() => processInput(), 150);
        } else {
          updateListeningStatus("Didn't catch that. Tap mic to try again.", false);
        }
        setProcessingState(false);
        return;
      }
      if (type === 'error') {
        console.error('[Nice] Whisper worker returned error:', error);
        whisperReady = false;
        updateListeningStatus('Voice model unavailable. Falling back to built-in speech recognition.', false);
        setProcessingState(false);
        setMicState(MIC_STATES.IDLE, 'whisper_error');
        commandInput.style.fontStyle = '';
        commandInput.style.opacity = '';
        commandInput.value = '';
        retryWhisperInit();
      }
    };

    whisperWorker.onerror = (err) => {
      console.warn('[Nice] Whisper worker failed:', err?.message || err);
      whisperReady = false;
      retryWhisperInit();
    };

    whisperInitTimer = setTimeout(() => {
      if (!whisperReady) {
        console.warn('[Nice] Whisper init timed out. Falling back to Web Speech API.');
        retryWhisperInit();
      }
    }, 12000);

    whisperWorker.postMessage({ type: 'init' });
  } catch (err) {
    console.warn('[Nice] Could not create Whisper worker:', err);
    whisperReady = false;
    retryWhisperInit();
  }
}

// ===== WEB SPEECH API FALLBACK =====
function startWebSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    updateListeningStatus('Speech recognition is not supported on this device.', false);
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  commandInput.value = '';
  commandInput.placeholder = 'Listening... speak now';
  commandInput.style.fontStyle = 'italic';
  commandInput.style.opacity = '0.7';

  isListening = true;
  setMicState(MIC_STATES.LISTENING, 'web_speech');
  micBtn.classList.add('listening');
  waveformContainer.classList.add('active');
  if (waveform) waveform.start();
  updateListeningStatus('Listening...', true);

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    commandInput.value = transcript;
    commandInput.style.fontStyle = '';
    commandInput.style.opacity = '';
    updateListeningStatus('', false);

    if (transcript.trim().length > 0) {
      setTimeout(() => processInput(), 150);
    } else {
      updateListeningStatus("Didn't catch that. Tap mic to try again.", false);
    }
    setMicState(MIC_STATES.IDLE, 'web_speech_result');
  };

  recognition.onerror = (event) => {
    console.warn('[Nice] Web Speech API error:', event.error);
    if (event.error === 'not-allowed') {
      updateListeningStatus('Microphone access denied. Please allow microphone permission.', false);
    } else if (event.error === 'no-speech') {
      updateListeningStatus("Didn't hear anything. Tap mic to try again.", false);
    } else {
      updateListeningStatus('Speech recognition error. Try again.', false);
    }
    stopListening();
  };

  recognition.onend = () => {
    stopListening();
  };

  try {
    recognition.start();
  } catch (err) {
    console.warn('[Nice] Web Speech API failed to start:', err?.message || err);
    stopListening();
    return false;
  }

  // Safety timeout - auto stop after 15 seconds.
  recognitionTimeout = setTimeout(() => {
    if (isListening && recognition) {
      recognition.stop();
      stopListening();
    }
  }, 15000);

  return true;
}

async function resumeWakeWordListenerSafely(reason) {
  if (localStorage.getItem('nice_wake_word') !== 'true') {
    setMicState(MIC_STATES.IDLE, reason || 'wake_word_not_enabled');
    return;
  }
  try {
    const { resumeWakeWord } = await import('./wake-word.js');
    resumeWakeWord();
    setMicState(MIC_STATES.WAKE_WORD, reason || 'wake_word_resumed');
  } catch {
    setMicState(MIC_STATES.IDLE, 'wake_word_resume_failed');
  }
}
async function waitForWhisperReady(timeoutMs = 2200) {
  const startedAt = Date.now();
  while (!whisperReady && (Date.now() - startedAt) < timeoutMs) {
    await sleep(120);
  }
  return whisperReady;
}

async function toggleListening() {
  if (isProcessing) return;

  if (isListening) {
    stopListening();
    return;
  }

  if (!canStartActiveListening()) {
    updateListeningStatus('Microphone is busy. Please wait a moment and try again.', false);
    return;
  }

  // Cancel any ongoing TTS to prevent voice mixing
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();

  // Temporarily pause wake word to avoid microphone contention.
  try {
    const { pauseWakeWord } = await import('./wake-word.js');
    pauseWakeWord();
    setMicState(MIC_STATES.WAKE_WORD, 'paused_for_active_listening');
  } catch {
    // Ignore wake-word pause failures.
  }

  // Always request microphone stream first.
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.warn('[Nice] Microphone access denied:', err);
    updateListeningStatus('Microphone access denied. Please allow microphone permission in Settings > Apps > NICE ASSISTANT > Permissions.', false);
    await resumeWakeWordListenerSafely('mic_access_denied');
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  // Whisper first when available.
  initWhisperWorker();
  if (!whisperReady) {
    const perf = getRuntimePerformanceProfile();
    const warmupMs = perf?.native ? 2600 : 1400;
    await waitForWhisperReady(warmupMs);
  }
  if (whisperReady) {
    commandInput.value = '';
    commandInput.placeholder = 'Listening... speak now';
    commandInput.style.fontStyle = 'italic';
    commandInput.style.opacity = '0.7';

    isListening = true;
    setMicState(MIC_STATES.LISTENING, 'whisper_recording');
    micBtn.classList.add('listening');
    waveformContainer.classList.add('active');
    if (waveform) waveform.start();
    updateListeningStatus('Listening...', true);

    mediaRecorder = new MediaRecorder(audioStream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      if (audioChunks.length === 0) {
        setProcessingState(false);
        await resumeWakeWordListenerSafely('whisper_empty_audio');
        return;
      }

      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      audioChunks = [];

      try {
        updateListeningStatus('Processing voice...', true);
        setProcessingState(true);
        setMicState(MIC_STATES.PROCESSING, 'whisper_transcribe');

        const arrayBuffer = await blob.arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        let offlineAudio;
        if (audioBuffer.numberOfChannels === 2) {
          const dataL = audioBuffer.getChannelData(0);
          const dataR = audioBuffer.getChannelData(1);
          offlineAudio = new Float32Array(dataL.length);
          for (let i = 0; i < dataL.length; i += 1) {
            offlineAudio[i] = (dataL[i] + dataR[i]) / 2;
          }
        } else {
          offlineAudio = audioBuffer.getChannelData(0);
        }

        whisperWorker.postMessage({ type: 'transcribe', audio: offlineAudio });
        // Close the temporary AudioContext to prevent resource leaks on Android
        audioContext.close().catch(() => { });
      } catch (err) {
        console.error('[Nice] Audio decoding error:', err);
        updateListeningStatus('Failed to process audio recording.', false);
        setProcessingState(false);
        await resumeWakeWordListenerSafely('decode_failed');
      }
    };

    mediaRecorder.start();

    recognitionTimeout = setTimeout(() => {
      if (isListening) {
        stopListening();
      }
    }, 20000);

    return;
  }

  // Web Speech fallback on all supported platforms, including native Android WebView.
  if (SpeechRecognition) {
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
    }
    console.log('[Nice] Using Web Speech API fallback');
    const started = startWebSpeechRecognition();
    if (started) {
      return;
    }
  }

  // Final fallback: avoid entering a dead-end recording mode without transcription support.
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }
  updateListeningStatus('Voice engine is still loading. Please tap mic again in a moment, or type your request.', false);
  commandInput.style.fontStyle = '';
  commandInput.style.opacity = '';
  commandInput.placeholder = 'Ask me anything...';
  await resumeWakeWordListenerSafely('voice_engine_not_ready');
}

function stopListening() {
  if (!isListening) return;
  isListening = false;
  setMicState(MIC_STATES.IDLE, 'stop_listening');

  micBtn.classList.remove('listening');
  waveformContainer.classList.remove('active');
  if (waveform) waveform.stop();
  commandInput.placeholder = 'Ask me anything...';

  if (recognitionTimeout) {
    clearTimeout(recognitionTimeout);
    recognitionTimeout = null;
  }

  // Stop the recorder and trigger the onstop processor
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  // Stop Web Speech API if active
  if (recognition) {
    try { recognition.stop(); } catch { }
    recognition = null;
  }

  // Turn off hardware microphone
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }

  // Resume the background wake word listener
  if (localStorage.getItem('nice_wake_word') === 'true') {
    import('./wake-word.js').then(({ resumeWakeWord }) => {
      resumeWakeWord();
      setMicState(MIC_STATES.WAKE_WORD, 'wake_word_resumed');
    }).catch(() => {
      setMicState(MIC_STATES.IDLE, 'wake_word_resume_failed');
    });
  } else {
    setMicState(MIC_STATES.IDLE, 'wake_word_not_enabled');
  }
}

function updateListeningStatus(message, isActive) {
  // Find or create the status element
  let statusEl = document.getElementById('listeningStatus');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'listeningStatus';
    statusEl.className = 'listening-status';
    const inputArea = document.querySelector('.input-area');
    if (inputArea) {
      inputArea.insertBefore(statusEl, inputArea.firstChild);
    }
  }

  statusEl.textContent = message;
  statusEl.classList.toggle('active', isActive);

  // Auto-hide non-active messages after 4 seconds
  if (!isActive && message) {
    setTimeout(() => {
      if (statusEl && !statusEl.classList.contains('active')) {
        statusEl.textContent = '';
      }
    }, 4000);
  }
}

// ===== UTILITIES =====

/** Escape HTML special characters to prevent XSS */

/** Format markdown safely - sanitize first, then apply limited formatting. */
function decodeHtmlEntities(text) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(text || '');
  return textarea.value;
}

function sanitizeLinkHref(rawHref) {
  const decoded = decodeHtmlEntities(rawHref).trim();
  if (!decoded) return null;

  const lower = decoded.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('file:') || lower.startsWith('blob:')) {
    return null;
  }

  try {
    const parsed = new URL(decoded, window.location.origin);
    const allowedProtocols = new Set(['https:', 'http:', 'mailto:', 'tel:']);
    if (!allowedProtocols.has(parsed.protocol)) return null;
    return sanitizeHTML(parsed.href);
  } catch {
    return null;
  }
}

function formatMarkdown(text) {
  const normalized = normalizeDisplayText(text);
  let html = sanitizeHTML(normalized)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

  html = html.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,2048})\)/g, (_m, label, href) => {
    const safeHref = sanitizeLinkHref(href);
    if (!safeHref) {
      return `${label} (${sanitizeHTML(decodeHtmlEntities(href))})`;
    }
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
  });

  return html.replace(/\n/g, '<br>');
}

// ===== SERVICE WORKER =====
function registerServiceWorker() {
  if (window.Capacitor?.isNativePlatform?.()) return;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('[Nice] Service Worker registered - scope:', reg.scope);
      })
      .catch((err) => {
        console.warn('[Nice] Service Worker registration failed:', err);
      });
  }
}

// ===== PWA INSTALL PROMPT =====
function setupInstallPrompt() {
  // Capture the install prompt event
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;

    // Show the install banner after a short delay
    setTimeout(() => {
      if (installBanner) {
        installBanner.classList.add('visible');
      }
    }, 3000);
  });

  // Install button click
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;

      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      console.log('[Nice] Install prompt outcome:', outcome);

      deferredInstallPrompt = null;
      if (installBanner) {
        installBanner.classList.remove('visible');
      }
    });
  }

  // Dismiss button
  if (installDismiss) {
    installDismiss.addEventListener('click', () => {
      if (installBanner) {
        installBanner.classList.remove('visible');
      }
    });
  }

  // Detect if already installed
  window.addEventListener('appinstalled', () => {
    console.log('[Nice] App installed successfully!');
    deferredInstallPrompt = null;
    if (installBanner) {
      installBanner.classList.remove('visible');
    }
  });
}

// NOTE: Permission onboarding (setupPermissions) was removed - superseded by
// requestAllPermissionsOnce() and native MainActivity permission prompts.

// ===== DEVICE OPTIMIZATION =====
function optimizeForDevice() {
  const isMobile = window.innerWidth <= 768;
  const cores = Number(navigator.hardwareConcurrency || 0);
  const memoryGb = Number(navigator.deviceMemory || 0);
  const isLowEnd =
    (Number.isFinite(cores) && cores > 0 && cores <= 6)
    || (Number.isFinite(memoryGb) && memoryGb > 0 && memoryGb <= 6);
  const prefersReduced = safeMatchMedia('(prefers-reduced-motion: reduce)');
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  if (isMobile || isLowEnd || isNative) {
    document.documentElement.classList.add('low-perf');
  }

  if (isNative) {
    document.documentElement.classList.add('native-app');
  }

  if (prefersReduced) {
    document.documentElement.classList.add('reduced-motion');
  }

  if ('ontouchstart' in window) {
    document.documentElement.classList.add('touch-device');
  }
}

// ===== PAGE UNLOAD CLEANUP =====
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Nice] Unhandled promise rejection:', event?.reason || event);
  if (isProcessing) {
    setProcessingState(false);
  }
});

window.addEventListener('error', () => {
  if (isProcessing) {
    setTimeout(() => setProcessingState(false), 0);
  }
});
window.addEventListener('beforeunload', () => {
  // Stop speech synthesis
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }

  // Stop speech recognition
  try { if (recognition) recognition.abort(); } catch { }
  if (recognitionTimeout) clearTimeout(recognitionTimeout);
  persistChatHistoryNow();
  resetMicState();
});

// ===== WEB UI PERMISSION MODALS REMOVED (Favoring Native Onboarding) =====

// ===== FILE CHANGE WATCHER =====
let fileWatcherInterval = null;
let lastKnownFileCount = 0;

function startFileWatcher() {
  lastKnownFileCount = getIndexedFileCount();
  if (fileWatcherInterval) {
    clearInterval(fileWatcherInterval);
    fileWatcherInterval = null;
  }
  const perf = getRuntimePerformanceProfile();
  const intervalMs = Number(perf?.ui?.watcherIntervalMs) || (LOW_END_DEVICE ? 180000 : 90000);

  // Lightweight periodic checks with incremental index maintenance.
  fileWatcherInterval = setInterval(() => {
    const minIdleMs = LOW_END_DEVICE ? 30000 : 12000;
    if (isProcessing || isListening || document.hidden || !isUiIdleFor(minIdleMs)) return;

    scheduleBackgroundTask(() => {
      try {
        const currentCount = getIndexedFileCount();
        if (currentCount !== lastKnownFileCount) {
          console.log(`[Nice] File count changed: ${lastKnownFileCount} -> ${currentCount}`);
          lastKnownFileCount = currentCount;
        }
        runIncrementalIndexMaintenance({
          minIntervalMs: intervalMs,
          quickSampleLimit: LOW_END_DEVICE ? 50 : 120,
        }).then((result) => {
          if (result?.mode === 'rescan' && Number.isFinite(result?.count)) {
            console.log(`[Nice] Incremental maintenance refreshed index: ${result.count} files`);
          }
        }).catch(() => { });
      } catch {
        // Silently ignore file watcher errors
      }
    }, { timeout: 900 });
  }, intervalMs);
}

// ===== CONTEXTUAL Q&A FROM FILE =====

// ===== SETTINGS PANEL =====
(function initSettings() {
  const gearBtn = document.getElementById('settingsGearBtn');
  const drawer = document.getElementById('settingsDrawer');
  const closeBtn = document.getElementById('settingsCloseBtn');
  if (!gearBtn || !drawer || !closeBtn) return;

  // NOTE: Open/Close toggle is already handled in DOMContentLoaded (classList.toggle).
  // Do NOT add another listener here - it would override the toggle with always-add.
  // Just update stats when drawer opens:
  const observer = new MutationObserver(() => {
    if (drawer.classList.contains('open')) updateSearchStats();
  });
  observer.observe(drawer, { attributes: true, attributeFilter: ['class'] });

  // NOTE: Dark mode toggle is already handled in DOMContentLoaded (lines 150-160).
  // Do NOT add duplicate handlers here.

  // NOTE: Font size is handled by the range slider in DOMContentLoaded.
  // The fontDecrease/fontIncrease buttons do not exist in the HTML.
  let fontSize = parseInt(localStorage.getItem('nice_font_size') || '100');
  function applyFontSize() {
    document.documentElement.style.fontSize = fontSize + '%';
    const fontLabel = document.getElementById('fontSizeLabel');
    if (fontLabel) fontLabel.textContent = fontSize + '%';
  }
  // ---- TTS Toggle ----
  const ttsToggle = document.getElementById('settingTTS');
  if (ttsToggle) {
    const savedTTS = localStorage.getItem('nice_tts');
    const enabled = savedTTS === null ? true : savedTTS === 'true';
    ttsToggle.checked = enabled;
    setTTSEnabled(enabled);

    ttsToggle.addEventListener('change', () => {
      const next = !!ttsToggle.checked;
      setTTSEnabled(next);
    });
  }

  // NOTE: Voice speed slider is already handled in DOMContentLoaded (lines 177-184).
  // Do NOT add duplicate handlers here.

  // ---- Search Engine Stats ----
  function updateSearchStats() {
    const filesEl = document.getElementById('statFilesIndexed');
    const scanEl = document.getElementById('statLastScan');

    const fileCount = getIndexedFileCount();
    if (filesEl) filesEl.textContent = fileCount.toLocaleString();
    if (scanEl) scanEl.textContent = fileCount > 0 ? 'Ready' : 'Never';
  }

  // ---- Clear Chat History (two-tap: avoids broken window.confirm in WebView) ----
  const clearBtn = document.getElementById('clearChatBtn');
  let clearPending = false;
  let clearTimer = null;
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (!clearPending) {
        // First tap: ask for confirmation via button text
        clearPending = true;
        clearBtn.textContent = 'Tap again to confirm';
        clearBtn.classList.add('confirm-pending');
        clearTimer = setTimeout(() => {
          clearPending = false;
          clearBtn.textContent = 'Clear Chat History';
          clearBtn.classList.remove('confirm-pending');
        }, 3000);
        return;
      }
      // Second tap: execute the clear
      clearPending = false;
      if (clearTimer) clearTimeout(clearTimer);
      clearBtn.classList.remove('confirm-pending');

      // Clear chat messages from memory
      chatMessages = [];
      // Clear from localStorage
      localStorage.removeItem(CHAT_STORAGE_KEY);
      localStorage.removeItem('nice_kb_count');
      localStorage.removeItem('nice_kb_time');
      localStorage.removeItem('nice_timetable');
      // Clear DOM - remove ALL children from chat window
      if (chatWindow) {
        chatWindow.innerHTML = '';
      }
      // Show the welcome section again (reset both display and hidden class)
      const welcome = document.querySelector('.chat-welcome');
      if (welcome) {
        welcome.style.display = '';
        welcome.classList.remove('hidden');
      }
      // Reset file attachment state
      attachedFile = null;
      attachedFileContent = '';
      fileContextActive = false;

      clearBtn.textContent = '\u2713 Cleared!';
      setTimeout(() => { clearBtn.textContent = 'Clear Chat History'; }, 2000);
      updateSearchStats();
      // Close settings drawer after clearing
      const drawer = document.getElementById('settingsDrawer');
      if (drawer) drawer.classList.remove('open');
    });
  }

  // ---- Reset All (two-tap: avoids broken window.confirm in WebView) ----
  const resetBtn = document.getElementById('resetAllBtn');
  let resetPending = false;
  let resetTimer = null;
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!resetPending) {
        // First tap: ask for confirmation via button text
        resetPending = true;
        resetBtn.textContent = 'Tap again to confirm';
        resetBtn.classList.add('confirm-pending');
        resetTimer = setTimeout(() => {
          resetPending = false;
          resetBtn.textContent = 'Reset All Settings';
          resetBtn.classList.remove('confirm-pending');
        }, 3000);
        return;
      }
      // Second tap: execute the reset
      resetPending = false;
      if (resetTimer) clearTimeout(resetTimer);
      resetBtn.classList.remove('confirm-pending');

      localStorage.removeItem('nice_dark_mode');
      localStorage.removeItem('nice_font_size');
      localStorage.removeItem('nice_tts');
      localStorage.removeItem('nice_voice_speed');
      localStorage.removeItem('nice_auto_learn');
      localStorage.removeItem('nice_auto_learn_consent');
      localStorage.removeItem('nice_permission_dismissed');
      localStorage.removeItem('nice_local_llm_enabled');

      const darkModeToggle = document.getElementById('settingDarkMode');
      const voiceSlider = document.getElementById('settingVoiceSpeed');
      const voiceLabel = document.getElementById('speedLabel');

      document.body.classList.remove('light-theme');
      localStorage.setItem('nice_dark_mode', 'true');
      if (darkModeToggle) darkModeToggle.checked = true;

      fontSize = 100;
      applyFontSize();
      const fontSlider = document.getElementById('settingFontSize');
      if (fontSlider) fontSlider.value = '100';

      setTTSEnabled(true);
      if (ttsToggle) ttsToggle.checked = true;

      setTTSSpeed(1.0);
      if (voiceSlider) voiceSlider.value = '1.0';
      if (voiceLabel) voiceLabel.textContent = '1.0x';
      setLearningConsent(false);
      const learningToggle = document.getElementById('settingAutoLearn');
      if (learningToggle) learningToggle.checked = false;
      updateLearningStateLabel();

      setLocalLlmEnabledPreference(true);
      const localLlmToggle = document.getElementById('settingLocalLlm');
      if (localLlmToggle) localLlmToggle.checked = true;
      updateLocalLlmStateLabel();

      resetBtn.textContent = '\u2713 Reset!';
      setTimeout(() => { resetBtn.textContent = 'Reset All Settings'; }, 2000);
    });
  }

  // ===== DEVICE DETECTION =====
  function getDeviceInfo() {
    const info = {};
    info.platform = navigator.platform || 'Unknown';
    info.userAgent = navigator.userAgent;
    info.language = navigator.language || 'Unknown';
    info.cookiesEnabled = navigator.cookieEnabled;
    info.online = navigator.onLine;
    info.cores = navigator.hardwareConcurrency || 'Unknown';
    info.screen = window.screen.width + ' \u00D7 ' + window.screen.height;
    info.pixelRatio = window.devicePixelRatio || 1;
    info.touchscreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    info.colorDepth = screen.colorDepth + '-bit';

    // Device memory (Chrome only)
    if (navigator.deviceMemory) {
      info.ram = navigator.deviceMemory + ' GB';
    } else {
      info.ram = 'Not available';
    }

    // Connection info
    if (navigator.connection) {
      info.connection = navigator.connection.effectiveType || 'Unknown';
      info.downlink = (navigator.connection.downlink || 0) + ' Mbps';
    }

    // Storage estimate
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(est => {
        const used = (est.usage / 1024 / 1024).toFixed(1);
        const total = (est.quota / 1024 / 1024 / 1024).toFixed(1);
        const usedEl = document.getElementById('deviceStorageUsed');
        if (usedEl) usedEl.textContent = used + ' MB / ' + total + ' GB';
      });
    }

    // Battery
    if (navigator.getBattery) {
      navigator.getBattery().then(bat => {
        const batEl = document.getElementById('deviceBattery');
        if (batEl) {
          batEl.textContent = Math.round(bat.level * 100) + '% ' + (bat.charging ? '(Charging)' : '');
        }
      });
    }

    return info;
  }

  function showDevicePanel() {
    const panel = document.getElementById('devicePanel');
    const body = document.getElementById('devicePanelBody');
    if (!panel || !body) return;

    const info = getDeviceInfo();
    const isAndroid = /android/i.test(info.userAgent);
    const isIOS = /iphone|ipad|ipod/i.test(info.userAgent);
    const isMobile = isAndroid || isIOS || info.touchscreen;
    const deviceType = isAndroid ? 'Android' : isIOS ? 'iOS' : isMobile ? 'Mobile' : 'Desktop';

    const stats = [
      { label: '\uD83D\uDCF1 Device', value: deviceType },
      { label: '\uD83D\uDCBB Platform', value: info.platform },
      { label: '\uD83C\uDF10 Language', value: info.language },
      { label: '\uD83D\uDDA5\uFE0F Screen', value: info.screen + ' @' + info.pixelRatio + 'x' },
      { label: '\uD83C\uDFA8 Color', value: info.colorDepth },
      { label: '\u2699\uFE0F CPU Cores', value: info.cores },
      { label: '\uD83E\uDDE0 RAM', value: info.ram },
      { label: '\uD83D\uDC46 Touch', value: info.touchscreen ? 'Yes' : 'No' },
      { label: '\uD83D\uDCF6 Network', value: info.online ? (info.connection || 'Online') : 'Offline' },
      { label: '\u2B07\uFE0F Speed', value: info.downlink || 'N/A' },
      { label: '\uD83D\uDD0B Battery', html: '<span id="deviceBattery">Checking...</span>' },
      { label: '\uD83D\uDCBE Storage', html: '<span id="deviceStorageUsed">Checking...</span>' },
    ];

    body.innerHTML = stats.map((stat) => {
      const safeLabel = sanitizeHTML(normalizeDisplayText(stat.label));
      const safeValue = stat.html ?? sanitizeHTML(normalizeDisplayText(String(stat.value ?? '')));
      return '<div class="device-stat"><span class="device-stat-label">' + safeLabel + '</span><span class="device-stat-value">' + safeValue + '</span></div>';
    }).join('');

    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }

  // Wire up device info button
  const deviceInfoBtn = document.getElementById('deviceInfoBtn');
  if (deviceInfoBtn) {
    deviceInfoBtn.addEventListener('click', showDevicePanel);
  }
  const devicePanelClose = document.getElementById('devicePanelClose');
  if (devicePanelClose) {
    devicePanelClose.addEventListener('click', () => {
      document.getElementById('devicePanel').style.display = 'none';
    });
  }

  // ===== QUICK ACTIONS =====
  document.querySelectorAll('.quick-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-cmd');
      if (!cmd) return;
      const input = document.getElementById('commandInput');
      if (input) {
        input.value = cmd;
        input.focus();
        // If command doesn't end with space (ready for user input), auto-send
        if (!cmd.endsWith(' ')) {
          const form = document.getElementById('chatForm');
          if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }
      // Hide welcome screen after first action
      const welcome = document.getElementById('chatWelcome');
      if (welcome) { welcome.classList.add('hidden'); welcome.style.display = 'none'; }
    });
  });

  // NOTE: clearChatBtn handler is already defined above (line 1312).
  // Do NOT add a second handler - it causes double confirm dialogs.

  // ---- Wake Word Toggle ----
  const wakeWordToggle = document.getElementById('settingWakeWord');
  if (wakeWordToggle) {
    // Restore saved state
    const savedWakeWord = localStorage.getItem('nice_wake_word') === 'true';
    wakeWordToggle.checked = savedWakeWord;
    if (savedWakeWord) {
      requestMicPermission().then((granted) => {
        if (granted) {
          import('./wake-word.js').then(({ startWakeWordListener }) => {
            startWakeWordListener(() => {
              console.log('[Nice] Wake word detected! Starting listening...');
              toggleListening();
            });
            setMicState(MIC_STATES.WAKE_WORD, 'wake_word_active');
          }).catch(() => { });
        } else {
          wakeWordToggle.checked = false;
          localStorage.setItem('nice_wake_word', 'false');
        }
      });
    }

    wakeWordToggle.addEventListener('change', async () => {
      const enabled = wakeWordToggle.checked;
      localStorage.setItem('nice_wake_word', enabled.toString());
      try {
        if (enabled) {
          const granted = await requestMicPermission();
          if (!granted) {
            wakeWordToggle.checked = false;
            localStorage.setItem('nice_wake_word', 'false');
            return;
          }

          const { startWakeWordListener } = await import('./wake-word.js');
          const started = await startWakeWordListener(() => {
            console.log('[Nice] Wake word detected! Starting listening...');
            toggleListening();
          });
          if (!started) {
            wakeWordToggle.checked = false;
            localStorage.setItem('nice_wake_word', 'false');
          } else {
            setMicState(MIC_STATES.WAKE_WORD, 'wake_word_active');
          }
        } else {
          const { stopWakeWordListener } = await import('./wake-word.js');
          stopWakeWordListener();
          setMicState(MIC_STATES.IDLE, 'wake_word_disabled');
        }
      } catch (e) {
        console.warn('[Nice] Wake word error:', e);
        wakeWordToggle.checked = false;
        setMicState(MIC_STATES.IDLE, 'wake_word_error');
      }
    });
  }

  // ---- Minimize to Bubble Button ----
  const bubbleBtn = document.getElementById('bubbleBtn');
  if (bubbleBtn) {
    bubbleBtn.addEventListener('click', async () => {
      try {
        if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
          // Try native floating plugin
          try {
            const FloatingPlugin = registerPlugin('FloatingPlugin');
            await FloatingPlugin.startBubble();
            updateBubbleState('Active - tap bubble to resume app');
          } catch {
            // Plugin not available - show instruction
            updateBubbleState('Permission required');
            addMessage('assistant', '\uD83D\uDCAC **Minimize to Bubble** requires the floating window permission.\n\nGo to **Settings > Apps > Nice Assistant > Display over other apps** and enable it.\n\n_This feature creates a small floating bubble that stays on top of other apps, so you can access Nice anytime!_');
          }
        } else {
          updateBubbleState('Android only');
          addMessage('assistant', '\uD83D\uDCAC **Floating Bubble** is only available on Android devices. On desktop, you can use the browser\'s picture-in-picture mode instead.');
        }
      } catch (e) {
        console.warn('[Nice] Bubble error:', e);
        updateBubbleState('Error');
      }
    });
  }

  // ---- Auto-init RAG LLM engine (removed WebLLM integration) ----

})();

/**
 * Explicitly prompt Android WebView for RECORD_AUDIO permission.
 * Background Web Speech API silently fails if this isn't granted interactively first.
 */
async function requestMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop the stream immediately, we just wanted the permission grant
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch (e) {
    console.warn('[Nice] Microphone permission denied or unavailable:', e);
    if (e.name === 'NotAllowedError') {
      addMessage('assistant', '\u26A0\uFE0F **Microphone Access Denied**\n\nYou have permanently denied Microphone access in Android (or your phone\'s browser strictly requires HTTPS). To enable the Wake Word, you must manually allow it:\n\n1. Go to your Android **Settings**\n2. Open **Apps > NICE ASSISTANT > Permissions**\n3. Allow **Microphone** access.\n4. Restart this app.');
    } else {
      addMessage('assistant', `\u26A0\uFE0F **Microphone Error**\n\nNice needs permission to record audio to hear the "Hey Nice" wake word. Error: ${e.message}`);
    }
    return false;
  }
}




















