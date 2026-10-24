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

/** A new agency record and its plaintext API key. Only the key's hash is stored. */
export function newAgency(name) {
  const apiKey = `rk_${randomBytes(24).toString('base64url')}`;
  const agency = {
    id: newId('ag'),
    name,
    apiKeyHash: hashApiKey(apiKey),
    branding: { ...DEFAULT_BRANDING, brandName: name },
    createdAt: new Date().toISOString(),
  };
  return { agency, apiKey };
}

export function newWidget(agencyId, fields) {
  const now = new Date().toISOString();
  return { id: newId('w'), agencyId, ...fields, createdAt: now, updatedAt: now };
}

/** Google requests a widget has caused in a month ("YYYY-MM"), from its stored record. */
export function googleRequestsIn(widget, month) {
  const usage = widget?.googleUsage;
  return usage?.month === month ? usage.requests : 0;
}

/**
 * Opens the store chosen by the config: the JSON file (the default, for local and
 * single-server installs) or Firestore. Both have the same async interface.
 */
export async function openStore(config) {
  if (config.store === 'firestore') {
    const { FirestoreStore } = await import('./firestore-store.js');
    return new FirestoreStore({ projectId: config.firestoreProjectId, databaseId: config.firestoreDatabase });
  }
  return new Store(config.dataFile);
}

/**
 * Small JSON-file store for agencies and widgets. Data is held in memory and
 * flushed to disk atomically (write to a temp file, then rename) on every change.
 * Pass `file: null` for a purely in-memory store (used by tests).
 * Only one server process may use a file at a time.
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
  async createAgency(name) {
    const { agency, apiKey } = newAgency(name);
    this.data.agencies.push(agency);
    this.#save();
    return { agency, apiKey };
  }

  async findAgencyByApiKey(apiKey) {
    const hash = hashApiKey(apiKey);
    return this.data.agencies.find((a) => a.apiKeyHash === hash) || null;
  }

  async getAgency(id) {
    return this.#agency(id);
  }

  #agency(id) {
    return this.data.agencies.find((a) => a.id === id) || null;
  }

  async updateBranding(agencyId, branding) {
    const agency = this.#agency(agencyId);
    agency.branding = { ...agency.branding, ...branding };
    this.#save();
    return agency;
  }

  async agencyCount() {
    return this.data.agencies.length;
  }

  // Widgets

  async listWidgets(agencyId) {
    return this.data.widgets.filter((w) => w.agencyId === agencyId);
  }

  async getWidget(id) {
    return this.#widget(id);
  }

  #widget(id) {
    return this.data.widgets.find((w) => w.id === id) || null;
  }

  async createWidget(agencyId, fields) {
    const widget = newWidget(agencyId, fields);
    this.data.widgets.push(widget);
    this.#save();
    return widget;
  }

  async updateWidget(id, fields) {
    const widget = this.#widget(id);
    Object.assign(widget, fields, { updatedAt: new Date().toISOString() });
    this.#save();
    return widget;
  }

  /** Google requests this widget has caused in a month ("YYYY-MM"). */
  async googleRequests(widgetId, month) {
    return googleRequestsIn(this.#widget(widgetId), month);
  }

  /** Counts one more Google request for this widget in a month ("YYYY-MM"). */
  async recordGoogleRequest(widgetId, month) {
    const widget = this.#widget(widgetId);
    widget.googleUsage = { month, requests: googleRequestsIn(widget, month) + 1 };
    this.#save();
  }

  async deleteWidget(id) {
    this.data.widgets = this.data.widgets.filter((w) => w.id !== id);
    this.#save();
  }

  async close() {}
}
