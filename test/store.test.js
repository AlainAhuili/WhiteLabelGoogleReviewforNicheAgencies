import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { FirestoreStore } from '../src/firestore-store.js';
import { openStore, Store } from '../src/store.js';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const FIRESTORE_PROJECT = 'reputation-widget-test';

// Each backend can open a store, "restart" (open a fresh store over the same
// data) and show everything it has saved, as raw text.
const backends = [
  {
    name: 'JSON file',
    async setUp() {
      this.dir = mkdtempSync(join(tmpdir(), 'rw-store-'));
      this.file = join(this.dir, 'nested', 'db.json');
    },
    open() {
      return new Store(this.file);
    },
    async saved() {
      return readFileSync(this.file, 'utf8');
    },
    async tearDown() {
      rmSync(this.dir, { recursive: true, force: true });
    },
  },
  {
    name: 'Firestore',
    skip: !EMULATOR && 'needs the Firestore emulator: npm run test:firestore',
    async setUp() {
      this.opened = [];
      const res = await fetch(`http://${EMULATOR}/emulator/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
      assert.ok(res.ok, `could not clear the emulator: ${res.status}`);
    },
    open() {
      const store = new FirestoreStore({ projectId: FIRESTORE_PROJECT });
      this.opened.push(store);
      return store;
    },
    async saved() {
      const [store] = this.opened;
      const docs = [...(await store.agencies.get()).docs, ...(await store.widgets.get()).docs];
      return JSON.stringify(docs.map((d) => d.data()), null, 2);
    },
    async tearDown() {
      await Promise.all(this.opened.map((s) => s.close()));
    },
  },
];

for (const backend of backends) {
  describe(`Store (${backend.name})`, { skip: backend.skip }, () => {
    beforeEach(() => backend.setUp());
    afterEach(() => backend.tearDown());

    // Each change is checked after a restart on its own, so a later save can't
    // hide a change that was never written.
    const restart = () => backend.open();

    it('starts empty', async () => {
      assert.equal(await restart().agencyCount(), 0);
    });

    it('keeps a new agency across a restart, and it can still sign in', async () => {
      const { agency, apiKey } = await restart().createAgency('Acme Local');

      const store = restart();
      assert.equal(await store.agencyCount(), 1);
      assert.equal((await store.findAgencyByApiKey(apiKey)).id, agency.id);
      assert.equal((await store.getAgency(agency.id)).name, 'Acme Local');
    });

    it('finds no agency for an unknown key or id', async () => {
      await restart().createAgency('Acme Local');

      assert.equal(await restart().findAgencyByApiKey('rk_not-a-real-key'), null);
      assert.equal(await restart().getAgency('ag_missing'), null);
    });

    it('keeps branding changes across a restart, leaving other branding as it was', async () => {
      const { agency } = await restart().createAgency('Acme Local');
      const updated = await restart().updateBranding(agency.id, { poweredByText: 'Reviews by Acme' });
      assert.equal(updated.branding.poweredByText, 'Reviews by Acme');

      const { branding } = await restart().getAgency(agency.id);
      assert.equal(branding.poweredByText, 'Reviews by Acme');
      assert.equal(branding.brandName, 'Acme Local');
    });

    it('keeps new, changed and deleted widgets across a restart', async () => {
      const { agency } = await restart().createAgency('Acme Local');
      const widget = await restart().createWidget(agency.id, { name: 'Homepage', layout: 'grid' });
      assert.deepEqual((await restart().listWidgets(agency.id)).map((w) => w.layout), ['grid']);

      const updated = await restart().updateWidget(widget.id, { layout: 'carousel' });
      assert.equal(updated.layout, 'carousel');
      assert.equal(updated.name, 'Homepage');
      assert.deepEqual((await restart().listWidgets(agency.id)).map((w) => w.layout), ['carousel']);

      await restart().deleteWidget(widget.id);
      assert.deepEqual(await restart().listWidgets(agency.id), []);
      assert.equal(await restart().getWidget(widget.id), null);
    });

    it("lists only an agency's own widgets, oldest first", async () => {
      const store = restart();
      const { agency } = await store.createAgency('Acme Local');
      const { agency: rival } = await store.createAgency('Rival Agency');
      for (const name of ['First', 'Second', 'Third']) await store.createWidget(agency.id, { name });
      await store.createWidget(rival.id, { name: 'Theirs' });

      assert.deepEqual((await restart().listWidgets(agency.id)).map((w) => w.name), ['First', 'Second', 'Third']);
    });

    it("keeps each widget's monthly Google request count across a restart, starting again each month", async () => {
      const { agency } = await restart().createAgency('Acme Local');
      const widget = await restart().createWidget(agency.id, { name: 'Homepage' });
      await restart().recordGoogleRequest(widget.id, '2026-10');
      await restart().recordGoogleRequest(widget.id, '2026-10');

      assert.equal(await restart().googleRequests(widget.id, '2026-10'), 2);
      assert.equal(await restart().googleRequests(widget.id, '2026-11'), 0);

      await restart().recordGoogleRequest(widget.id, '2026-11');
      assert.equal(await restart().googleRequests(widget.id, '2026-11'), 1);
    });

    it('counts every one of several Google requests made at the same time', async () => {
      const store = restart();
      const { agency } = await store.createAgency('Acme Local');
      const widget = await store.createWidget(agency.id, { name: 'Homepage' });

      await Promise.all(Array.from({ length: 5 }, () => restart().recordGoogleRequest(widget.id, '2026-10')));

      assert.equal(await restart().googleRequests(widget.id, '2026-10'), 5);
    });

    it('never saves the plaintext API key', async () => {
      const { apiKey } = await restart().createAgency('Acme Local');

      const saved = await backend.saved();
      assert.ok(!saved.includes(apiKey));
      assert.match(saved, /"apiKeyHash": "[0-9a-f]{64}"/);
    });
  });
}

describe('Store (JSON file only)', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rw-store-'));
    file = join(dir, 'nested', 'db.json');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('does not create a file until there is data', async () => {
    assert.equal(await new Store(file).agencyCount(), 0);
    assert.equal(existsSync(file), false);
  });

  it('leaves no temporary file behind after saving', async () => {
    await new Store(file).createAgency('Acme Local');

    assert.deepEqual(readdirSync(join(dir, 'nested')), ['db.json']);
  });

  it('refuses to start with a corrupt data file rather than overwrite it', async () => {
    await new Store(file).createAgency('Acme Local');
    writeFileSync(file, '{ not json');

    assert.throws(() => new Store(file), SyntaxError);
    assert.equal(readFileSync(file, 'utf8'), '{ not json');
  });
});

describe('openStore', () => {
  it('opens the JSON file store by default', async () => {
    const store = await openStore({ store: 'file', dataFile: null });
    assert.ok(store instanceof Store);
    await store.close();
  });

  it('opens a Firestore store for the configured project and database', async () => {
    const store = await openStore({ store: 'firestore', firestoreProjectId: 'my-project', firestoreDatabase: 'reviews' });
    assert.ok(store instanceof FirestoreStore);
    assert.equal(store.db.databaseId, 'reviews');
    assert.equal(store.db.projectId, 'my-project');
    await store.close();
  });
});
