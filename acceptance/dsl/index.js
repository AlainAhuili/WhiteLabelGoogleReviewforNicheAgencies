/**
 * Domain-specific language for acceptance tests.
 *
 * Test cases speak in the language of the business ("an agency publishes a widget",
 * "a visitor sees reviews"). The DSL turns that into calls on protocol drivers,
 * which know how to talk to the system. Swapping the visitor driver (API or real
 * browser) runs the same specification through a different channel.
 *
 * Functional isolation: every name a test uses ("Sunrise Dental", "Acme Agency")
 * is an alias. The DSL maps it to a unique real value per test, so tests never
 * share data and can run in parallel against one deployed system.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { AgencyApiDriver } from '../drivers/agency-api-driver.js';
import { AgencyDashboardDriver } from '../drivers/agency-dashboard-driver.js';
import { ApiVisitorDriver } from '../drivers/api-visitor-driver.js';
import { BrowserVisitorDriver } from '../drivers/browser-visitor-driver.js';
import { GoogleStubDriver } from '../drivers/google-stub-driver.js';
import { config } from '../config.js';

const DEFAULT_AGENCY = 'Default Agency';

class Aliases {
  #suffix = randomBytes(4).toString('hex');
  #values = new Map();

  name(alias) {
    if (!this.#values.has(alias)) this.#values.set(alias, `${alias} ${this.#suffix}`);
    return this.#values.get(alias);
  }

  placeId(alias) {
    return `stub-${this.name(alias).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }
}

class GoogleDsl {
  #places = new Map(); // business alias -> arranged place

  constructor(aliases, driver) {
    this.aliases = aliases;
    this.driver = driver;
  }

  /**
   * @param {string} business
   * @param {{ rating?: number, totalReviews?: number, reviews: Array<{ stars: number, author?: string, text?: string, photo?: 'available' | 'broken' | 'none' }> }} details
   */
  async businessHasReviews(business, { rating = 4.6, totalReviews = 100, reviews }) {
    const place = {
      name: this.aliases.name(business),
      rating,
      userRatingCount: totalReviews,
      reviews: reviews.map((r, i) => ({
        author: r.author ?? `Reviewer ${i + 1}`,
        stars: r.stars,
        text: r.text ?? `A ${r.stars}-star experience.`,
        photo: r.photo ?? 'none',
      })),
    };
    this.#places.set(business, place);
    await this.driver.setPlace(this.aliases.placeId(business), place);
  }

  async businessReceivesNewReview(business, review) {
    const place = this.#places.get(business);
    const updated = {
      ...place,
      totalReviews: place.userRatingCount + 1,
      reviews: [{ author: 'New Reviewer', text: 'Just left this review.', ...review }, ...place.reviews],
    };
    await this.businessHasReviews(business, updated);
  }

  async assertWasAskedAboutBusinessTimes(business, expected) {
    const actual = await this.driver.requestCount(this.aliases.placeId(business));
    assert.equal(actual, expected, `Expected Google to be asked about "${business}" ${expected} time(s), was ${actual}`);
  }
}

class AgencyDsl {
  #agencies = new Map(); // agency alias -> { apiKey }
  #widgets = new Map(); // widget alias -> widget

  constructor(aliases, driver, dashboard) {
    this.aliases = aliases;
    this.driver = driver;
    this.dashboard = dashboard;
  }

  async #dashboardEntry(widget, as) {
    const entries = await this.dashboard.listWidgets(this.#agency(as).apiKey);
    const entry = entries.find((e) => e.name === this.aliases.name(widget));
    assert.ok(entry, `Expected "${widget}" on the dashboard`);
    return entry;
  }

