import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { JSDOM } from 'jsdom';

// The embed script is a classic browser script, so it runs here in a simulated
// DOM with fetch stubbed. Behavior in a real browser is covered by the
// acceptance tests; these give fast feedback and keep it under the coverage gate.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://client.example/' });
const { window } = dom;
const { document } = window;

let requests;
let respond;

globalThis.window = window;
globalThis.document = document;
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  return respond();
};

function respondWith(data) {
  respond = () => ({ ok: true, status: 200, json: async () => data });
}

function widgetData({ widget, branding, place, reviews } = {}) {
  return {
    widget: { id: 'w1', layout: 'list', theme: 'light', accentColor: '#0b8043', showReviewButton: false, ...widget },
    branding: { poweredByText: '', poweredByUrl: '', logoUrl: '', ...branding },
    place: {
      name: 'Sunrise Dental',
      rating: 4.7,
      userRatingCount: 128,
      mapsUrl: 'https://maps.google.com/?cid=1',
      reviewLink: 'https://widgets.example/r/w1',
      ...place,
    },
    reviews: reviews ?? [review()],
  };
}

function review(overrides) {
  return {
    author: 'Maria',
    authorUrl: '',
    authorPhotoUrl: '',
    rating: 5,
    text: 'Great service.',
    relativeTime: 'a week ago',
    ...overrides,
  };
}

function newHost() {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}

async function render(data) {
  respondWith(data);
  const host = newHost();
  await window.ReviewWidget.mount(host, 'w1');
  return { host, root: host.shadowRoot };
}

const text = (node) => node?.textContent.trim();
const nextTick = () => new Promise((resolve) => setImmediate(resolve));

before(async () => {
  await import('../public/widget.js');
});

beforeEach(() => {
  requests = [];
  document.body.textContent = '';
});

describe('Embed widget: loading', () => {
  it('fetches widget data from the server the script was loaded from', async () => {
    respondWith(widgetData());
    await window.ReviewWidget.mount(newHost(), 'w 1');

    assert.equal(requests[0].url, 'https://client.example/api/public/widgets/w%201');
    assert.equal(requests[0].options, undefined);
  });

  it('bypasses the browser cache when asked for fresh data (dashboard preview)', async () => {
    respondWith(widgetData());
    await window.ReviewWidget.mount(newHost(), 'w1', { fresh: true });

    assert.deepEqual(requests[0].options, { cache: 'no-store' });
  });

  it('does nothing for an element without a widget id', async () => {
    await window.ReviewWidget.mount(newHost());

    assert.equal(requests.length, 0);
  });

  it('mounts every widget on the page, and only once', async () => {
    respondWith(widgetData());
    const first = newHost();
    const second = newHost();
    first.setAttribute('data-review-widget', 'a');
    second.setAttribute('data-review-widget', 'b');

    window.ReviewWidget.init();
    window.ReviewWidget.init();
    await nextTick();

    assert.deepEqual(requests.map((r) => r.url.split('/').pop()), ['a', 'b']);
    assert.ok(first.shadowRoot.querySelector('.rw'));
    assert.ok(second.shadowRoot.querySelector('.rw'));
  });

  it('can re-render into the same element', async () => {
    const { host } = await render(widgetData());
    respondWith(widgetData({ place: { name: 'Harbor Plumbing' } }));

    await window.ReviewWidget.mount(host, 'w1');

    assert.equal(host.shadowRoot.querySelectorAll('.rw').length, 1);
    assert.equal(text(host.shadowRoot.querySelector('.name')), 'Harbor Plumbing');
  });

  it("fails quietly, without breaking the client's site, when the widget cannot load", async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    respond = () => ({ ok: false, status: 404 });
    const host = newHost();

    await window.ReviewWidget.mount(host, 'missing');

    assert.equal(host.shadowRoot.childNodes.length, 0);
    assert.match(warn.mock.calls[0].arguments.join(' '), /missing.*HTTP 404/);
  });
});

