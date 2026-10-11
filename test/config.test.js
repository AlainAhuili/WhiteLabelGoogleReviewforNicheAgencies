import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('caps each widget at 200 Google requests a month by default', () => {
    assert.equal(loadConfig({}).googleRequestsPerWidgetPerMonth, 200);
    assert.equal(loadConfig({ GOOGLE_REQUESTS_PER_WIDGET_PER_MONTH: '' }).googleRequestsPerWidgetPerMonth, 200);
  });

  it('accepts a custom monthly limit, or 0 for no limit', () => {
    assert.equal(loadConfig({ GOOGLE_REQUESTS_PER_WIDGET_PER_MONTH: '50' }).googleRequestsPerWidgetPerMonth, 50);
    assert.equal(loadConfig({ GOOGLE_REQUESTS_PER_WIDGET_PER_MONTH: '0' }).googleRequestsPerWidgetPerMonth, 0);
  });

  it('refuses to start with a limit that is not a whole number', () => {
    for (const bad of ['-1', '2.5', 'lots']) {
      assert.throws(() => loadConfig({ GOOGLE_REQUESTS_PER_WIDGET_PER_MONTH: bad }), /whole number/);
    }
  });
});