  #agency(alias) {
    const agency = this.#agencies.get(alias);
    if (!agency) throw new Error(`Agency "${alias}" has not signed up in this test`);
    return agency;
  }

  widget(alias) {
    const widget = this.#widgets.get(alias);
    if (!widget) throw new Error(`Widget "${alias}" has not been published in this test`);
    return widget;
  }

  async signsUp(agency = DEFAULT_AGENCY) {
    this.#agencies.set(agency, await this.driver.provisionAgency(this.aliases.name(agency)));
  }

  /** @param {{ footerText?: string, footerLink?: string, hideFooter?: boolean, as?: string }} branding */
  async setsBranding({ footerText, footerLink, hideFooter, as = DEFAULT_AGENCY }) {
    const changes = {};
    if (footerText !== undefined) changes.poweredByText = footerText;
    if (footerLink !== undefined) changes.poweredByUrl = footerLink;
    if (hideFooter !== undefined) changes.hidePoweredBy = hideFooter;
    await this.driver.updateBranding(this.#agency(as).apiKey, changes);
  }

  /** @param {{ business: string, layout?: string, minStars?: number, maxReviews?: number, as?: string }} options */
  async publishesWidget(widget, { business, layout = 'grid', minStars = 1, maxReviews = 5, as = DEFAULT_AGENCY }) {
    const created = await this.driver.createWidget(this.#agency(as).apiKey, {
      name: this.aliases.name(widget),
      placeId: this.aliases.placeId(business),
      layout,
      minRating: minStars,
      maxReviews,
    });
    this.#widgets.set(widget, created);
  }

  async refreshesReviews(widget, { as = DEFAULT_AGENCY } = {}) {
    await this.driver.refreshWidget(this.#agency(as).apiKey, this.widget(widget).id);
  }

  async assertDashboardShowsGoogleRequests(widget, { used, allowance, as = DEFAULT_AGENCY }) {
    const entry = await this.#dashboardEntry(widget, as);
    assert.deepEqual(entry.googleRequests, { used, allowance });
    assert.equal(entry.allowanceUsedUp, false, `"${widget}" should not be shown as having used its allowance`);
  }

  async assertDashboardWarnsAllowanceUsedUp(widget, { as = DEFAULT_AGENCY } = {}) {
    const entry = await this.#dashboardEntry(widget, as);
    assert.equal(entry.allowanceUsedUp, true, `Expected the dashboard to warn that "${widget}" has used its allowance`);
  }

  async assertCanRefreshReviewsOnDashboard(widget, { as = DEFAULT_AGENCY } = {}) {
    const editor = await this.dashboard.openWidget(this.#agency(as).apiKey, this.aliases.name(widget));
    assert.equal(editor.canRefreshReviews, true, `Expected "Refresh reviews" to be available for "${widget}"`);
  }

  async assertCannotRefreshReviewsOnDashboard(widget, { as = DEFAULT_AGENCY } = {}) {
    const editor = await this.dashboard.openWidget(this.#agency(as).apiKey, this.aliases.name(widget));
    assert.equal(editor.canRefreshReviews, false, `Expected "Refresh reviews" to be unavailable for "${widget}"`);
    assert.match(editor.refreshHint, /used its Google requests/, 'The dashboard should say why');
  }

  async assertCannotRefreshReviews(widget, { as = DEFAULT_AGENCY } = {}) {
    const status = await this.driver.tryRefreshWidget(this.#agency(as).apiKey, this.widget(widget).id);
    assert.equal(status, 429, `Refreshing "${widget}" should be refused once its Google allowance is used`);
  }

  async assertCannotChangeWidget(widget, { as }) {
    const status = await this.driver.tryUpdateWidget(this.#agency(as).apiKey, this.widget(widget).id, { layout: 'list' });
    assert.equal(status, 404, `Agency "${as}" should not be able to change widget "${widget}"`);
  }
}

class VisitorDsl {
  #view = null;
  #landedOn = null;

  constructor(aliases, agency, visitorDriver, agencyDriver) {
    this.aliases = aliases;
    this.agency = agency;
    this.driver = visitorDriver;
    this.agencyDriver = agencyDriver;
  }

  get channel() {
    return this.driver.channel;
  }

  #lastView() {
    if (!this.#view) throw new Error('The visitor has not viewed a widget yet');
    return this.#view;
  }

  async viewsWidget(widget) {
    this.#view = await this.driver.viewWidget(this.agency.widget(widget).id);
  }

  async followsReviewLink(widget) {
    this.#landedOn = await this.agencyDriver.followReviewLink(this.agency.widget(widget).reviewLink);
  }

  assertSeesBusiness(business, { rating, totalReviews } = {}) {
    const view = this.#lastView();
    assert.equal(view.businessName, this.aliases.name(business));
    if (rating !== undefined) assert.equal(view.rating, rating);
    if (totalReviews !== undefined) assert.equal(view.totalReviews, totalReviews);
  }

  assertSeesReviewsWithStars(expectedStars) {
    assert.deepEqual(
      this.#lastView().reviews.map((r) => r.stars),
      expectedStars,
    );
  }

  assertSeesReviewBy(author) {
    const authors = this.#lastView().reviews.map((r) => r.author);
    assert.ok(authors.includes(author), `Expected a review by "${author}", saw: ${authors.join(', ')}`);
  }

  #avatarOf(author) {
    const review = this.#lastView().reviews.find((r) => r.author === author);
    assert.ok(review, `Expected a review by "${author}"`);
    if (review.avatar === null) throw new Error(`Avatars are not observable via the ${this.channel} channel`);
    return review.avatar;
  }

  assertSeesPhotoOf(author) {
    assert.deepEqual(this.#avatarOf(author), { photo: true, initial: null }, `Expected to see a photo of "${author}"`);
  }

  assertSeesInitialOf(author, initial) {
    assert.deepEqual(this.#avatarOf(author), { photo: false, initial }, `Expected to see "${initial}" for "${author}"`);
  }

  assertSeesFooter(text) {
    assert.equal(this.#lastView().footerBranding, text);
  }

  assertSeesNoAgencyBranding() {
    assert.equal(this.#lastView().footerBranding, null);
  }

  assertSeesGoogleAttribution() {
    const { googleAttribution } = this.#lastView();
    if (googleAttribution === null) throw new Error(`Google attribution is not observable via the ${this.channel} channel`);
    assert.equal(googleAttribution, true, 'Reviews must be attributed to Google');
  }

  assertLandsOnGoogleReviewFormFor(business) {
    assert.ok(this.#landedOn, 'The visitor has not followed a review link yet');
    const url = new URL(this.#landedOn);
    assert.equal(url.origin + url.pathname, 'https://search.google.com/local/writereview');
    assert.equal(url.searchParams.get('placeid'), this.aliases.placeId(business));
  }
}

/**
 * @param {{ channel?: 'api' | 'browser' }} [options]
 *   Which protocol driver the visitor uses to see widgets.
 */
export function createDsl({ channel = 'api' } = {}) {
  const aliases = new Aliases();
  const agencyDriver = new AgencyApiDriver();
  const visitorDriver = channel === 'browser' ? new BrowserVisitorDriver() : new ApiVisitorDriver();

  const dashboard = new AgencyDashboardDriver();

  const google = new GoogleDsl(aliases, new GoogleStubDriver());
  const agency = new AgencyDsl(aliases, agencyDriver, dashboard);
  const visitor = new VisitorDsl(aliases, agency, visitorDriver, agencyDriver);

  return {
    google,
    agency,
    visitor,
    monthlyGoogleRequestsPerWidget: config.googleRequestsPerWidgetPerMonth,
    close: () => Promise.all([visitorDriver.close(), dashboard.close()]),
  };
}

export const CHANNELS = ['api', 'browser'];