describe('Embed widget: what a visitor sees', () => {
  it('shows the business name, rating and number of Google reviews', async () => {
    const { root } = await render(widgetData());

    assert.equal(text(root.querySelector('.name')), 'Sunrise Dental');
    assert.equal(text(root.querySelector('.head .score')), '4.7');
    assert.equal(root.querySelector('.head .stars').getAttribute('aria-label'), 'Rated 4.7 out of 5');
    assert.equal(text(root.querySelector('.head .count')), '128 Google reviews');
  });

  it('leaves out the score for a business with no rating yet', async () => {
    const { root } = await render(widgetData({ place: { rating: null, userRatingCount: 0 } }));

    assert.equal(root.querySelector('.head .score'), null);
    assert.equal(text(root.querySelector('.head .count')), '0 Google reviews');
  });

  it("shows each review's author, stars, date and text", async () => {
    const { root } = await render(widgetData({ reviews: [review({ rating: 4 })] }));
    const card = root.querySelector('.card');

    assert.equal(text(card.querySelector('.author-name')), 'Maria');
    assert.equal(card.querySelector('.stars').getAttribute('aria-label'), 'Rated 4 out of 5');
    assert.equal(card.querySelector('.stars .fill').style.width, '80%');
    assert.equal(text(card.querySelector('.meta')), 'a week ago');
    assert.equal(text(card.querySelector('.text')), 'Great service.');
  });

  it("links to the author's profile in a new tab", async () => {
    const { root } = await render(widgetData({ reviews: [review({ authorUrl: 'https://maps.google.com/u/1' })] }));
    const author = root.querySelector('.author-name');

    assert.equal(author.tagName, 'A');
    assert.equal(author.href, 'https://maps.google.com/u/1');
    assert.equal(author.target, '_blank');
    assert.equal(author.rel, 'noopener nofollow');
  });

  it('never turns a non-web URL into a link or an image', async () => {
    const { root } = await render(
      widgetData({ reviews: [review({ authorUrl: 'javascript:alert(1)', authorPhotoUrl: 'data:image/png;base64,x' })] }),
    );

    assert.equal(root.querySelector('.author-name').tagName, 'SPAN');
    assert.equal(root.querySelector('img'), null);
  });

  it('clamps long reviews and lets the visitor expand and collapse them', async () => {
    const long = 'Excellent. '.repeat(30).trim();
    const { root } = await render(widgetData({ reviews: [review({ text: long })] }));
    const body = root.querySelector('.text');
    const more = root.querySelector('.more');

    assert.ok(body.textContent.endsWith('…'));
    assert.ok(body.textContent.length < long.length);
    assert.equal(more.textContent, 'Read more');

    more.click();
    assert.equal(body.textContent, long);
    assert.equal(more.textContent, 'Show less');
    assert.equal(more.getAttribute('aria-expanded'), 'true');

    more.click();
    assert.ok(body.textContent.endsWith('…'));
    assert.equal(more.getAttribute('aria-expanded'), 'false');
  });

  it('does not offer "Read more" on short reviews', async () => {
    const { root } = await render(widgetData());

    assert.equal(root.querySelector('.more'), null);
  });

  it('shows a message when there are no reviews to show', async () => {
    const { root } = await render(widgetData({ reviews: [] }));

    assert.equal(text(root.querySelector('.empty')), 'No reviews to show yet.');
  });
});

describe('Embed widget: reviewer avatars', () => {
  it("shows the reviewer's photo", async () => {
    const { root } = await render(widgetData({ reviews: [review({ authorPhotoUrl: 'https://lh3.example/maria.jpg' })] }));
    const avatar = root.querySelector('.avatar');

    assert.equal(avatar.tagName, 'IMG');
    assert.equal(avatar.src, 'https://lh3.example/maria.jpg');
    assert.equal(avatar.alt, '');
  });

  it("shows the reviewer's initial when they have no photo", async () => {
    const { root } = await render(widgetData({ reviews: [review({ author: ' james' })] }));

    assert.equal(text(root.querySelector('.avatar')), 'J');
  });

  it("falls back to the reviewer's initial when their photo fails to load", async () => {
    const { root } = await render(widgetData({ reviews: [review({ authorPhotoUrl: 'https://lh3.example/gone.jpg' })] }));

    root.querySelector('img.avatar').dispatchEvent(new window.Event('error'));

    assert.equal(root.querySelector('img'), null);
    assert.equal(text(root.querySelector('.avatar')), 'M');
  });

  it('shows a placeholder for an anonymous reviewer', async () => {
    const { root } = await render(widgetData({ reviews: [review({ author: '' })] }));

    assert.equal(text(root.querySelector('.avatar')), '?');
  });
});

