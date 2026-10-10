import { expectStatus, request } from './http.js';

/**
 * Reads a widget the way the embed script does, through the public JSON API.
 * Fast, but cannot observe what is actually rendered on the page.
 */
export class ApiVisitorDriver {
  channel = 'api';

  async viewWidget(widgetId) {
    const res = await expectStatus(request(`/api/public/widgets/${widgetId}`), 200, 'Loading widget');
    const { place, reviews, branding } = res.json;
    return {
      businessName: place.name,
      rating: place.rating,
      totalReviews: place.userRatingCount,
      reviews: reviews.map((r) => ({ author: r.author, stars: r.rating, text: r.text, avatar: null })), // avatars are not observable through the API
      footerBranding: branding.poweredByText || null,
      googleAttribution: null, // not observable through the API
    };
  }

  async close() {}
}
