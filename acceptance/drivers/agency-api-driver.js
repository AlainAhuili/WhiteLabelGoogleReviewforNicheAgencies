import { config } from '../config.js';
import { expectStatus, request } from './http.js';

/** Drives the operator and agency admin HTTP APIs. */
export class AgencyApiDriver {
  async provisionAgency(name) {
    const res = await expectStatus(
      request('/api/operator/agencies', { key: config.operatorApiKey, method: 'POST', body: { name } }),
      201,
      'Provisioning agency',
    );
    return { id: res.json.agency.id, apiKey: res.json.apiKey };
  }

  async updateBranding(apiKey, branding) {
    await expectStatus(request('/api/admin/branding', { key: apiKey, method: 'PUT', body: branding }), 200, 'Updating branding');
  }

  async createWidget(apiKey, widget) {
    const res = await expectStatus(
      request('/api/admin/widgets', { key: apiKey, method: 'POST', body: widget }),
      201,
      'Creating widget',
    );
    return res.json.widget;
  }

  /** Returns the HTTP status rather than throwing, so tests can assert on refusals. */
  async tryUpdateWidget(apiKey, widgetId, changes) {
    const res = await request(`/api/admin/widgets/${widgetId}`, { key: apiKey, method: 'PATCH', body: changes });
    return res.status;
  }

  async refreshWidget(apiKey, widgetId) {
    await expectStatus(
      request(`/api/admin/widgets/${widgetId}/refresh`, { key: apiKey, method: 'POST' }),
      204,
      'Refreshing widget reviews',
    );
  }

  /** Returns the HTTP status rather than throwing, so tests can assert on refusals. */
  async tryRefreshWidget(apiKey, widgetId) {
    const res = await request(`/api/admin/widgets/${widgetId}/refresh`, { key: apiKey, method: 'POST' });
    return res.status;
  }

  async followReviewLink(reviewLink) {
    const { pathname } = new URL(reviewLink);
    const res = await request(pathname);
    if (res.status !== 302) throw new Error(`Review link returned HTTP ${res.status}, expected a redirect`);
    return res.headers.get('location');
  }
}
