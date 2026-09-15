/**
 * Nice - Online/Offline Hybrid Module
 * Provides lightweight internet search and weather when online.
 * Privacy-first: only sends search queries, no user data, no cookies, no tracking.
 */

import { isOnlineAllowed, offlineBlockedMessage } from './policy.js';

let _weatherCache = null;
try {
    const raw = localStorage.getItem('nice_cached_weather');
    if (raw) _weatherCache = JSON.parse(raw);
} catch {
    _weatherCache = null;
}

// ===== NETWORK STATUS =====
let _isOnline = navigator.onLine;

window.addEventListener('online', () => { _isOnline = true; updateOnlineIndicator(); });
window.addEventListener('offline', () => { _isOnline = false; updateOnlineIndicator(); });
window.addEventListener('nice:policy-updated', () => { updateOnlineIndicator(); });

const ONLINE_ENDPOINT_ALLOWLIST = {
    webSearch: new Set(['en.wikipedia.org', 'api.duckduckgo.com']),
    weather: new Set(['api.open-meteo.com']),
};

export function isOnline() {
    return isOnlineAllowed('any') && isNetworkReachable();
}

export function isNetworkReachable() {
    return _isOnline && navigator.onLine;
}

function updateOnlineIndicator() {
    const dot = document.querySelector('#headerStatus .status-dot');
    const label = document.getElementById('headerStatusText');
    const header = document.getElementById('headerStatus');
    const onlineOperational = isOnline();

    if (dot) {
        dot.classList.toggle('online', onlineOperational);
    }
    if (label) {
        label.textContent = onlineOperational ? 'Online Mode' : 'Offline Ready';
        return;
    }
    if (header) {
        const fallbackText = onlineOperational ? 'Online Mode' : 'Offline Default';
        header.childNodes.forEach((node) => {
            if ((typeof Node === 'undefined' && node.nodeType === 3) || (typeof Node !== 'undefined' && node.nodeType === Node.TEXT_NODE)) {
                node.textContent = ` ${fallbackText}`;
            }
        });
    }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', updateOnlineIndicator);
}

function isAllowedEndpoint(url, feature) {
    try {
        const parsed = new URL(String(url || ''));
        if (parsed.protocol !== 'https:') return false;
        const allowedHosts = ONLINE_ENDPOINT_ALLOWLIST[feature];
        if (!allowedHosts) return false;
        return allowedHosts.has(parsed.hostname.toLowerCase());
    } catch {
        return false;
    }
}

async function guardedFetch(url, feature, options = {}) {
    if (!isOnlineAllowed(feature)) {
        throw new Error('POLICY_BLOCKED');
    }
    if (!isNetworkReachable()) {
        throw new Error('NETWORK_UNREACHABLE');
    }
    if (!isAllowedEndpoint(url, feature)) {
        throw new Error('ENDPOINT_BLOCKED');
    }

    return fetch(url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        ...options,
    });
}

