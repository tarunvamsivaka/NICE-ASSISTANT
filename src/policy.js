/**
 * Nice — Centralized Runtime Policy Module
 * Enforces offline-default behavior and per-session online opt-in.
 *
 * Session policy shape (stored in memory + localStorage defaults):
 *   offlineDefault:      true           (immutable in v1)
 *   onlineSessionOptIn:  boolean        (per-session, resets on reload)
 *   allowWebSearch:      boolean        (gated by onlineSessionOptIn)
 *   allowWeather:        boolean        (gated by onlineSessionOptIn)
 */

const STORAGE_KEY = 'nice_policy_defaults';
const OFFLINE_HARD_LOCK = false;

// In-memory session state — resets every app launch
const _session = {
  offlineDefault: true,
  offlineHardLock: OFFLINE_HARD_LOCK,
  onlineSessionOptIn: false,
  allowWebSearch: false,
  allowWeather: false,
};

// ===== PERSISTENCE =====
function _loadDefaults() {
  if (OFFLINE_HARD_LOCK) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Only restore user-controllable defaults (not session opt-in)
      if (typeof saved.allowWebSearch === 'boolean') _session.allowWebSearch = saved.allowWebSearch;
      if (typeof saved.allowWeather === 'boolean') _session.allowWeather = saved.allowWeather;
    }
  } catch { /* corrupt storage — use hard defaults */ }
}

function _saveDefaults() {
  if (OFFLINE_HARD_LOCK) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      allowWebSearch: _session.allowWebSearch,
      allowWeather: _session.allowWeather,
    }));
  } catch { /* storage full */ }
}

function _emitPolicyUpdated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('nice:policy-updated', { detail: getPolicyState() }));
}

// Initialize on import
_loadDefaults();

// ===== PUBLIC API =====

/**
 * Check whether a network-dependent feature is allowed right now.
 * @param {'webSearch'|'weather'|'any'} feature
 * @returns {boolean}
 */
export function isOnlineAllowed(feature = 'any') {
  if (OFFLINE_HARD_LOCK) return false;
  if (!_session.onlineSessionOptIn) return false;
  switch (feature) {
    case 'webSearch': return _session.allowWebSearch;
    case 'weather':   return _session.allowWeather;
    case 'any':       return true;  // session opt-in is enough for generic checks
    default:          return false;
  }
}

/**
 * User explicitly opts in to online features for this session.
 * Enables both webSearch and weather by default.
 */
export function optInToOnline() {
  if (OFFLINE_HARD_LOCK) {
    _session.onlineSessionOptIn = false;
    _session.allowWebSearch = false;
    _session.allowWeather = false;
    _emitPolicyUpdated();
    return false;
  }
  _session.onlineSessionOptIn = true;
  _session.allowWebSearch = true;
  _session.allowWeather = true;
  _saveDefaults();
  _emitPolicyUpdated();
  console.log('[Nice][Policy] Online session opt-in activated');
  return true;
}

/**
 * Revoke online access for this session.
 */
export function optOutOfOnline() {
  _session.onlineSessionOptIn = false;
  _session.allowWebSearch = false;
  _session.allowWeather = false;
  _saveDefaults();
  _emitPolicyUpdated();
  console.log('[Nice][Policy] Online session opt-out activated');
}

/**
 * Toggle a specific online feature.
 * @param {'webSearch'|'weather'} feature
 * @param {boolean} enabled
 */
export function setFeatureAllowed(feature, enabled) {
  if (OFFLINE_HARD_LOCK) return;
  if (feature === 'webSearch') _session.allowWebSearch = enabled;
  else if (feature === 'weather') _session.allowWeather = enabled;
  _saveDefaults();
  _emitPolicyUpdated();
}

export function isOnlineSessionOptedIn() {
  return _session.onlineSessionOptIn;
}

/**
 * Return a read-only snapshot of the current policy state.
 */
export function getPolicyState() {
  return { ..._session };
}

export function isOfflineHardLocked() {
  return OFFLINE_HARD_LOCK;
}

/**
 * Truthful "feature unavailable" message for blocked online features.
 * Use this instead of simulated/placeholder responses.
 */
export function offlineBlockedMessage(feature) {
  const base = OFFLINE_HARD_LOCK
    ? 'Offline-only mode is enforced in this build.'
    : 'This feature requires an internet connection.';
  const cta = OFFLINE_HARD_LOCK
    ? 'Internet features are unavailable.'
    : 'Say **"go online"** to enable online features for this session.';
  switch (feature) {
    case 'webSearch':
      return `${base}\nWeb search is disabled while in offline mode.\n\n${cta}`;
    case 'weather':
      return `${base}\nWeather updates are disabled while in offline mode.\n\n${cta}`;
    default:
      return `${base}\n\n${cta}`;
  }
}

