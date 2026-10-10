import { chromium } from 'playwright';
import { config } from '../config.js';

// A different origin from the system under test, like a real client website.
const CLIENT_SITE = 'http://client-site.test/';

/**
 * Loads the widget into a third-party page in a real browser using the published
 * embed snippet, then reads what a visitor would actually see.
 */
export class BrowserVisitorDriver {
  channel = 'browser';
  #browser = null;

  async #page() {
    this.#browser ??= await chromium.launch({
      executablePath: config.chromiumPath,
      // In test environments the system under test runs on localhost, and Chrome blocks
      // public origins (the fake client site) from loading local resources. Real client
      // sites load the widget from a public host, so this check does not apply there.
      args: ['--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks'],
    });
    const page = await this.#browser.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    return { page, errors };
  }

  async viewWidget(widgetId) {
    const { page, errors } = await this.#page();
    const html = `<!doctype html><html><head><style>body{font-family:serif;color:red}</style></head><body>
      <h1>Client site</h1>
      <div data-review-widget="${widgetId}"></div>
      <script src="${config.baseUrl}/widget.js" async></script>
    </body></html>`;
    await page.route(CLIENT_SITE, (route) => route.fulfill({ contentType: 'text/html', body: html }));

    try {
      await page.goto(CLIENT_SITE);
      await page.waitForFunction(
        () => document.querySelector('[data-review-widget]')?.shadowRoot?.querySelector('.rw'),
        null,
        { timeout: 10_000 },
      );
      // Wait until every avatar image has either loaded or failed.
      await page.waitForFunction(
        () => [...document.querySelector('[data-review-widget]').shadowRoot.querySelectorAll('img.avatar')]
          .every((img) => img.complete),
        null,
        { timeout: 10_000 },
      );
      if (errors.length) throw new Error(`Script errors on client site: ${errors.join('; ')}`);

      return await page.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0)); // let pending load/error handlers run
        const root = document.querySelector('[data-review-widget]').shadowRoot;
        const text = (el) => el?.textContent.trim() ?? null;
        const stars = (el) => Number(/Rated ([\d.]+)/.exec(el.getAttribute('aria-label'))[1]);
        // What a visitor sees in the avatar circle: a loaded photo, a letter, or nothing.
        const avatar = (el) => {
          const isImg = el?.tagName === 'IMG';
          return {
            photo: isImg && el.complete && el.naturalWidth > 0,
            initial: el && !isImg ? text(el) || null : null,
          };
        };
        return {
          businessName: text(root.querySelector('.name')),
          rating: Number(text(root.querySelector('.head .score'))),
          totalReviews: Number(/\d+/.exec(text(root.querySelector('.head .count')))[0]),
          reviews: [...root.querySelectorAll('.card')].map((card) => ({
            author: text(card.querySelector('.author-name')),
            stars: stars(card.querySelector('.stars')),
            text: text(card.querySelector('.text')),
            avatar: avatar(card.querySelector('.avatar')),
          })),
          footerBranding: text(root.querySelector('.foot .powered')),
          googleAttribution: /Reviews from Google/.test(text(root.querySelector('.foot'))),
        };
      });
    } finally {
      await page.close();
    }
  }

  async close() {
    await this.#browser?.close();
  }
}
