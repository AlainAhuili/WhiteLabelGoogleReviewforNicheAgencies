import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { simulateClientSite } from './support/client-site.js';

// A client site with the script tag in its <head>: the script runs before the
// rest of the page exists. Here its own URL is also unknown to the browser.
const site = simulateClientSite({ scriptUrl: null, pageStillLoading: true });

describe('Embed widget: script tag in the page <head>', () => {
  before(() => site.loadScript());

  it('waits until the page has loaded, then mounts its widgets', () => {
    site.addWidget('later');
    assert.equal(site.requests.length, 0, 'nothing is mounted while the page is loading');

    site.finishLoading();

    assert.deepEqual(site.requests.map((r) => r.url), ['https://client.example/api/public/widgets/later']);
  });

  it("falls back to the page's own origin when the script's URL is unknown", () => {
    assert.equal(site.window.ReviewWidget.baseUrl, 'https://client.example');
  });
});
