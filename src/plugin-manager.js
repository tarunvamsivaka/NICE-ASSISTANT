/**
 * Nice - Lightweight Plugin Manager (offline)
 * Stores simple response plugins in localStorage.
 */

const KEY = 'nice_plugins_v1';

function loadPlugins() {
    try {
        const raw = localStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function savePlugins(list) {
    try {
        localStorage.setItem(KEY, JSON.stringify(list.slice(0, 32)));
    } catch {
        // best-effort
    }
}

export function listPlugins() {
    return loadPlugins();
}

export function installPlugin({ name, response = '', description = '' }) {
    const plugins = loadPlugins().filter(p => p.name.toLowerCase() !== String(name || '').toLowerCase());
    plugins.unshift({
        name: String(name || '').trim(),
        response: String(response || '').trim(),
        description: String(description || '').trim(),
        installedAt: Date.now(),
    });
    savePlugins(plugins);
    return plugins[0];
}

export function runPlugin(name, input = '') {
    const plugins = loadPlugins();
    const match = plugins.find(p => p.name.toLowerCase() === String(name || '').toLowerCase());
    if (!match) return null;
    const reply = match.response.replace(/\{input\}/g, String(input || '').trim());
    return { ...match, output: reply };
}

export function removePlugin(name) {
    const plugins = loadPlugins().filter(p => p.name.toLowerCase() !== String(name || '').toLowerCase());
    savePlugins(plugins);
    return plugins;
}
