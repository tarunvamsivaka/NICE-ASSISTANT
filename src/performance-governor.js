/**
 * Nice - Runtime Performance Governor
 * Device + energy aware tuning for stable offline performance.
 */

const PROFILE = Object.freeze({
  LOW: 'low',
  MID: 'mid',
  HIGH: 'high',
});

const ENERGY_MODE = Object.freeze({
  CONSERVE: 'conserve',
  BALANCED: 'balanced',
  PERFORMANCE: 'performance',
});

const CACHE_TTL_MS = 15_000;

const runtimeSignals = {
  batteryLevel: null,
  charging: null,
  saveData: false,
  effectiveType: '',
  initialized: false,
};

let initialized = false;
let cachedProfile = null;
let cacheAt = 0;

function getNavigator() {
  return typeof navigator !== 'undefined' ? navigator : null;
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readDeviceMemory() {
  const nav = getNavigator();
  return safeNumber(nav?.deviceMemory || 0);
}

function readHardwareCores() {
  const nav = getNavigator();
  return safeNumber(nav?.hardwareConcurrency || 0);
}

function emitProfileUpdate() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('nice:performance-updated', { detail: getRuntimePerformanceProfile() }));
}

function invalidateProfile() {
  cachedProfile = null;
  cacheAt = 0;
}

function updateConnectionSignals() {
  const nav = getNavigator();
  const conn = nav?.connection;
  runtimeSignals.saveData = !!conn?.saveData;
  runtimeSignals.effectiveType = String(conn?.effectiveType || '');
  runtimeSignals.initialized = true;
  invalidateProfile();
  emitProfileUpdate();
}

function updateBatterySignals(battery) {
  runtimeSignals.batteryLevel = safeNumber(battery?.level);
  runtimeSignals.charging = typeof battery?.charging === 'boolean' ? battery.charging : null;
  runtimeSignals.initialized = true;
  invalidateProfile();
  emitProfileUpdate();
}

function setupBatteryMonitoring() {
  const nav = getNavigator();
  if (!nav?.getBattery) return;
  nav.getBattery()
    .then((battery) => {
      updateBatterySignals(battery);
      battery.addEventListener?.('levelchange', () => updateBatterySignals(battery));
      battery.addEventListener?.('chargingchange', () => updateBatterySignals(battery));
    })
    .catch(() => {
      // Optional signal, ignore failures.
    });
}

function setupConnectionMonitoring() {
  updateConnectionSignals();
  const nav = getNavigator();
  const conn = nav?.connection;
  if (!conn?.addEventListener) return;
  conn.addEventListener('change', updateConnectionSignals);
}

export function initPerformanceGovernor() {
  if (initialized) return;
  initialized = true;
  if (!getNavigator()) return;
  setupConnectionMonitoring();
  setupBatteryMonitoring();
}

function resolveTier(mem, cores) {
  const isLow = (mem !== null && mem <= 4) || (cores !== null && cores <= 4);
  const isVeryLow = (mem !== null && mem <= 2) || (cores !== null && cores <= 2);
  const isHigh = (mem !== null && mem >= 8) && (cores !== null && cores >= 8);
  if (isVeryLow) return PROFILE.LOW;
  if (isHigh) return PROFILE.HIGH;
  if (isLow) return PROFILE.LOW;
  return PROFILE.MID;
}

function resolveEnergyMode(tier) {
  const level = runtimeSignals.batteryLevel;
  const charging = runtimeSignals.charging;
  const saveData = runtimeSignals.saveData;
  const netType = runtimeSignals.effectiveType;

  if (saveData) return ENERGY_MODE.CONSERVE;
  if (level !== null && charging === false && level <= 0.2) return ENERGY_MODE.CONSERVE;
  if (level !== null && charging === false && level <= 0.35 && tier === PROFILE.LOW) return ENERGY_MODE.CONSERVE;
  if (netType === '2g' || netType === 'slow-2g') return ENERGY_MODE.CONSERVE;
  if (charging === true && tier === PROFILE.HIGH) return ENERGY_MODE.PERFORMANCE;
  return ENERGY_MODE.BALANCED;
}

