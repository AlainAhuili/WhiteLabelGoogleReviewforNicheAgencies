import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeReviewUrl } from './google.js';
import { selectReviews } from './reviews.js';
import { ValidationError, validateBranding, validateWidget } from './validation.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

function publicBranding(branding) {
  return {
    brandName: branding.brandName,
    logoUrl: branding.hidePoweredBy ? '' : branding.logoUrl,
    primaryColor: branding.primaryColor,
    poweredByText: branding.hidePoweredBy ? '' : branding.poweredByText || `Powered by ${branding.brandName}`,
    poweredByUrl: branding.hidePoweredBy ? '' : branding.poweredByUrl,
  };
}

function bearerToken(req) {
  const match = /^Bearer (.+)$/.exec(req.get('Authorization') || '');
  return match ? match[1].trim() : '';
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function publicAgency(agency) {
  return { id: agency.id, name: agency.name, branding: agency.branding };
}

/**
 * @param {object} deps
 * @param {import('./store.js').Store} deps.store
 * @param {import('./reviews.js').ReviewService} deps.reviews
 * @param {{ publicUrl: string, demoMode: boolean, version?: string, operatorApiKey?: string }} deps.config
 */
export function createApp({ store, reviews, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  // Used by the deployment pipeline's smoke tests and by load balancers.
  app.get('/healthz', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', version: config.version || 'dev', demoMode: config.demoMode });
  });

  // ---- Public, embeddable endpoints -------------------------------------

  const publicApi = express.Router();
  publicApi.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    next();
  });

  publicApi.get('/widgets/:id', async (req, res) => {
    const widget = store.getWidget(req.params.id);
    if (!widget) return res.status(404).json({ error: 'Widget not found' });
    const agency = store.getAgency(widget.agencyId);

    let place;
    try {
      place = await reviews.getPlace(widget.placeId);
    } catch (err) {
      console.error(`Failed to load reviews for widget ${widget.id}:`, err.message);
      return res.status(502).json({ error: 'Reviews are temporarily unavailable' });
    }

    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      widget: {
        id: widget.id,
        layout: widget.layout,
        theme: widget.theme,
        accentColor: widget.accentColor || agency.branding.primaryColor,
        showReviewButton: widget.showReviewButton,
      },
      branding: publicBranding(agency.branding),
      place: {
        name: place.name,
        rating: place.rating,
        userRatingCount: place.userRatingCount,
        mapsUrl: place.mapsUrl,
        reviewLink: `${config.publicUrl}/r/${widget.id}`,
      },
      reviews: selectReviews(place.reviews, widget),
    });
  });

  app.use('/api/public', publicApi);

  // Short, shareable "leave us a review" link for emails, SMS and QR codes.
  app.get('/r/:id', (req, res) => {
    const widget = store.getWidget(req.params.id);
    if (!widget) return res.status(404).send('Review link not found');
    res.redirect(302, writeReviewUrl(widget.placeId));
  });

  // ---- Agency admin API --------------------------------------------------

  const admin = express.Router();

  admin.use((req, res, next) => {
    const token = bearerToken(req);
    const agency = token && store.findAgencyByApiKey(token);
    if (!agency) return res.status(401).json({ error: 'Invalid or missing API key' });
    req.agency = agency;
    next();
  });

  function ownWidget(req, res) {
    const widget = store.getWidget(req.params.id);
    if (!widget || widget.agencyId !== req.agency.id) {
      res.status(404).json({ error: 'Widget not found' });
      return null;
    }
    return widget;
  }

  function withLinks(widget) {
    return {
      ...widget,
      reviewLink: `${config.publicUrl}/r/${widget.id}`,
      embedCode:
        `<div data-review-widget="${widget.id}"></div>\n` +
        `<script src="${config.publicUrl}/widget.js" async></script>`,
    };
  }

  admin.get('/me', (req, res) => {
    res.json({ agency: publicAgency(req.agency), demoMode: config.demoMode });
  });

  admin.put('/branding', (req, res) => {
    const agency = store.updateBranding(req.agency.id, validateBranding(req.body));
    res.json({ agency: publicAgency(agency) });
  });

  admin.get('/places/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Query parameter q is required' });
    try {
      res.json({ places: await reviews.searchPlaces(q) });
    } catch (err) {
      console.error('Place search failed:', err.message);
      res.status(502).json({ error: 'Place search failed' });
    }
  });

  admin.get('/widgets', (req, res) => {
    res.json({ widgets: store.listWidgets(req.agency.id).map(withLinks) });
  });

  admin.post('/widgets', (req, res) => {
    const widget = store.createWidget(req.agency.id, validateWidget(req.body));
    res.status(201).json({ widget: withLinks(widget) });
  });

  admin.patch('/widgets/:id', (req, res) => {
    const widget = ownWidget(req, res);
    if (!widget) return;
    const updated = store.updateWidget(widget.id, validateWidget(req.body, { partial: true }));
    res.json({ widget: withLinks(updated) });
  });

  admin.delete('/widgets/:id', (req, res) => {
    const widget = ownWidget(req, res);
    if (!widget) return;
    store.deleteWidget(widget.id);
    res.status(204).end();
  });

  admin.post('/widgets/:id/refresh', (req, res) => {
    const widget = ownWidget(req, res);
    if (!widget) return;
    reviews.invalidate(widget.placeId);
    res.status(204).end();
  });

  app.use('/api/admin', admin);

  // ---- Platform operator API ---------------------------------------------
  // Provisions agencies (e.g. when reselling). Disabled unless OPERATOR_API_KEY is set.

  const operator = express.Router();

  operator.use((req, res, next) => {
    const token = bearerToken(req);
    if (!config.operatorApiKey || !token || !safeEqual(token, config.operatorApiKey)) {
      return res.status(401).json({ error: 'Invalid or missing operator key' });
    }
    next();
  });

  operator.post('/agencies', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 100) {
      return res.status(400).json({ error: 'name is required (max 100 characters)' });
    }
    const { agency, apiKey } = store.createAgency(name);
    res.status(201).json({ agency: publicAgency(agency), apiKey });
  });

  app.use('/api/operator', operator);

  // ---- Static assets (widget.js, admin UI, demo page) --------------------

  app.get('/', (req, res) => res.redirect('/admin/'));

  app.use(
    express.static(PUBLIC_DIR, {
      setHeaders(res, path) {
        if (path.endsWith('widget.js')) {
          res.set('Access-Control-Allow-Origin', '*');
          res.set('Cache-Control', 'public, max-age=3600');
        }
      },
    }),
  );

  // ---- Errors --------------------------------------------------------------

  app.use((err, req, res, _next) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
