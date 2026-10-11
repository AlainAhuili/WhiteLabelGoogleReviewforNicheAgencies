import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Store } from '../src/store.js';

describe('Store (JSON file)', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rw-store-'));
    file = join(dir, 'nested', 'db.json');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('starts empty, without creating a file, when there is no data yet', () => {
    const store = new Store(file);

    assert.equal(store.agencyCount(), 0);
    assert.equal(existsSync(file), false);
  });

  // Each change is checked after a restart on its own, so a later save can't
  // hide a change that was never written.
  const restart = () => new Store(file);

  it('keeps a new agency across a restart, and it can still sign in', () => {
    const { agency, apiKey } = new Store(file).createAgency('Acme Local');

    const store = restart();
    assert.equal(store.agencyCount(), 1);
    assert.equal(store.findAgencyByApiKey(apiKey).id, agency.id);
  });

  it('keeps branding changes across a restart', () => {
    const { agency } = new Store(file).createAgency('Acme Local');
    restart().updateBranding(agency.id, { poweredByText: 'Reviews by Acme' });

    assert.equal(restart().getAgency(agency.id).branding.poweredByText, 'Reviews by Acme');
  });

  it('keeps new, changed and deleted widgets across a restart', () => {
    const { agency } = new Store(file).createAgency('Acme Local');
    const widget = restart().createWidget(agency.id, { name: 'Homepage', layout: 'grid' });
    assert.deepEqual(restart().listWidgets(agency.id).map((w) => w.layout), ['grid']);

    restart().updateWidget(widget.id, { layout: 'carousel' });
    assert.deepEqual(restart().listWidgets(agency.id).map((w) => w.layout), ['carousel']);

    restart().deleteWidget(widget.id);
    assert.deepEqual(restart().listWidgets(agency.id), []);
  });

  it("keeps each widget's monthly Google request count across a restart, starting again each month", () => {
    const { agency } = new Store(file).createAgency('Acme Local');
    const widget = restart().createWidget(agency.id, { name: 'Homepage' });
    restart().recordGoogleRequest(widget.id, '2026-10');
    restart().recordGoogleRequest(widget.id, '2026-10');

    assert.equal(restart().googleRequests(widget.id, '2026-10'), 2);
    assert.equal(restart().googleRequests(widget.id, '2026-11'), 0);

    restart().recordGoogleRequest(widget.id, '2026-11');
    assert.equal(restart().googleRequests(widget.id, '2026-11'), 1);
  });

  it('never writes the plaintext API key to disk', () => {
    const { apiKey } = new Store(file).createAgency('Acme Local');

    const saved = readFileSync(file, 'utf8');
    assert.ok(!saved.includes(apiKey));
    assert.match(saved, /"apiKeyHash": "[0-9a-f]{64}"/);
  });

  it('leaves no temporary file behind after saving', () => {
    new Store(file).createAgency('Acme Local');

    assert.deepEqual(readdirSync(join(dir, 'nested')), ['db.json']);
  });

  it('refuses to start with a corrupt data file rather than overwrite it', () => {
    new Store(file).createAgency('Acme Local');
    writeFileSync(file, '{ not json');

    assert.throws(() => new Store(file), SyntaxError);
    assert.equal(readFileSync(file, 'utf8'), '{ not json');
  });
});
