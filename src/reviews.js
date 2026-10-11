/**
 * Fetches place reviews through a places client with a short in-memory cache.
 * Concurrent requests for the same place share one upstream call, and if Google
 * fails after the cache expires, the last good result is served instead.
 */
export class ReviewService {
  constructor(client, { ttlSeconds = 3600, now = Date.now } = {}) {
    this.client = client;
    this.ttlMs = ttlSeconds * 1000;
    this.now = now;
    this.cache = new Map(); // placeId -> { place, expiresAt }
    this.inFlight = new Map(); // placeId -> Promise
  }

  /**
   * @param {string} placeId
   * @param {{ mayAskGoogle?: boolean, onAskGoogle?: () => void }} [options]
   *   mayAskGoogle: false serves the cached place even if stale, and never calls Google.
   *   onAskGoogle: called when this call (not a concurrent one it joins) asks Google.
   */
  async getPlace(placeId, { mayAskGoogle = true, onAskGoogle } = {}) {
    const cached = this.cache.get(placeId);
    if (cached && cached.expiresAt > this.now()) return cached.place;

    if (!this.inFlight.has(placeId)) {
      if (!mayAskGoogle) {
        if (cached) return cached.place;
        throw new Error(`No cached reviews for ${placeId}, and this widget may not ask Google again this month`);
      }
      onAskGoogle?.();
      const request = this.client
        .getPlace(placeId)
        .then((place) => {
          this.cache.set(placeId, { place, expiresAt: this.now() + this.ttlMs });
          return place;
        })
        .finally(() => this.inFlight.delete(placeId));
      this.inFlight.set(placeId, request);
    }

    try {
      return await this.inFlight.get(placeId);
    } catch (err) {
      if (cached) return cached.place;
      throw err;
    }
  }

  invalidate(placeId) {
    this.cache.delete(placeId);
  }

  searchPlaces(query) {
    return this.client.searchPlaces(query);
  }
}

/** Applies a widget's display rules to a place's reviews. */
export function selectReviews(reviews, { minRating = 1, maxReviews = 5 } = {}) {
  return reviews
    .filter((r) => r.rating >= minRating && r.text.trim() !== '')
    .slice(0, maxReviews);
}
