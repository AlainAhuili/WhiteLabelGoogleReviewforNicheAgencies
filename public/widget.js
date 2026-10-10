/*!
 * Review widget embed script.
 * Usage:
 *   <div data-review-widget="WIDGET_ID"></div>
 *   <script src="https://YOUR-SERVER/widget.js" async></script>
 */
(function () {
  'use strict';

  if (window.ReviewWidget) {
    window.ReviewWidget.init();
    return;
  }

  var script = document.currentScript;
  var BASE_URL = script ? new URL(script.src).origin : window.location.origin;
  var CLAMP_CHARS = 220;

  var STYLES = [
    ':host{all:initial;display:block;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;',
    '--bg:#ffffff;--card:#f7f8fa;--text:#1f2328;--muted:#5f6368;--border:#e3e6ea;--star:#fbbc04;--star-empty:#dadce0}',
    ':host([data-theme="dark"]){--bg:#16181c;--card:#1f2228;--text:#e8eaed;--muted:#9aa0a6;--border:#2e3238;--star-empty:#3c4043}',
    '@media (prefers-color-scheme:dark){:host([data-theme="auto"]){--bg:#16181c;--card:#1f2228;--text:#e8eaed;--muted:#9aa0a6;--border:#2e3238;--star-empty:#3c4043}}',
    '*{box-sizing:border-box}',
    'a{color:inherit}',
    '.rw{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:14px;padding:20px}',
    '.head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}',
    '.name{font-weight:600;font-size:16px;margin:0 0 2px}',
    '.summary{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.score{font-size:28px;font-weight:700;line-height:1}',
    '.count{color:var(--muted);font-size:13px}',
    '.stars{position:relative;display:inline-block;width:max-content;align-self:flex-start;font-size:17px;letter-spacing:1px;line-height:1;color:var(--star-empty);white-space:nowrap}',
    '.stars .fill{position:absolute;left:0;top:0;overflow:hidden;color:var(--star)}',
    '.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:9px 16px;border-radius:999px;border:0;cursor:pointer}',
    '.btn:hover{filter:brightness(1.08)}',
    '.btn:focus-visible,.icon-btn:focus-visible,.more:focus-visible,.badge:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}',
    '.list{display:flex;flex-direction:column;gap:12px}',
    '.track{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;padding-bottom:4px;scrollbar-width:none}',
    '.track::-webkit-scrollbar{display:none}',
    '.track .card{flex:0 0 min(300px,85%);scroll-snap-align:start}',
    '.nav{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}',
    '.icon-btn{width:34px;height:34px;border-radius:50%;border:1px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;font-size:16px}',
    '.card{background:var(--card);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px}',
    '.author{display:flex;align-items:center;gap:10px}',
    '.avatar{width:36px;height:36px;border-radius:50%;flex:0 0 36px;object-fit:cover;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600}',
    '.author-name{font-weight:600;font-size:14px;text-decoration:none}',
    'a.author-name:hover{text-decoration:underline}',
    '.meta{color:var(--muted);font-size:12px}',
    '.text{margin:0;white-space:pre-line;word-break:break-word}',
    '.more{background:none;border:0;padding:0;color:var(--accent);cursor:pointer;font:inherit;font-size:13px;align-self:flex-start}',
    '.foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:14px;color:var(--muted);font-size:12px}',
    '.foot a{text-decoration:none}.foot a:hover{text-decoration:underline}',
    '.g{font-weight:700}',
    '.powered{display:inline-flex;align-items:center;gap:6px}',
    '.logo{height:16px;max-width:80px;object-fit:contain}',
    '.empty{color:var(--muted);margin:0}',
    '.badge-wrap{position:fixed;left:20px;bottom:20px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-start;gap:10px}',
    '.badge{display:flex;align-items:center;gap:10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:12px;padding:10px 14px;box-shadow:0 4px 18px rgba(0,0,0,.15);cursor:pointer;font:inherit}',
    '.badge .score{font-size:20px}',
    '.panel{width:min(360px,calc(100vw - 40px));max-height:min(520px,calc(100vh - 110px));overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.2)}',
    '.panel[hidden]{display:none}',
  ].join('\n');

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function safeUrl(url) {
    try {
      var u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
    } catch {
      return '';
    }
  }

  function link(className, text, href) {
    var url = safeUrl(href);
    var node = el(url ? 'a' : 'span', className, text);
    if (url) {
      node.href = url;
      node.target = '_blank';
      node.rel = 'noopener nofollow';
    }
    return node;
  }

  function stars(rating) {
    var wrap = el('span', 'stars', '★★★★★');
    var fill = el('span', 'fill', '★★★★★');
    fill.style.width = Math.max(0, Math.min(5, rating || 0)) * 20 + '%';
    wrap.appendChild(fill);
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', 'Rated ' + rating + ' out of 5');
    return wrap;
  }

  function initialAvatar(review) {
    return el('span', 'avatar', (review.author || '?').trim().charAt(0).toUpperCase());
  }

  function avatar(review) {
    var photo = safeUrl(review.authorPhotoUrl);
    if (photo) {
      var img = el('img', 'avatar');
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      // Google photo URLs expire or get blocked; fall back to the initial.
      img.addEventListener('error', function () {
        img.replaceWith(initialAvatar(review));
      });
      img.src = photo;
      return img;
    }
    return initialAvatar(review);
  }

  function reviewCard(review) {
    var card = el('article', 'card');

    var author = el('div', 'author');
    author.appendChild(avatar(review));
    var who = el('div');
    who.appendChild(link('author-name', review.author, review.authorUrl));
    who.appendChild(el('div', 'meta', review.relativeTime));
    author.appendChild(who);
    card.appendChild(author);

    card.appendChild(stars(review.rating));

    var full = review.text || '';
    var long = full.length > CLAMP_CHARS;
    var text = el('p', 'text', long ? full.slice(0, CLAMP_CHARS).trimEnd() + '…' : full);
    card.appendChild(text);

    if (long) {
      var more = el('button', 'more', 'Read more');
      more.type = 'button';
      more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', function () {
        var expanded = more.getAttribute('aria-expanded') === 'true';
        text.textContent = expanded ? full.slice(0, CLAMP_CHARS).trimEnd() + '…' : full;
        more.textContent = expanded ? 'Read more' : 'Show less';
        more.setAttribute('aria-expanded', String(!expanded));
      });
      card.appendChild(more);
    }
    return card;
  }

  function header(data) {
    var head = el('div', 'head');
    var info = el('div');
    info.appendChild(el('p', 'name', data.place.name));
    var summary = el('div', 'summary');
    if (data.place.rating != null) {
      summary.appendChild(el('span', 'score', data.place.rating.toFixed(1)));
      summary.appendChild(stars(data.place.rating));
    }
    summary.appendChild(el('span', 'count', data.place.userRatingCount + ' Google reviews'));
    info.appendChild(summary);
    head.appendChild(info);

    if (data.widget.showReviewButton) {
      head.appendChild(link('btn', 'Write a review', data.place.reviewLink));
    }
    return head;
  }

  function footer(data) {
    var foot = el('div', 'foot');
    var source = link('', '', data.place.mapsUrl);
    source.appendChild(document.createTextNode('Reviews from '));
    source.appendChild(el('span', 'g', 'Google'));
    foot.appendChild(source);
    if (data.branding.poweredByText) {
      var powered = link('powered', '', data.branding.poweredByUrl);
      var logo = safeUrl(data.branding.logoUrl);
      if (logo) {
        var img = el('img', 'logo');
        img.src = logo;
        img.alt = '';
        powered.appendChild(img);
      }
      powered.appendChild(document.createTextNode(data.branding.poweredByText));
      foot.appendChild(powered);
    }
    return foot;
  }

  function reviewsBlock(data, layout) {
    if (!data.reviews.length) return el('p', 'empty', 'No reviews to show yet.');

    if (layout === 'carousel') {
      var frag = document.createDocumentFragment();
      var track = el('div', 'track');
      data.reviews.forEach(function (r) {
        track.appendChild(reviewCard(r));
      });
      frag.appendChild(track);
      if (data.reviews.length > 1) {
        var nav = el('div', 'nav');
        [['‹', -1, 'Previous reviews'], ['›', 1, 'Next reviews']].forEach(function (b) {
          var btn = el('button', 'icon-btn', b[0]);
          btn.type = 'button';
          btn.setAttribute('aria-label', b[2]);
          btn.addEventListener('click', function () {
            track.scrollBy({ left: b[1] * track.clientWidth * 0.9 });
          });
          nav.appendChild(btn);
        });
        frag.appendChild(nav);
      }
      return frag;
    }

    var container = el('div', layout === 'grid' ? 'grid' : 'list');
    data.reviews.forEach(function (r) {
      container.appendChild(reviewCard(r));
    });
    return container;
  }

  function panel(data, layout) {
    var box = el('section', 'rw');
    box.setAttribute('aria-label', 'Customer reviews for ' + data.place.name);
    box.appendChild(header(data));
    box.appendChild(reviewsBlock(data, layout));
    box.appendChild(footer(data));
    return box;
  }

  function badge(data) {
    var wrap = el('div', 'badge-wrap');
    var details = panel(data, 'list');
    details.classList.add('panel');
    details.hidden = true;

    var button = el('button', 'badge');
    button.type = 'button';
    button.setAttribute('aria-expanded', 'false');
    var label = el('div');
    var top = el('div', 'summary');
    top.appendChild(el('span', 'g', 'Google'));
    if (data.place.rating != null) {
      top.appendChild(el('span', 'score', data.place.rating.toFixed(1)));
      top.appendChild(stars(data.place.rating));
    }
    label.appendChild(top);
    label.appendChild(el('div', 'count', data.place.userRatingCount + ' reviews'));
    button.appendChild(label);
    button.addEventListener('click', function () {
      details.hidden = !details.hidden;
      button.setAttribute('aria-expanded', String(!details.hidden));
    });

    wrap.appendChild(details);
    wrap.appendChild(button);
    return wrap;
  }

  function render(root, host, data) {
    host.setAttribute('data-theme', data.widget.theme || 'light');
    host.style.setProperty('--accent', data.widget.accentColor || '#1a73e8');
    root.textContent = '';
    root.appendChild(el('style', null, STYLES));
    root.appendChild(data.widget.layout === 'badge' ? badge(data) : panel(data, data.widget.layout));
  }

  // options.fresh bypasses the browser cache (used by the dashboard preview).
  function mount(host, widgetId, options) {
    widgetId = widgetId || host.getAttribute('data-review-widget');
    if (!widgetId) return Promise.resolve();
    host.setAttribute('data-review-widget-mounted', '');
    var root = host.shadowRoot || host.attachShadow({ mode: 'open' });

    var fetchOptions = options && options.fresh ? { cache: 'no-store' } : undefined;
    return fetch(BASE_URL + '/api/public/widgets/' + encodeURIComponent(widgetId), fetchOptions)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        render(root, host, data);
      })
      .catch(function (err) {
        // Fail quietly on the host site; leave a hint for developers.
        root.textContent = '';
        console.warn('[review-widget] Could not load widget ' + widgetId + ':', err.message);
      });
  }

  function init() {
    var nodes = document.querySelectorAll('[data-review-widget]:not([data-review-widget-mounted])');
    Array.prototype.forEach.call(nodes, function (node) {
      mount(node);
    });
  }

  window.ReviewWidget = { mount: mount, init: init, baseUrl: BASE_URL };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
