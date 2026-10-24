import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { DemoPlacesClient } from './demo.js';
import { GooglePlacesClient } from './google.js';
import { ReviewService } from './reviews.js';
import { openStore } from './store.js';

const config = loadConfig();
const demoMode = !config.googleApiKey;
const store = await openStore(config);
const client = demoMode ? new DemoPlacesClient() : new GooglePlacesClient(config.googleApiKey, { baseUrl: config.googlePlacesBaseUrl });
const reviews = new ReviewService(client, { ttlSeconds: config.cacheTtlSeconds });

// Single-agency installs get a first agency automatically. With an operator key,
// agencies are provisioned through POST /api/operator/agencies instead.
if ((await store.agencyCount()) === 0 && !config.operatorApiKey) {
  const { apiKey } = await store.createAgency('My Agency');
  console.log('\nCreated your first agency. Admin API key (save it, it is shown only once):');
  console.log(`  ${apiKey}\n`);
}

const app = createApp({ store, reviews, config: { ...config, demoMode } });

app.listen(config.port, () => {
  console.log(`Reputation widget ${config.version} running at ${config.publicUrl}`);
  console.log(`  Admin dashboard: ${config.publicUrl}/admin/`);
  console.log(`  Storage: ${config.store === 'firestore' ? 'Firestore' : config.dataFile}`);
  if (demoMode) console.log('  Demo mode: GOOGLE_PLACES_API_KEY is not set, serving sample reviews.');
});
