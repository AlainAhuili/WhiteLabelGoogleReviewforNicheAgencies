import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_BRANDING = Object.freeze({
  brandName: '',
  logoUrl: '',
  primaryColor: '#1a73e8',
  poweredByText: '',
  poweredByUrl: '',
  hidePoweredBy: false,
});

export function hashApiKey(apiKey) {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function newId(prefix) {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

/**
 * Small JSON-file store for agencies and widgets. Data is held in memory and
 * flushed to disk atomically (write to a temp file, then rename) on every change.
 * Pass `file: null` for a purely in-memory store (used by tests).
 */
export class Store {
  constructor(file) {
    this.file = file;
    this.data = { agencies: [], widgets: [] };
    if (file) {
      try {
        this.data = JSON.parse(readFileSync(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  }

  #save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  // Agencies

  /** Creates an agency and returns it with its plaintext API key (shown once). */
  createAgency(name) {
    const apiKey = `rk_${randomBytes(24).toString('base64url')}`;
    const agency = {
      id: newId('ag'),
      name,
      apiKeyHash: hashApiKey(apiKey),
      branding: { ...DEFAULT_BRANDING, brandName: name },
      createdAt: new Date().toISOString(),
    };
    this.data.agencies.push(agency);
    this.#save();
    return { agency, apiKey };
  }

  findAgencyByApiKey(apiKey) {
    const hash = hashApiKey(apiKey);
    return this.data.agencies.find((a) => a.apiKeyHash === hash) || null;
  }

  getAgency(id) {
    return this.data.agencies.find((a) => a.id === id) || null;
  }

  updateBranding(agencyId, branding) {
    const agency = this.getAgency(agencyId);
    agency.branding = { ...agency.branding, ...branding };
    this.#save();
    return agency;
  }

  agencyCount() {
    return this.data.agencies.length;
  }

  // Widgets

  listWidgets(agencyId) {
    return this.data.widgets.filter((w) => w.agencyId === agencyId);
  }

  getWidget(id) {
    return this.data.widgets.find((w) => w.id === id) || null;
  }

  createWidget(agencyId, fields) {
    const now = new Date().toISOString();
    const widget = { id: newId('w'), agencyId, ...fields, createdAt: now, updatedAt: now };
    this.data.widgets.push(widget);
    this.#save();
    return widget;
  }

  updateWidget(id, fields) {
    const widget = this.getWidget(id);
    Object.assign(widget, fields, { updatedAt: new Date().toISOString() });
    this.#save();
    return widget;
  }

  /** Google requests this widget has caused in a month ("YYYY-MM"). */
  googleRequests(widgetId, month) {
    const usage = this.getWidget(widgetId)?.googleUsage;
    return usage?.month === month ? usage.requests : 0;
  }

  /** Counts one more Google request for this widget in a month ("YYYY-MM"). */
  recordGoogleRequest(widgetId, month) {
    const widget = this.getWidget(widgetId);
    widget.googleUsage = { month, requests: this.googleRequests(widgetId, month) + 1 };
    this.#save();
  }

  deleteWidget(id) {
    this.data.widgets = this.data.widgets.filter((w) => w.id !== id);
    this.#save();
  }
}
