import { afterEach, beforeEach, describe, it } from 'node:test';
import { createDsl } from '../dsl/index.js';

// Avatars are a rendering concern, so these run through a real browser.
describe('Showing who wrote each review', () => {
  let dsl;
  beforeEach(() => (dsl = createDsl({ channel: 'browser' })));
  afterEach(() => dsl.close());

  it("shows the reviewer's photo when Google provides one", async () => {
    const { google, agency, visitor } = dsl;
    await google.businessHasReviews('Sunrise Dental', { reviews: [{ stars: 5, author: 'Maria', photo: 'available' }] });
    await agency.signsUp();
    await agency.publishesWidget('Homepage widget', { business: 'Sunrise Dental' });

    await visitor.viewsWidget('Homepage widget');

    visitor.assertSeesPhotoOf('Maria');
  });

  it("shows the reviewer's initial when they have no photo", async () => {
    const { google, agency, visitor } = dsl;
    await google.businessHasReviews('Sunrise Dental', { reviews: [{ stars: 5, author: 'James', photo: 'none' }] });
    await agency.signsUp();
    await agency.publishesWidget('Homepage widget', { business: 'Sunrise Dental' });

    await visitor.viewsWidget('Homepage widget');

    visitor.assertSeesInitialOf('James', 'J');
  });

  it("shows the reviewer's initial when their photo cannot be loaded", async () => {
    const { google, agency, visitor } = dsl;
    await google.businessHasReviews('Sunrise Dental', { reviews: [{ stars: 4, author: 'Lena', photo: 'broken' }] });
    await agency.signsUp();
    await agency.publishesWidget('Homepage widget', { business: 'Sunrise Dental' });

    await visitor.viewsWidget('Homepage widget');

    visitor.assertSeesInitialOf('Lena', 'L');
  });
});
