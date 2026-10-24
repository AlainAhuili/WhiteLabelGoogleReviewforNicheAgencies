import { Firestore } from '@google-cloud/firestore';
import { googleRequestsIn, hashApiKey, newAgency, newWidget } from './store.js';

/**
 * Stores agencies and widgets in Firestore, so data survives redeploys and
 * several server instances can share it. Same interface as the JSON-file Store.
 *
 *   agencies/{agencyId}  { id, name, apiKeyHash, branding, createdAt }
 *   widgets/{widgetId}   { id, agencyId, ...settings, googleUsage, createdAt, updatedAt }
 *
 * Credentials come from Application Default Credentials (on Cloud Run, the
 * service account). With FIRESTORE_EMULATOR_HOST set, it talks to the emulator.
 */
export class FirestoreStore {
  constructor({ projectId, databaseId, db } = {}) {
    this.db = db ?? new Firestore({
      ...(projectId ? { projectId } : {}),
      ...(databaseId ? { databaseId } : {}),
      ignoreUndefinedProperties: true,
    });
    this.agencies = this.db.collection('agencies');
    this.widgets = this.db.collection('widgets');
  }

  // Agencies

  /** Creates an agency and returns it with its plaintext API key (shown once). */
  async createAgency(name) {
    const { agency, apiKey } = newAgency(name);
    await this.agencies.doc(agency.id).create(agency);
    return { agency, apiKey };
  }

  async findAgencyByApiKey(apiKey) {
    const snap = await this.agencies.where('apiKeyHash', '==', hashApiKey(apiKey)).limit(1).get();
    return snap.empty ? null : snap.docs[0].data();
  }

  async getAgency(id) {
    const doc = await this.agencies.doc(id).get();
    return doc.exists ? doc.data() : null;
  }

  async updateBranding(agencyId, branding) {
    const ref = this.agencies.doc(agencyId);
    return this.db.runTransaction(async (tx) => {
      const agency = (await tx.get(ref)).data();
      agency.branding = { ...agency.branding, ...branding };
      tx.update(ref, { branding: agency.branding });
      return agency;
    });
  }

  async agencyCount() {
    return (await this.agencies.count().get()).data().count;
  }

  // Widgets

  /** An agency's widgets, oldest first (like the JSON-file store). */
  async listWidgets(agencyId) {
    const snap = await this.widgets.where('agencyId', '==', agencyId).get();
    return snap.docs
      .map((doc) => doc.data())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async getWidget(id) {
    const doc = await this.widgets.doc(id).get();
    return doc.exists ? doc.data() : null;
  }

  async createWidget(agencyId, fields) {
    const widget = newWidget(agencyId, fields);
    await this.widgets.doc(widget.id).create(widget);
    return widget;
  }

  async updateWidget(id, fields) {
    const ref = this.widgets.doc(id);
    await ref.update({ ...fields, updatedAt: new Date().toISOString() });
    return (await ref.get()).data();
  }

  /** Google requests this widget has caused in a month ("YYYY-MM"). */
  async googleRequests(widgetId, month) {
    return googleRequestsIn(await this.getWidget(widgetId), month);
  }

  /**
   * Counts one more Google request for this widget in a month ("YYYY-MM").
   * A transaction, so concurrent requests on different instances all count.
   */
  async recordGoogleRequest(widgetId, month) {
    const ref = this.widgets.doc(widgetId);
    await this.db.runTransaction(async (tx) => {
      const widget = (await tx.get(ref)).data();
      tx.update(ref, { googleUsage: { month, requests: googleRequestsIn(widget, month) + 1 } });
    });
  }

  async deleteWidget(id) {
    await this.widgets.doc(id).delete();
  }

  async close() {
    await this.db.terminate();
  }
}
