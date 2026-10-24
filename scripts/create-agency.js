import { loadConfig } from '../src/config.js';
import { openStore } from '../src/store.js';

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('Usage: npm run create-agency -- "Agency Name"');
  process.exit(1);
}

const config = loadConfig();
const store = await openStore(config);
const { agency, apiKey } = await store.createAgency(name);
await store.close();
console.log(`Created agency "${agency.name}" (${agency.id})`);
console.log(`Admin API key (shown only once): ${apiKey}`);
if (config.store === 'file') console.log('Restart the server if it is running so it picks up the new agency.');
