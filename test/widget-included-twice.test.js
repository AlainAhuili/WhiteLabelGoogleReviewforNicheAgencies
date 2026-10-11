import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { simulateClientSite } from './support/client-site.js';

// A client site that includes the embed snippet twice, e.g. once per widget.
const site = simulateClientSite();

describe('Embed widget: script included twice on a page', () => {
  it('keeps the copy already running and asks it to mount any new widgets', async () => {
    const running = { init: mock.fn() };
    site.window.ReviewWidget = running;

    await site.loadScript();

    assert.equal(site.window.ReviewWidget, running);
    assert.equal(running.init.mock.callCount(), 1);
    assert.equal(site.requests.length, 0, 'the second copy fetches nothing itself');
  });
});
