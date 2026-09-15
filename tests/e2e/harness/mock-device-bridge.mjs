/**
 * Mock Device Bridge Plugin — Nice Assistant v1.2.0
 * Simulates Android Capacitor DeviceBridgePlugin (DeviceBridgePlugin.java)
 * in pure Node.js with genuine state tracking and contract conformance.
 */

import { SAMPLE_CONTACTS } from './fixtures.mjs';

class MockDeviceBridge {
  constructor() {
    this.reset();
  }

  reset() {
    this.calendarEvents = [];
    this.contacts = JSON.parse(JSON.stringify(SAMPLE_CONTACTS));
    this.batteryInfo = {
      level: 85,
      isCharging: true,
      plugType: 'AC',
      isPowerSaveMode: false,
    };
    this.clipboard = {
      text: '',
      hasContent: false,
    };
    this.permissions = {
      READ_CONTACTS: true,
      CLIPBOARD: true,
    };
    this.isAppPaused = false;
    this.simulatedErrors = new Map();
    this.callHistory = [];
  }

  _recordCall(method, args) {
    this.callHistory.push({
      method,
      args: args ? JSON.parse(JSON.stringify(args)) : args,
      timestamp: Date.now(),
    });
    if (this.simulatedErrors.has(method)) {
      const err = this.simulatedErrors.get(method);
      throw (typeof err === 'function' ? err() : err);
    }
  }

  // --- CALENDAR BRIDGE ---
  async createCalendarEvent(options) {
    this._recordCall('createCalendarEvent', options);

    if (options === null || options === undefined) {
      return { success: false, error: 'INVALID_ARGUMENTS' };
    }

    if (typeof options !== 'object') {
      return { success: false, error: 'INVALID_ARGUMENTS' };
    }

    const title = String(options.title || options.eventName || 'Untitled Event').trim();
    let startTime = options.startTime;
    let endTime = options.endTime;

    if (startTime === undefined && options.beginTime !== undefined) {
      startTime = options.beginTime;
    }
    if (endTime === undefined && options.endTime !== undefined) {
      endTime = options.endTime;
    }

    // Coerce or default timestamps
    if (typeof startTime !== 'number') {
      startTime = Number(startTime) || Date.now() + 86400000;
    }
    if (typeof endTime !== 'number') {
      endTime = Number(endTime) || (startTime + 3600000);
    }

    // Handle inverted start and end times (boundary case T2-F09-02)
    if (endTime < startTime) {
      endTime = startTime + 3600000;
    }

    const eventRecord = {
      id: `cal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title,
      startTime: Math.floor(startTime),
      endTime: Math.floor(endTime),
      description: options.description || 'Created by Nice Assistant',
      location: options.location || '',
      allDay: !!options.allDay,
      createdAt: Date.now(),
    };

    this.calendarEvents.push(eventRecord);
    return {
      success: true,
      eventId: eventRecord.id,
      event: eventRecord,
    };
  }

  // --- CONTACTS BRIDGE ---
  async searchContacts(options) {
    this._recordCall('searchContacts', options);

    if (!this.permissions.READ_CONTACTS) {
      return {
        found: false,
        contacts: [],
        error: 'permission_denied',
        message: 'READ_CONTACTS permission denied',
      };
    }

    if (!options || typeof options.query !== 'string') {
      return { found: false, contacts: [] };
    }

    const rawQuery = options.query.trim().toLowerCase();
    if (!rawQuery) {
      return { found: false, contacts: [] };
    }

    // Parameterized lookup safe against SQL injection (T2-F11-05)
    // Matches by name or phone
    const matches = this.contacts.filter(c => {
      const nameMatch = c.name && c.name.toLowerCase().includes(rawQuery);
      const phoneMatch = c.phone && c.phone.includes(rawQuery);
      const emailMatch = c.email && c.email.toLowerCase().includes(rawQuery);
      return nameMatch || phoneMatch || emailMatch;
    });

    if (matches.length === 0) {
      return { found: false, contacts: [] };
    }

    // Limit to top 5 matches if query is 1 char (boundary T2-F12-04)
    const resultContacts = rawQuery.length <= 1 ? matches.slice(0, 5) : matches;

    return {
      found: true,
      contacts: resultContacts.map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        type: c.type || 'Mobile',
        email: c.email || '',
        phones: c.phones || [{ number: c.phone, type: c.type || 'Mobile' }],
      })),
    };
  }

  // --- BATTERY BRIDGE ---
  async getBatteryInfo() {
    this._recordCall('getBatteryInfo', {});
    return {
      level: Math.round(this.batteryInfo.level),
      isCharging: !!this.batteryInfo.isCharging,
      plugType: String(this.batteryInfo.plugType || 'none'),
      isPowerSaveMode: !!this.batteryInfo.isPowerSaveMode,
    };
  }

  // --- CLIPBOARD BRIDGE ---
  async readClipboard() {
    this._recordCall('readClipboard', {});

    if (this.isAppPaused) {
      return {
        text: '',
        hasContent: false,
        error: 'background_restricted',
        message: 'Clipboard access restricted in background',
      };
    }

    if (!this.permissions.CLIPBOARD) {
      return {
        text: '',
        hasContent: false,
        error: 'permission_denied',
        message: 'Clipboard read permission denied',
      };
    }

    return {
      text: this.clipboard.text,
      hasContent: this.clipboard.hasContent && this.clipboard.text.length > 0,
    };
  }

  async writeClipboard(options) {
    this._recordCall('writeClipboard', options);

    const text = options?.text !== undefined ? String(options.text) : '';
    this.clipboard.text = text;
    this.clipboard.hasContent = text.trim().length > 0;

    return {
      success: true,
      length: text.length,
    };
  }

  // --- TEST CONTROLS & HARNESS ACCESSORS ---
  setBatteryState({ level, isCharging, plugType, isPowerSaveMode }) {
    if (level !== undefined) this.batteryInfo.level = level;
    if (isCharging !== undefined) this.batteryInfo.isCharging = isCharging;
    if (plugType !== undefined) this.batteryInfo.plugType = plugType;
    if (isPowerSaveMode !== undefined) this.batteryInfo.isPowerSaveMode = isPowerSaveMode;
  }

  setPermission(perm, granted) {
    this.permissions[perm] = !!granted;
  }

  setAppPaused(paused) {
    this.isAppPaused = !!paused;
  }

  simulateError(method, error) {
    this.simulatedErrors.set(method, error);
  }

  clearSimulatedError(method) {
    this.simulatedErrors.delete(method);
  }

  getLastCall(method) {
    const calls = this.callHistory.filter(c => c.method === method);
    return calls.length > 0 ? calls[calls.length - 1] : null;
  }

  getCalls(method) {
    return this.callHistory.filter(c => c.method === method);
  }
}

export const mockDeviceBridge = new MockDeviceBridge();
export default mockDeviceBridge;
