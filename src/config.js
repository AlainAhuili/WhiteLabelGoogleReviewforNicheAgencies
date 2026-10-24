export function loadConfig(env = process.env) {
  const port = Number(env.PORT) || 3000;
  return {
    port,
    publicUrl: (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    googleApiKey: env.GOOGLE_PLACES_API_KEY || '',
    googlePlacesBaseUrl: env.GOOGLE_PLACES_BASE_URL || 'https://places.googleapis.com/v1',
    operatorApiKey: env.OPERATOR_API_KEY || '',
    version: env.APP_VERSION || 'dev',
    cacheTtlSeconds: Number(env.CACHE_TTL_SECONDS) || 3600,
    store: storeKind(env.STORE),
    dataFile: env.DATA_FILE || 'data/db.json',
    // Empty means Application Default Credentials pick the project (on Cloud Run, the service's project).
    firestoreProjectId: env.FIRESTORE_PROJECT_ID || '',
    firestoreDatabase: env.FIRESTORE_DATABASE || '',
    // At $25 per 1,000 Places requests, 200 caps Google's cost at about $5 per widget per month. 0 = no limit.
    googleRequestsPerWidgetPerMonth: wholeNumber(env.GOOGLE_REQUESTS_PER_WIDGET_PER_MONTH, 200),
  };
}

const STORES = ['file', 'firestore'];

function storeKind(value) {
  if (value === undefined || value === '') return 'file';
  if (!STORES.includes(value)) throw new Error(`STORE must be one of ${STORES.join(', ')}, got "${value}"`);
  return value;
}

function wholeNumber(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Expected a whole number, got "${value}"`);
  return n;
}