// ===== LIGHTWEIGHT WEB SEARCH =====
// Uses Wikipedia REST API - free, CORS-enabled, no API key
export async function searchWeb(query) {
    if (!isOnlineAllowed('webSearch')) {
        return offlineBlockedMessage('webSearch');
    }
    if (!isNetworkReachable()) return null;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const cleanQuery = query
            .replace(/^(?:what\s+is|who\s+is|what\s+are|tell\s+me\s+about|explain|define|meaning\s+of|how\s+does|where\s+is|when\s+was|why\s+is|why\s+do)\s+/i, '')
            .replace(/[<>'"?!.]/g, '')
            .trim()
            .substring(0, 200);

        if (!cleanQuery || cleanQuery.length < 2) return null;

        const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanQuery)}`;

        const response = await guardedFetch(searchUrl, 'webSearch', {
            signal: controller.signal,
            headers: {
                Accept: 'application/json',
            },
        });

        clearTimeout(timeout);

        if (response.ok) {
            const data = await response.json();
            if (data.extract && data.extract.length > 20) {
                const title = data.title || cleanQuery;
                let answer = `**${title}**\n\n${data.extract}`;
                if (data.content_urls && data.content_urls.desktop) {
                    answer += `\n\n[Read more on Wikipedia](${data.content_urls.desktop.page})`;
                }
                answer += '\n\n(Source: Wikipedia)';
                return answer;
            }
        }

        const searchFallbackUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&format=json&origin=*&srlimit=3&srprop=snippet`;

        const controller2 = new AbortController();
        const timeout2 = setTimeout(() => controller2.abort(), 5000);

        const fallbackResp = await guardedFetch(searchFallbackUrl, 'webSearch', {
            signal: controller2.signal,
        });

        clearTimeout(timeout2);

        if (fallbackResp.ok) {
            const fbData = await fallbackResp.json();
            const results = fbData?.query?.search;
            if (results && results.length > 0) {
                const bestTitle = results[0].title;
                const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(bestTitle)}`;

                const controller3 = new AbortController();
                const timeout3 = setTimeout(() => controller3.abort(), 5000);

                const summaryResp = await guardedFetch(summaryUrl, 'webSearch', {
                    signal: controller3.signal,
                });

                clearTimeout(timeout3);

                if (summaryResp.ok) {
                    const summaryData = await summaryResp.json();
                    if (summaryData.extract && summaryData.extract.length > 20) {
                        let answer = `**${summaryData.title}**\n\n${summaryData.extract}`;
                        if (summaryData.content_urls && summaryData.content_urls.desktop) {
                            answer += `\n\n[Read more](${summaryData.content_urls.desktop.page})`;
                        }
                        answer += '\n\n(Source: Wikipedia)';
                        return answer;
                    }
                }

                const snippets = results.map(r => {
                    const text = r.snippet.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, '');
                    return `- **${r.title}**: ${text}`;
                }).join('\n\n');
                return `Here's what I found:\n\n${snippets}\n\n(Source: Wikipedia)`;
            }
        }

        // Additional fallback: DuckDuckGo instant answer API.
        const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
        const ddgResp = await guardedFetch(ddgUrl, 'webSearch', {
            headers: {
                Accept: 'application/json',
            },
        });
        if (ddgResp.ok) {
            const ddg = await ddgResp.json();
            const abstractText = String(ddg?.AbstractText || '').trim();
            const heading = String(ddg?.Heading || cleanQuery).trim();
            if (abstractText.length > 20) {
                const source = String(ddg?.AbstractSource || 'DuckDuckGo');
                const sourceUrl = String(ddg?.AbstractURL || '').trim();
                let answer = `**${heading || cleanQuery}**\n\n${abstractText}`;
                if (sourceUrl) {
                    answer += `\n\n[Read more](${sourceUrl})`;
                }
                answer += `\n\n(Source: ${source})`;
                return answer;
            }

            const related = Array.isArray(ddg?.RelatedTopics) ? ddg.RelatedTopics : [];
            const topics = related
                .flatMap((item) => {
                    if (item?.Text) return [item];
                    if (Array.isArray(item?.Topics)) return item.Topics;
                    return [];
                })
                .filter(item => item?.Text)
                .slice(0, 3);

            if (topics.length > 0) {
                const lines = topics.map(item => `- ${item.Text}`).join('\n');
                return `Here's what I found:\n\n${lines}\n\n(Source: DuckDuckGo)`;
            }
        }

        return null;
    } catch (e) {
        if (e.message === 'POLICY_BLOCKED') return offlineBlockedMessage('webSearch');
        if (e.message === 'NETWORK_UNREACHABLE') return null;
        if (e.message === 'ENDPOINT_BLOCKED') {
            console.warn('[Nice] Blocked untrusted web-search endpoint');
            return null;
        }
        if (e.name === 'AbortError') {
            console.warn('[Nice] Web search timed out');
        } else {
            console.warn('[Nice] Web search failed:', e.message);
        }
        return null;
    }
}

