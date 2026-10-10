/**
 * Stub of the Google Places API (New), used to isolate the system under test from
 * Google at its boundary during acceptance testing.
 *
 * Production-facing routes mimic the real API:
 *   GET  /v1/places/:placeId
 *   POST /v1/places:searchText
 *
 * A fake photo host stands in for Google's reviewer photo CDN:
 *   GET  /photos/reviewer.png               a valid image; any other photo is 404
 *
 * Back-channel routes let acceptance tests arrange data and inspect calls:
 *   PUT  /__stub/places/:placeId            set a place resource
 *   GET  /__stub/places/:placeId/requests   how often the SUT fetched this place
 *   GET  /__stub/health
 *
 * Run standalone: node acceptance/stubs/google-places-stub.js   (port: STUB_PORT, default 3999)
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

// 1x1 transparent PNG.
const REVIEWER_PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function googleError(res, status, message) {
  send(res, status, { error: { code: status, message, status: status === 404 ? 'NOT_FOUND' : 'PERMISSION_DENIED' } });
}

export function createGooglePlacesStub() {
  const places = new Map();
  const requestCounts = new Map();

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://stub');
      const path = url.pathname;
      let m;

      // ---- Back channel ----
      if (path === '/__stub/health') return send(res, 200, { status: 'ok' });

      if ((m = /^\/__stub\/places\/([^/]+)$/.exec(path)) && req.method === 'PUT') {
        const id = decodeURIComponent(m[1]);
        places.set(id, { ...(await readJson(req)), id });
        requestCounts.set(id, 0);
        return send(res, 204);
      }

      if ((m = /^\/__stub\/places\/([^/]+)\/requests$/.exec(path)) && req.method === 'GET') {
        return send(res, 200, { count: requestCounts.get(decodeURIComponent(m[1])) || 0 });
      }

      // ---- Fake photo host ----
      if (path.startsWith('/photos/')) {
        if (path !== '/photos/reviewer.png') return send(res, 404, { error: 'No such photo' });
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(REVIEWER_PHOTO);
      }

      // ---- Fake Google Places API ----
      if (!req.headers['x-goog-api-key']) return googleError(res, 403, 'API key missing');

      if (path === '/v1/places:searchText' && req.method === 'POST') {
        const { textQuery = '' } = await readJson(req);
        const q = textQuery.toLowerCase();
        const matches = [...places.values()].filter((p) => p.displayName?.text?.toLowerCase().includes(q));
        return send(res, 200, matches.length ? { places: matches } : {});
      }

      if ((m = /^\/v1\/places\/([^/:]+)$/.exec(path)) && req.method === 'GET') {
        const id = decodeURIComponent(m[1]);
        requestCounts.set(id, (requestCounts.get(id) || 0) + 1);
        const place = places.get(id);
        return place ? send(res, 200, place) : googleError(res, 404, `Place ${id} not found`);
      }

      send(res, 404, { error: 'Unknown stub route' });
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.STUB_PORT) || 3999;
  createGooglePlacesStub().listen(port, () => console.log(`Google Places stub listening on :${port}`));
}
