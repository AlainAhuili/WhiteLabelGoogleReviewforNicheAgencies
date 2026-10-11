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
    dataFile: env.DATA_FILE || 'data/db.json',
    // At $25 per 1,000 Places requests, 200 caps Google's cost at about $5 per widget per month. 0 = no limit.
    googleRequestsPerWidgetPerMonth: wholeNumber(env.GOOGLE_REQUESTS_PER_WIDGET_PER_MONTH, 200),
  };
}

function wholeNumber(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Expected a whole number, got "${value}"`);
  return n;
}
