import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { DemoPlacesClient } from '../src/demo.js';
import { ReviewService } from '../src/reviews.js';
import { Store } from '../src/store.js';

describe('HTTP API', () => {
  let server;
  let baseUrl;
  let store;
  let apiKey;
  let otherKey;

  before(async () => {
    store = new Store(null);
    ({ apiKey } = store.createAgency('Acme Local'));
    ({ apiKey: otherKey } = store.createAgency('Rival Agency'));
    const reviews = new ReviewService(new DemoPlacesClient());
    const app = createApp({ store, reviews, config: { publicUrl: 'https://widgets.example', demoMode: true, version: '1.2.3', operatorApiKey: 'op_secret' } });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  beforeEach(() => {
    store.data.widgets = [];
  });

  const call = (path, { key = apiKey, method = 'GET', body } = {}) =>
    fetch(`${baseUrl}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  const createWidget = async (fields = {}) => {
    const res = await call('/api/admin/widgets', { method: 'POST', body: { placeId: 'demo-place', ...fields } });
    assert.equal(res.status, 201);
    return (await res.json()).widget;
  };

  it('rejects admin requests without a valid API key', async () => {
    assert.equal((await call('/api/admin/me', { key: null })).status, 401);
    assert.equal((await call('/api/admin/me', { key: 'rk_wrong' })).status, 401);
  });

  it('creates a widget with defaults, embed code and review link', async () => {
    const widget = await createWidget({ name: 'Main St' });
    assert.equal(widget.layout, 'grid');
    assert.equal(widget.minRating, 4);
    assert.equal(widget.reviewLink, `https://widgets.example/r/${widget.id}`);
    assert.match(widget.embedCode, new RegExp(`data-review-widget="${widget.id}"`));
    assert.match(widget.embedCode, /https:\/\/widgets\.example\/widget\.js/);
  });

  it('validates widget input', async () => {
    const bad = [
      {},
      { placeId: 'x', layout: 'spiral' },
      { placeId: 'x', minRating: 9 },
      { placeId: 'x', accentColor: 'red;}' },
      { placeId: 'x', hacker: true },
    ];
    for (const body of bad) {
      const res = await call('/api/admin/widgets', { method: 'POST', body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  it('serves public widget data filtered by rating, with CORS', async () => {
    const widget = await createWidget({ minRating: 5, maxReviews: 2 });
    const res = await call(`/api/public/widgets/${widget.id}`, { key: null });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const data = await res.json();
    assert.equal(data.reviews.length, 2);
    assert.ok(data.reviews.every((r) => r.rating === 5));
    assert.equal(data.place.reviewLink, `https://widgets.example/r/${widget.id}`);
    assert.equal(data.widget.accentColor, '#1a73e8', 'falls back to agency brand color');
    assert.equal(data.branding.poweredByText, 'Powered by Acme Local');
    assert.equal(data.widget.agencyId, undefined, 'does not leak internal fields');
  });

  it('hides footer branding when white-labeled', async () => {
    const widget = await createWidget();
    const put = await call('/api/admin/branding', {
      method: 'PUT',
      body: { hidePoweredBy: true, logoUrl: 'https://acme.example/logo.png' },
    });
    assert.equal(put.status, 200);
    const data = await (await call(`/api/public/widgets/${widget.id}`, { key: null })).json();
    assert.equal(data.branding.poweredByText, '');
    assert.equal(data.branding.logoUrl, '');
    await call('/api/admin/branding', { method: 'PUT', body: { hidePoweredBy: false } });
  });

  it('rejects non-http logo URLs', async () => {
    const res = await call('/api/admin/branding', { method: 'PUT', body: { logoUrl: 'javascript:alert(1)' } });
    assert.equal(res.status, 400);
  });

  it('redirects review links to the Google review form', async () => {
    const widget = await createWidget();
    const res = await call(`/r/${widget.id}`, { key: null });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://search.google.com/local/writereview?placeid=demo-place');
  });

  it("does not let an agency see or change another agency's widgets", async () => {
    const widget = await createWidget();
    const list = await (await call('/api/admin/widgets', { key: otherKey })).json();
    assert.equal(list.widgets.length, 0);
    const patch = await call(`/api/admin/widgets/${widget.id}`, { key: otherKey, method: 'PATCH', body: { layout: 'list' } });
    assert.equal(patch.status, 404);
    const del = await call(`/api/admin/widgets/${widget.id}`, { key: otherKey, method: 'DELETE' });
    assert.equal(del.status, 404);
    assert.ok(store.getWidget(widget.id));
  });

  it('updates and deletes a widget', async () => {
    const widget = await createWidget();
    const patch = await call(`/api/admin/widgets/${widget.id}`, { method: 'PATCH', body: { layout: 'carousel' } });
    assert.equal((await patch.json()).widget.layout, 'carousel');
    assert.equal((await call(`/api/admin/widgets/${widget.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call(`/api/public/widgets/${widget.id}`, { key: null })).status, 404);
  });

  it('reports health and the running version', async () => {
    const res = await call('/healthz', { key: null });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', version: '1.2.3', demoMode: true });
  });

  it('lets the operator provision an agency that can then sign in', async () => {
    const res = await call('/api/operator/agencies', { key: 'op_secret', method: 'POST', body: { name: 'New Agency' } });
    assert.equal(res.status, 201);
    const { agency, apiKey: newKey } = await res.json();
    assert.equal(agency.name, 'New Agency');
    assert.equal(agency.apiKeyHash, undefined, 'does not expose the key hash');
    const me = await (await call('/api/admin/me', { key: newKey })).json();
    assert.equal(me.agency.id, agency.id);
  });

  it('rejects operator requests without the operator key', async () => {
    for (const key of [null, 'wrong', apiKey]) {
      const res = await call('/api/operator/agencies', { key, method: 'POST', body: { name: 'X' } });
      assert.equal(res.status, 401);
    }
    const bad = await call('/api/operator/agencies', { key: 'op_secret', method: 'POST', body: { name: '' } });
    assert.equal(bad.status, 400);
  });

  it('searches places', async () => {
    const data = await (await call('/api/admin/places/search?q=Smile%20Dental')).json();
    assert.equal(data.places[0].name, 'Smile Dental');
  });
});

describe('HTTP API without an operator key', () => {
  it('disables the operator API', async () => {
    const app = createApp({
      store: new Store(null),
      reviews: new ReviewService(new DemoPlacesClient()),
      config: { publicUrl: 'http://x', demoMode: true },
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/operator/agencies`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ', 'Content-Type': 'application/json' },
        body: '{"name":"X"}',
      });
      assert.equal(res.status, 401);
    } finally {
      server.close();
    }
  });
});

describe('HTTP API when things go wrong', () => {
  let server;
  let baseUrl;
  let store;
  let apiKey;
  let otherKey;
  let google;

  before(async () => {
    store = new Store(null);
    ({ apiKey } = store.createAgency('Acme Local'));
    ({ apiKey: otherKey } = store.createAgency('Rival Agency'));
    // A Google that can be taken down, and that counts how often it is asked.
    google = {
      down: false,
      calls: 0,
      async getPlace(placeId) {
        google.calls++;
        if (google.down) throw new Error('Google Places API 503: upstream secret detail');
        return { placeId, name: 'Smile Dental', rating: 4.8, userRatingCount: 1, mapsUrl: '', reviews: [] };
      },
      async searchPlaces() {
        if (google.down) throw new Error('Google Places API 503: upstream secret detail');
        return [];
      },
    };
    const app = createApp({
      store,
      reviews: new ReviewService(google),
      config: { publicUrl: 'https://widgets.example', demoMode: false },
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  beforeEach(() => {
    google.down = false;
    google.calls = 0;
  });

  const call = (path, { key = apiKey, method = 'GET', body, rawBody } = {}) =>
    fetch(`${baseUrl}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(body || rawBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: rawBody ?? (body ? JSON.stringify(body) : undefined),
    });

  let placeCounter = 0;
  const createWidget = async () => {
    const res = await call('/api/admin/widgets', { method: 'POST', body: { placeId: `place-${++placeCounter}` } });
    return (await res.json()).widget;
  };

  it('tells the visitor reviews are unavailable when Google is down and nothing is cached', async (t) => {
    t.mock.method(console, 'error', () => {});
    const widget = await createWidget();
    google.down = true;

    const res = await call(`/api/public/widgets/${widget.id}`, { key: null });

    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'Reviews are temporarily unavailable' });
  });

  it('reports a failed place search without exposing Google error details', async (t) => {
    t.mock.method(console, 'error', () => {});
    google.down = true;

    const res = await call('/api/admin/places/search?q=smile');

    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'Place search failed' });
  });

  it('requires a search query', async () => {
    const res = await call('/api/admin/places/search?q=%20');

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Query parameter q is required' });
  });

  it("lets an agency refresh a widget's reviews, so the next view asks Google again", async () => {
    const widget = await createWidget();
    await call(`/api/public/widgets/${widget.id}`, { key: null });
    await call(`/api/public/widgets/${widget.id}`, { key: null });
    assert.equal(google.calls, 1, 'second view is served from the cache');

    const res = await call(`/api/admin/widgets/${widget.id}/refresh`, { method: 'POST' });
    await call(`/api/public/widgets/${widget.id}`, { key: null });

    assert.equal(res.status, 204);
    assert.equal(google.calls, 2);
  });

  it("does not let an agency refresh another agency's widget", async () => {
    const widget = await createWidget();

    const res = await call(`/api/admin/widgets/${widget.id}/refresh`, { key: otherKey, method: 'POST' });

    assert.equal(res.status, 404);
  });

  it('serves the embed script to any website, cached for an hour', async () => {
    const res = await call('/widget.js', { key: null });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
    assert.match(await res.text(), /window\.ReviewWidget/);
  });

  it('sends visitors of the root URL to the agency dashboard', async () => {
    const res = await call('/', { key: null });

    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/admin/');
  });

  it('rejects malformed JSON with a clear message', async () => {
    const res = await call('/api/admin/widgets', { method: 'POST', rawBody: '{"placeId": ' });

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Invalid JSON body' });
  });

  it('rejects an oversized request body as too large', async (t) => {
    t.mock.method(console, 'error', () => {});
    const res = await call('/api/admin/branding', { method: 'PUT', body: { brandName: 'x'.repeat(30_000) } });

    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: 'Request body too large' });
  });

  it('hides internal error details from API clients', async (t) => {
    const logged = t.mock.method(console, 'error', () => {});
    t.mock.method(store, 'createWidget', () => {
      throw new Error('EACCES: permission denied, open data/db.json');
    });

    const res = await call('/api/admin/widgets', { method: 'POST', body: { placeId: 'x' } });

    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Internal server error' });
    assert.match(String(logged.mock.calls[0].arguments[0]), /EACCES/, 'the detail is logged for operators');
  });
});

describe('HTTP API: monthly Google request limit per widget', () => {
  let server;
  let baseUrl;
  let store;
  let apiKey;
  let google;
  let now;

  const start = async ({ limit = 2, reviews } = {}) => {
    server?.close();
    const app = createApp({
      store,
      reviews: reviews ?? new ReviewService(google, { ttlSeconds: 60, now: () => now }),
      config: { publicUrl: 'https://widgets.example', demoMode: false, googleRequestsPerWidgetPerMonth: limit },
      now: () => now,
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  };

  beforeEach(async () => {
    store = new Store(null);
    ({ apiKey } = store.createAgency('Acme Local'));
    now = Date.parse('2026-10-15T12:00:00Z');
    google = {
      calls: 0,
      async getPlace(placeId) {
        google.calls++;
        return { placeId, name: 'Smile Dental', rating: 4.8, userRatingCount: 1, mapsUrl: '', reviews: [] };
      },
    };
    await start();
  });

  after(() => server.close());

  const call = (path, { key = apiKey, method = 'GET', body } = {}) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  const createWidget = async () =>
    (await (await call('/api/admin/widgets', { method: 'POST', body: { placeId: 'place-1' } })).json()).widget;
  const view = (widget) => call(`/api/public/widgets/${widget.id}`, { key: null });
  const refresh = (widget) => call(`/api/admin/widgets/${widget.id}/refresh`, { method: 'POST' });
  const anHourLater = () => (now += 3_600_000);

  it('counts only views that ask Google, and shows the agency its usage', async () => {
    const widget = await createWidget();
    await view(widget);
    await view(widget);

    const { widgets } = await (await call('/api/admin/widgets')).json();

    assert.equal(google.calls, 1);
    assert.deepEqual(widgets[0].googleUsage, { month: '2026-10', requests: 1 });
  });

  it('keeps showing cached reviews once the allowance is used, without asking Google', async () => {
    const widget = await createWidget();
    await view(widget);
    anHourLater();
    await view(widget);
    anHourLater();

    const res = await view(widget);

    assert.equal(res.status, 200);
    assert.equal((await res.json()).place.name, 'Smile Dental');
    assert.equal(google.calls, 2);
  });

  it('refuses to refresh a widget that has used its allowance, saying why', async () => {
    const widget = await createWidget();
    await view(widget);
    await refresh(widget);
    await view(widget);

    const res = await refresh(widget);

    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { error: 'This widget has used its 2 Google requests for this month' });
  });

  it('starts a new allowance each calendar month', async () => {
    const widget = await createWidget();
    await view(widget);
    await refresh(widget);
    await view(widget);
    now = Date.parse('2026-11-01T00:00:00Z');

    assert.equal((await refresh(widget)).status, 204);
    await view(widget);
    assert.equal(google.calls, 3);
  });

  it('fails quietly if the allowance is used and nothing is cached, e.g. after a restart', async (t) => {
    t.mock.method(console, 'error', () => {});
    const widget = await createWidget();
    await view(widget);
    await refresh(widget);
    await view(widget);
    await start({ reviews: new ReviewService(google) }); // a restart empties the in-memory cache

    const res = await view(widget);

    assert.equal(res.status, 502);
    assert.equal(google.calls, 2);
  });

  it('does not limit anything when the limit is 0', async () => {
    await start({ limit: 0 });
    const widget = await createWidget();
    for (let i = 0; i < 5; i++) {
      assert.equal((await refresh(widget)).status, 204);
      await view(widget);
    }

    assert.equal(google.calls, 5);
  });

  it('does not let an agency reset its own usage', async () => {
    const widget = await createWidget();

    const res = await call(`/api/admin/widgets/${widget.id}`, { method: 'PATCH', body: { googleUsage: { month: '2026-10', requests: 0 } } });

    assert.equal(res.status, 400);
  });
});
