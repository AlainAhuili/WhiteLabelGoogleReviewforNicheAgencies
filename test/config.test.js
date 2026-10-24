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

  it('stores data in the JSON file unless Firestore is chosen', () => {
    assert.equal(loadConfig({}).store, 'file');
    assert.equal(loadConfig({ STORE: '' }).store, 'file');
    const config = loadConfig({ STORE: 'firestore', FIRESTORE_PROJECT_ID: 'my-project', FIRESTORE_DATABASE: 'reviews' });
    assert.equal(config.store, 'firestore');
    assert.equal(config.firestoreProjectId, 'my-project');
    assert.equal(config.firestoreDatabase, 'reviews');
  });

  it('refuses to start with an unknown store', () => {
    assert.throws(() => loadConfig({ STORE: 'postgres' }), /STORE must be one of file, firestore/);
  });

  it('refuses to start with a limit that is not a whole number', () => {
    for (const bad of ['-1', '2.5', 'lots']) {
      assert.throws(() => loadConfig({ GOOGLE_REQUESTS_PER_WIDGET_PER_MONTH: bad }), /whole number/);
    }
  });
});
