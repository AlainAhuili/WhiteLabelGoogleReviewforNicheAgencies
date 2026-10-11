import { afterEach, beforeEach, describe, it } from 'node:test';
import { createDsl } from '../dsl/index.js';

describe('Capping what each widget can cost in Google requests', () => {
  let dsl;
  beforeEach(() => (dsl = createDsl()));
  afterEach(() => dsl.close());

  it('stops asking Google once a widget has used its monthly allowance, but keeps showing its reviews', async () => {
    const { google, agency, visitor } = dsl;
    await google.businessHasReviews('Lakeside Vets', { reviews: [{ stars: 4, author: 'Ana' }] });
    await agency.signsUp();
    await agency.publishesWidget('Homepage widget', { business: 'Lakeside Vets' });

    // A busy widget whose agency keeps refreshing it spends the month's allowance.
    for (let i = 0; i < dsl.monthlyGoogleRequestsPerWidget; i++) {
      if (i > 0) await agency.refreshesReviews('Homepage widget');
      await visitor.viewsWidget('Homepage widget');
    }

    await google.businessReceivesNewReview('Lakeside Vets', { stars: 5, author: 'Ben' });
    await agency.assertCannotRefreshReviews('Homepage widget');
    await visitor.viewsWidget('Homepage widget');

    visitor.assertSeesReviewsWithStars([4]);
    await google.assertWasAskedAboutBusinessTimes('Lakeside Vets', dsl.monthlyGoogleRequestsPerWidget);
  });

  it("shows the agency each widget's Google requests this month on the dashboard", async () => {
    const { google, agency, visitor } = dsl;
    await google.businessHasReviews('Lakeside Vets', { reviews: [{ stars: 4 }] });
    await agency.signsUp();
    await agency.publishesWidget('Homepage widget', { business: 'Lakeside Vets' });
    await visitor.viewsWidget('Homepage widget');
    await visitor.viewsWidget('Homepage widget');

    await agency.assertDashboardShowsGoogleRequests('Homepage widget', {
      used: 1,
      allowance: dsl.monthlyGoogleRequestsPerWidget,
    });
    await agency.assertCanRefreshReviewsOnDashboard('Homepage widget');
  });

  it('warns the agency on the dashboard when a widget has used its allowance, and offers no refresh', async () => {
    const { google, agency, visitor } = dsl;
    await google.businessHasReviews('Lakeside Vets', { reviews: [{ stars: 4 }] });
    await agency.signsUp();
    await agency.publishesWidget('Homepage widget', { business: 'Lakeside Vets' });
    for (let i = 0; i < dsl.monthlyGoogleRequestsPerWidget; i++) {
      if (i > 0) await agency.refreshesReviews('Homepage widget');
      await visitor.viewsWidget('Homepage widget');
    }

    await agency.assertDashboardWarnsAllowanceUsedUp('Homepage widget');
    await agency.assertCannotRefreshReviewsOnDashboard('Homepage widget');
  });

  it("does not limit the agency's other widgets", async () => {
    const { google, agency, visitor } = dsl;
    await google.businessHasReviews('Lakeside Vets', { reviews: [{ stars: 4 }] });
    await google.businessHasReviews('Harbor Plumbing', { reviews: [{ stars: 5, author: 'Ana' }] });
    await agency.signsUp();
    await agency.publishesWidget('Vets widget', { business: 'Lakeside Vets' });
    await agency.publishesWidget('Plumbing widget', { business: 'Harbor Plumbing' });
    for (let i = 0; i < dsl.monthlyGoogleRequestsPerWidget; i++) {
      if (i > 0) await agency.refreshesReviews('Vets widget');
      await visitor.viewsWidget('Vets widget');
    }

    await visitor.viewsWidget('Plumbing widget');
    await google.businessReceivesNewReview('Harbor Plumbing', { stars: 5, author: 'Ben' });
    await agency.refreshesReviews('Plumbing widget');
    await visitor.viewsWidget('Plumbing widget');

    visitor.assertSeesReviewBy('Ben');
  });
});