function buildBaseProfile(tier, native) {
  const nativeDevice = !!native;

  const search = tier === PROFILE.LOW
    ? {
      bm25CandidateLimit: nativeDevice ? 18 : 20,
      rerankTopK: nativeDevice ? 3 : 4,
      useEmbeddingsRerank: false,
      fullScanThrottleMs: nativeDevice ? 4 : 3,
    }
    : tier === PROFILE.HIGH
      ? {
        bm25CandidateLimit: nativeDevice ? 42 : 48,
        rerankTopK: nativeDevice ? 8 : 10,
        useEmbeddingsRerank: true,
        fullScanThrottleMs: nativeDevice ? 2 : 1,
      }
      : {
        bm25CandidateLimit: nativeDevice ? 26 : 32,
        rerankTopK: nativeDevice ? 5 : 7,
        useEmbeddingsRerank: nativeDevice ? false : true,
        fullScanThrottleMs: nativeDevice ? 3 : 2,
      };

  const ui = tier === PROFILE.LOW
    ? {
      streamAssistantText: false,
      suggestionLimit: 3,
      watcherIntervalMs: nativeDevice ? 240000 : 180000,
    }
    : tier === PROFILE.HIGH
      ? {
        streamAssistantText: nativeDevice ? false : true,
        suggestionLimit: 6,
        watcherIntervalMs: nativeDevice ? 150000 : 90000,
      }
      : {
        streamAssistantText: nativeDevice ? false : true,
        suggestionLimit: 4,
        watcherIntervalMs: nativeDevice ? 180000 : 120000,
      };

  return { search, ui };
}

function applyEnergyAdjustments(profile, energyMode, tier) {
  if (energyMode === ENERGY_MODE.CONSERVE) {
    profile.search.bm25CandidateLimit = Math.max(12, Math.floor(profile.search.bm25CandidateLimit * 0.7));
    profile.search.rerankTopK = Math.max(2, Math.floor(profile.search.rerankTopK * 0.5));
    profile.search.useEmbeddingsRerank = tier === PROFILE.HIGH && runtimeSignals.charging === true;
    profile.search.fullScanThrottleMs = Math.max(profile.search.fullScanThrottleMs, 4);
    profile.ui.streamAssistantText = false;
    profile.ui.suggestionLimit = Math.max(3, profile.ui.suggestionLimit - 1);
    profile.ui.watcherIntervalMs = Math.max(profile.ui.watcherIntervalMs, 180000);
    return;
  }

  if (energyMode === ENERGY_MODE.PERFORMANCE) {
    profile.search.bm25CandidateLimit = Math.min(56, profile.search.bm25CandidateLimit + 6);
    profile.search.rerankTopK = Math.min(12, profile.search.rerankTopK + 1);
    profile.search.useEmbeddingsRerank = true;
    profile.search.fullScanThrottleMs = Math.max(1, profile.search.fullScanThrottleMs - 1);
    profile.ui.streamAssistantText = true;
    profile.ui.suggestionLimit = Math.min(7, profile.ui.suggestionLimit + 1);
    profile.ui.watcherIntervalMs = Math.max(60000, profile.ui.watcherIntervalMs - 15000);
  }
}

export function getRuntimePerformanceProfile() {
  initPerformanceGovernor();

  const now = Date.now();
  if (cachedProfile && (now - cacheAt) < CACHE_TTL_MS) return cachedProfile;

  const mem = readDeviceMemory();
  const cores = readHardwareCores();
  const native = !!(typeof window !== 'undefined'
    && window.Capacitor
    && window.Capacitor.isNativePlatform
    && window.Capacitor.isNativePlatform());
  const tier = resolveTier(mem, cores);
  const energyMode = resolveEnergyMode(tier);

  const base = buildBaseProfile(tier, native);
  applyEnergyAdjustments(base, energyMode, tier);

  cachedProfile = {
    tier,
    energyMode,
    native,
    memoryGb: mem,
    cpuCores: cores,
    batteryLevel: runtimeSignals.batteryLevel,
    charging: runtimeSignals.charging,
    saveData: runtimeSignals.saveData,
    networkType: runtimeSignals.effectiveType,
    search: base.search,
    ui: base.ui,
  };
  cacheAt = now;
  return cachedProfile;
}

export function resetPerformanceProfileCache() {
  invalidateProfile();
}

