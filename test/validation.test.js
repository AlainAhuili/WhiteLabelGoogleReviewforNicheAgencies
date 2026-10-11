import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError, WIDGET_DEFAULTS, validateBranding, validateWidget } from '../src/validation.js';

function assertRejects(fn, message) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof ValidationError, `expected a ValidationError, got ${err}`);
    assert.equal(err.message, message);
    return true;
  });
}

describe('validateWidget', () => {
  it('applies defaults to a new widget, trimming text and lowercasing colors', () => {
    const widget = validateWidget({ placeId: '  ChIJ1 ', name: ' Homepage ', accentColor: '#0B8043' });

    assert.deepEqual(widget, { ...WIDGET_DEFAULTS, placeId: 'ChIJ1', name: 'Homepage', accentColor: '#0b8043' });
  });

  it('accepts every valid layout, theme and rating range', () => {
    for (const layout of ['grid', 'carousel', 'list', 'badge']) validateWidget({ placeId: 'x', layout });
    for (const theme of ['light', 'dark', 'auto']) validateWidget({ placeId: 'x', theme });
    for (const n of [1, 5]) validateWidget({ placeId: 'x', minRating: n, maxReviews: n });
  });

  it('requires a business for a new widget', () => {
    assertRejects(() => validateWidget({}), 'placeId is required');
    assertRejects(() => validateWidget({ placeId: '   ' }), 'placeId is required');
  });

  it('validates only the given fields on update, without defaults', () => {
    assert.deepEqual(validateWidget({ layout: 'list' }, { partial: true }), { layout: 'list' });
    assert.deepEqual(validateWidget({}, { partial: true }), {});
  });

  const invalidWidgets = [
    [{ layout: 'spiral' }, 'layout must be one of: grid, carousel, list, badge'],
    [{ theme: 'neon' }, 'theme must be one of: light, dark, auto'],
    [{ minRating: 0 }, 'minRating must be an integer between 1 and 5'],
    [{ minRating: 6 }, 'minRating must be an integer between 1 and 5'],
    [{ minRating: 4.5 }, 'minRating must be an integer between 1 and 5'],
    [{ minRating: '4' }, 'minRating must be an integer between 1 and 5'],
    [{ maxReviews: 10 }, 'maxReviews must be an integer between 1 and 5'],
    [{ showReviewButton: 'yes' }, 'showReviewButton must be true or false'],
    [{ accentColor: 'red;}' }, 'accentColor must be a hex color like #1a73e8'],
    [{ accentColor: '#1a73e8;}' }, 'accentColor must be at most 7 characters'],
    [{ accentColor: '#fff' }, 'accentColor must be a hex color like #1a73e8'],
    [{ name: 'x'.repeat(101) }, 'name must be at most 100 characters'],
    [{ name: 42 }, 'name must be a string'],
    [{ placeId: 'x'.repeat(301) }, 'placeId must be at most 300 characters'],
  ];
  for (const [fields, message] of invalidWidgets) {
    it(`rejects ${JSON.stringify(fields).slice(0, 40)}: "${message}"`, () => {
      assertRejects(() => validateWidget({ placeId: 'x', ...fields }), message);
    });
  }

  it('rejects fields an agency must not set, such as the owning agency', () => {
    assertRejects(() => validateWidget({ placeId: 'x', agencyId: 'ag_other' }), 'Unknown field: agencyId');
    assertRejects(() => validateWidget({ id: 'w_1' }, { partial: true }), 'Unknown field: id');
  });

  it('rejects a request body that is not a JSON object', () => {
    for (const body of [null, undefined, 'placeId=x', 42, ['x']]) {
      assertRejects(() => validateWidget(body), 'Request body must be a JSON object');
    }
  });
});

describe('validateBranding', () => {
  it('accepts valid branding, trimmed and with the color lowercased', () => {
    const branding = validateBranding({
      brandName: ' Acme ',
      logoUrl: 'https://acme.example/logo.png',
      primaryColor: '#1A73E8',
      poweredByText: 'Reviews by Acme',
      poweredByUrl: 'http://acme.example',
      hidePoweredBy: true,
    });

    assert.deepEqual(branding, {
      brandName: 'Acme',
      logoUrl: 'https://acme.example/logo.png',
      primaryColor: '#1a73e8',
      poweredByText: 'Reviews by Acme',
      poweredByUrl: 'http://acme.example',
      hidePoweredBy: true,
    });
  });

  it('lets an agency clear its logo and footer link', () => {
    assert.deepEqual(validateBranding({ logoUrl: '', poweredByUrl: ' ' }), { logoUrl: '', poweredByUrl: '' });
  });

  it('only accepts web links for the logo and footer', () => {
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,x', 'ftp://acme.example', 'not a url']) {
      assertRejects(() => validateBranding({ logoUrl: bad }), 'logoUrl must be an http(s) URL');
      assertRejects(() => validateBranding({ poweredByUrl: bad }), 'poweredByUrl must be an http(s) URL');
    }
    assertRejects(
      () => validateBranding({ logoUrl: `https://acme.example/${'x'.repeat(2000)}` }),
      'logoUrl must be at most 2000 characters',
    );
  });

  it('requires a valid brand color', () => {
    assertRejects(() => validateBranding({ primaryColor: '' }), 'primaryColor is required');
    assertRejects(() => validateBranding({ primaryColor: 'blue' }), 'primaryColor must be a hex color like #1a73e8');
  });

  it('rejects invalid footer settings and unknown fields', () => {
    assertRejects(() => validateBranding({ hidePoweredBy: 'true' }), 'hidePoweredBy must be true or false');
    assertRejects(() => validateBranding({ apiKeyHash: 'x' }), 'Unknown field: apiKeyHash');
    assertRejects(() => validateBranding([]), 'Request body must be a JSON object');
  });
});
