import { config } from '../config.js';
import { expectStatus, request } from './http.js';

// Photo URLs served by the stub's fake photo host: one loads, one returns 404.
const PHOTOS = {
  available: `${config.googleStubUrl}/photos/reviewer.png`,
  broken: `${config.googleStubUrl}/photos/missing.png`,
  none: '',
};

/** Arranges and inspects data in the Google Places stub through its back channel. */
export class GoogleStubDriver {
  async setPlace(placeId, { name, rating, userRatingCount, reviews }) {
    const place = {
      displayName: { text: name, languageCode: 'en' },
      formattedAddress: '1 Acceptance Test Way',
      rating,
      userRatingCount,
      googleMapsUri: `https://maps.google.com/?q=${encodeURIComponent(placeId)}`,
      reviews: reviews.map((r) => ({
        rating: r.stars,
        text: { text: r.text, languageCode: 'en' },
        relativePublishTimeDescription: 'a week ago',
        authorAttribution: { displayName: r.author, uri: '', photoUri: PHOTOS[r.photo] },
      })),
    };
    await expectStatus(
      request(`/__stub/places/${encodeURIComponent(placeId)}`, {
        baseUrl: config.googleStubUrl,
        method: 'PUT',
        body: place,
      }),
      204,
      'Arranging place in Google stub',
    );
  }

  async requestCount(placeId) {
    const res = await expectStatus(
      request(`/__stub/places/${encodeURIComponent(placeId)}/requests`, { baseUrl: config.googleStubUrl }),
      200,
      'Reading Google stub request count',
    );
    return res.json.count;
  }
}