describe('Embed widget: branding and attribution', () => {
  it('always credits Google, linking to the business on Google Maps', async () => {
    const { root } = await render(widgetData());
    const source = root.querySelector('.foot a');

    assert.equal(text(source), 'Reviews from Google');
    assert.equal(source.href, 'https://maps.google.com/?cid=1');
  });

  it("shows the agency's footer branding with its logo and link", async () => {
    const { root } = await render(
      widgetData({
        branding: { poweredByText: 'Reviews by BrightLocal', poweredByUrl: 'https://brightlocal.example/', logoUrl: 'https://brightlocal.example/logo.png' },
      }),
    );
    const powered = root.querySelector('.powered');

    assert.equal(text(powered), 'Reviews by BrightLocal');
    assert.equal(powered.href, 'https://brightlocal.example/');
    assert.equal(powered.querySelector('img.logo').src, 'https://brightlocal.example/logo.png');
  });

  it('shows agency branding without a logo when none is set', async () => {
    const { root } = await render(widgetData({ branding: { poweredByText: 'Reviews by BrightLocal' } }));

    assert.equal(text(root.querySelector('.powered')), 'Reviews by BrightLocal');
    assert.equal(root.querySelector('.logo'), null);
  });

  it('shows no agency branding when the agency is fully white-labeled', async () => {
    const { root } = await render(widgetData());

    assert.equal(root.querySelector('.powered'), null);
  });

  it('shows a "Write a review" button only when the agency turns it on', async () => {
    const off = await render(widgetData());
    const on = await render(widgetData({ widget: { showReviewButton: true } }));

    assert.equal(off.root.querySelector('.btn'), null);
    assert.equal(on.root.querySelector('.btn').href, 'https://widgets.example/r/w1');
  });

  it("applies the widget's theme and accent color", async () => {
    const custom = await render(widgetData({ widget: { theme: 'dark', accentColor: '#0b8043' } }));
    const defaults = await render(widgetData({ widget: { theme: undefined, accentColor: undefined } }));

    assert.equal(custom.host.getAttribute('data-theme'), 'dark');
    assert.equal(custom.host.style.getPropertyValue('--accent'), '#0b8043');
    assert.equal(defaults.host.getAttribute('data-theme'), 'light');
    assert.equal(defaults.host.style.getPropertyValue('--accent'), '#1a73e8');
  });
});

describe('Embed widget: layouts', () => {
  const threeReviews = [review({ author: 'A' }), review({ author: 'B' }), review({ author: 'C' })];

  for (const layout of ['grid', 'list']) {
    it(`shows reviews in a ${layout}`, async () => {
      const { root } = await render(widgetData({ widget: { layout }, reviews: threeReviews }));

      assert.equal(root.querySelectorAll(`.${layout} > .card`).length, 3);
    });
  }

  it('shows reviews in a carousel the visitor can scroll with buttons', async () => {
    const { root } = await render(widgetData({ widget: { layout: 'carousel' }, reviews: threeReviews }));
    const track = root.querySelector('.track');
    const scrolls = [];
    Object.defineProperty(track, 'clientWidth', { value: 300 });
    track.scrollBy = (options) => scrolls.push(options.left);

    const [previous, next] = root.querySelectorAll('.nav .icon-btn');
    next.click();
    previous.click();

    assert.equal(track.querySelectorAll('.card').length, 3);
    assert.equal(next.getAttribute('aria-label'), 'Next reviews');
    assert.deepEqual(scrolls, [270, -270]);
  });

  it('has no carousel buttons when there is only one review', async () => {
    const { root } = await render(widgetData({ widget: { layout: 'carousel' } }));

    assert.ok(root.querySelector('.track .card'));
    assert.equal(root.querySelector('.nav'), null);
  });

  it('shows a floating badge that opens and closes a review panel', async () => {
    const { root } = await render(widgetData({ widget: { layout: 'badge' } }));
    const badge = root.querySelector('.badge');
    const panel = root.querySelector('.panel');

    assert.equal(text(badge.querySelector('.score')), '4.7');
    assert.equal(text(badge.querySelector('.count')), '128 reviews');
    assert.equal(panel.hidden, true);

    badge.click();
    assert.equal(panel.hidden, false);
    assert.equal(badge.getAttribute('aria-expanded'), 'true');
    assert.ok(panel.querySelector('.list .card'));

    badge.click();
    assert.equal(panel.hidden, true);
  });

  it('shows the badge without a score for a business with no rating yet', async () => {
    const { root } = await render(widgetData({ widget: { layout: 'badge' }, place: { rating: null } }));

    assert.equal(root.querySelector('.badge .score'), null);
  });
});