// ===== WEATHER =====
// Uses Open-Meteo API - free, CORS-enabled, no API key
const WEATHER_CODES = {
    0: { desc: 'Clear sky', emoji: '\u2600\uFE0F' },
    1: { desc: 'Mainly clear', emoji: '\uD83C\uDF24\uFE0F' },
    2: { desc: 'Partly cloudy', emoji: '\u26C5' },
    3: { desc: 'Overcast', emoji: '\u2601\uFE0F' },
    45: { desc: 'Foggy', emoji: '\uD83C\uDF2B\uFE0F' },
    48: { desc: 'Rime fog', emoji: '\uD83C\uDF2B\uFE0F' },
    51: { desc: 'Light drizzle', emoji: '\uD83C\uDF26\uFE0F' },
    53: { desc: 'Moderate drizzle', emoji: '\uD83C\uDF26\uFE0F' },
    55: { desc: 'Dense drizzle', emoji: '\uD83C\uDF27\uFE0F' },
    61: { desc: 'Slight rain', emoji: '\uD83C\uDF27\uFE0F' },
    63: { desc: 'Moderate rain', emoji: '\uD83C\uDF27\uFE0F' },
    65: { desc: 'Heavy rain', emoji: '\uD83C\uDF27\uFE0F' },
    71: { desc: 'Slight snow', emoji: '\uD83C\uDF28\uFE0F' },
    73: { desc: 'Moderate snow', emoji: '\uD83C\uDF28\uFE0F' },
    75: { desc: 'Heavy snow', emoji: '\u2744\uFE0F' },
    77: { desc: 'Snow grains', emoji: '\u2744\uFE0F' },
    80: { desc: 'Slight showers', emoji: '\uD83C\uDF26\uFE0F' },
    81: { desc: 'Moderate showers', emoji: '\uD83C\uDF27\uFE0F' },
    82: { desc: 'Violent showers', emoji: '\uD83C\uDF27\uFE0F' },
    85: { desc: 'Slight snow showers', emoji: '\uD83C\uDF28\uFE0F' },
    86: { desc: 'Heavy snow showers', emoji: '\u2744\uFE0F' },
    95: { desc: 'Thunderstorm', emoji: '\u26C8\uFE0F' },
    96: { desc: 'Thunderstorm with hail', emoji: '\u26C8\uFE0F' },
    99: { desc: 'Thunderstorm with heavy hail', emoji: '\u26C8\uFE0F' },
};

export async function getWeather(lat, lon) {
    if (!isOnlineAllowed('weather')) {
        if (_weatherCache?.msg) {
            return `${offlineBlockedMessage('weather')}\n\n_Last known (cached)_:\n${_weatherCache.msg}`;
        }
        return offlineBlockedMessage('weather');
    }
    if (!isNetworkReachable()) {
        if (_weatherCache?.msg) {
            return `Weather is not available while offline.\n\n_Last known (cached)_:\n${_weatherCache.msg}`;
        }
        return 'Weather is not available while offline.';
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weathercode,windspeed_10m&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto&forecast_days=1`;

        const response = await guardedFetch(url, 'weather', {
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) return "Couldn't fetch weather data right now. Please try again.";

        const data = await response.json();
        const current = data.current;
        const daily = data.daily;

        if (!current) return 'Weather data unavailable. Please try again.';

        const temp = Math.round(current.temperature_2m);
        const unit = data.current_units?.temperature_2m || 'C';
        const humidity = current.relative_humidity_2m;
        const windSpeed = current.windspeed_10m;
        const code = current.weathercode;
        const weather = WEATHER_CODES[code] || { desc: 'Unknown', emoji: '\uD83C\uDF21\uFE0F' };

        let msg = `${weather.emoji} **Current Weather**\n\n`;
        msg += `**${temp}${unit}** - ${weather.desc}\n`;
        msg += `Humidity: ${humidity}%\n`;
        msg += `Wind: ${windSpeed} km/h\n`;

        if (daily && daily.temperature_2m_max && daily.temperature_2m_min) {
            const high = Math.round(daily.temperature_2m_max[0]);
            const low = Math.round(daily.temperature_2m_min[0]);
            msg += `\nToday: High **${high}${unit}** / Low **${low}${unit}**`;
        }

        try {
            _weatherCache = { msg, ts: Date.now(), lat, lon };
            localStorage.setItem('nice_cached_weather', JSON.stringify(_weatherCache));
        } catch {
            // cache write is best-effort
        }

        return msg;
    } catch (e) {
        if (e.message === 'POLICY_BLOCKED') return offlineBlockedMessage('weather');
        if (e.message === 'NETWORK_UNREACHABLE') return 'Weather is not available while offline.';
        if (e.message === 'ENDPOINT_BLOCKED') return 'Blocked an untrusted weather endpoint for safety.';
        if (e.name === 'AbortError') {
            return 'Weather request timed out. Your connection might be slow.';
        }
        return "Couldn't get weather right now. Please try again later.";
    }
}
