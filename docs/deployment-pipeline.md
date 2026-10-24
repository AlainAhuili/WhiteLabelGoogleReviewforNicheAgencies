# Deployment Pipeline

This project is developed with Continuous Delivery as described by Dave Farley in *Continuous Delivery* (with Jez Humble) and *Modern Software Engineering*. The goal is that **every commit to `main` produces a release candidate. If the candidate passes the pipeline, it is releasable.** The pipeline is the only route to production. It falsifies a release candidate as quickly and cheaply as possible.

```
 commit ──► COMMIT STAGE ──────────► ACCEPTANCE STAGE ─────────────► RELEASE STAGE
            lint                      deploy the release candidate     promote the same
            unit + component tests    in a production-like container   image to ghcr.io
            coverage gate (85%)       Google stubbed at the boundary   (:sha and :latest)
            dependency audit          smoke tests
            BUILD RELEASE CANDIDATE   executable specifications
            (Docker image, once)      (API and real browser)
            target: < 5 min                                            main only
```

Definition: [`.github/workflows/pipeline.yml`](../.github/workflows/pipeline.yml)

## Stages

### 1. Commit stage: fast feedback

The commit stage runs on every push and pull request. It answers one question: *is this change worth testing further?*

| Step | Command | Why |
| --- | --- | --- |
| Lint | `npm run lint` | Catches defects and unsafe patterns before any test runs |
| Unit and component tests | `npm run test:firestore` | Fast, in-process tests of behavior; no browser. The embed script runs in a simulated DOM (jsdom). The store tests run against both the JSON file and a local Firestore emulator, so both stores behave the same |
| Coverage gate | built into `npm test` (85% lines) | Stops untested code from slipping in |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | Checks the supply chain |
| Build release candidate | `docker build --build-arg APP_VERSION=$SHA` | **Built once.** Every later stage uses this exact image |

Developers run the same checks before pushing:

```bash
npm run commit-stage
```

### 2. Acceptance stage: is it releasable?

The acceptance stage takes the *same image* the commit stage built, deploys it the way production would, and checks it against executable specifications that describe what users need.

```bash
IMAGE=reputation-widget:<sha> npm run acceptance-stage   # test a release candidate image
npm run acceptance-stage                                 # test the working copy (no Docker)
```

[`scripts/run-acceptance-stage.js`](../scripts/run-acceptance-stage.js) does the following:

1. Starts the **Google Places stub** ([`acceptance/stubs`](../acceptance/stubs/google-places-stub.js)). Third-party systems are faked at the system boundary, so tests are deterministic, free and fast. The stub has a *back channel* that tests use to arrange data ("given this business has these reviews") and to inspect calls ("Google was asked once").
2. **Deploys the release candidate**: `docker run` with configuration supplied through environment variables, as in production.
3. Waits for `/healthz`, then runs the **smoke tests**, followed by the **acceptance tests** in parallel.
4. Prints the system's logs if anything fails, and always tears everything down.

### 3. Release stage

The release stage runs only on `main`, and only after both earlier stages pass. It pushes the **unchanged** release candidate to GitHub Container Registry as `ghcr.io/<owner>/reputation-widget:<sha>` and `:latest`. Because nothing is rebuilt, what you release is exactly what you tested.

Deploying to a host is one command, followed by the smoke tests:

```bash
docker run -d -p 3000:3000 -v reviews-data:/app/data \
  -e PUBLIC_URL=https://reviews.example -e GOOGLE_PLACES_API_KEY=... -e OPERATOR_API_KEY=... \
  ghcr.io/<owner>/reputation-widget:<sha>

BASE_URL=https://reviews.example EXPECTED_VERSION=<sha> npm run test:smoke
```

## Acceptance test architecture: four layers

The acceptance tests follow Farley's four-layer model. Each layer has one job, so changes to the UI or API only affect the drivers, not the specifications.

```
acceptance/
  specs/      1. TEST CASES    What the system must do, in business language.
                               No URLs, no HTTP, no CSS selectors.
  dsl/        2. DSL           Turns intent into actions. Handles aliasing and
                               functional isolation. Shared by all specs.
  drivers/    3. PROTOCOL      How to talk to the system: HTTP API driver,
                  DRIVERS      real-browser driver, Google stub driver.
  stubs/                       Fakes for external systems at the boundary.
              4. SYSTEM UNDER TEST: the deployed release candidate.
```

An example specification ([`showing-reviews.spec.js`](../acceptance/specs/showing-reviews.spec.js)):

```js
await google.businessHasReviews('Sunrise Dental', {
  reviews: [{ stars: 5 }, { stars: 2 }, { stars: 4 }, { stars: 3 }, { stars: 5 }],
});
await agency.signsUp();
await agency.publishesWidget('Homepage widget', { business: 'Sunrise Dental', minStars: 4 });

await visitor.viewsWidget('Homepage widget');

visitor.assertSeesReviewsWithStars([5, 4, 5]);
```

**One spec, several channels.** The same specification runs once through the `api` driver, which is fast, and once through the `browser` driver. The browser driver embeds the widget in a third-party page on a *different origin* in real Chromium, exactly as a client site would. That proves the embed snippet, CORS and rendering all work.

**Functional isolation.** Every name in a spec ("Sunrise Dental", "Acme Agency") is an *alias*. The DSL maps it to a unique value for each test run, and each test provisions its own agency through the operator API. As a result, tests never share data. They can run in parallel and against a long-lived shared environment without cleanup between runs.

**Smoke tests** ([`acceptance/smoke`](../acceptance/smoke/deployment.spec.js)) are read-only. They check health, the deployed version, the embed script and the dashboard, so they are safe to run against production after every deploy.

## Engineering practices

Farley groups the practices in *Modern Software Engineering* into two sets: practices that help you learn, and practices that help you manage complexity.

**Optimize for learning**
- *Fast feedback:* the commit stage is kept under five minutes, and locally `npm run commit-stage` takes seconds. The acceptance specs run in parallel.
- *Work in small steps:* use trunk-based development with small, frequent commits to `main`. Keep branches short-lived (hours, not days).
- *Empiricism:* `/healthz` reports the commit each environment runs, and smoke tests verify it.
- *Experimentation:* testing a hypothesis is cheap, because any green commit can go to production.

**Manage complexity**
- *Modularity and separation of concerns:* storage (`store.js`), the external API (`google.js`), caching policy (`reviews.js`), validation and HTTP (`app.js`) are separate modules.
- *Abstraction at boundaries:* the Places client is injected, so it can be a real client, a demo client or a stub without changing callers.
- *Testability as a design tool:* configuration lives entirely in the environment (`GOOGLE_PLACES_BASE_URL`, `OPERATOR_API_KEY`, `APP_VERSION`), so the same build runs everywhere.

## Working agreement

1. Pull from `main` often. Run `npm run commit-stage` before every push.
2. Write or extend an executable specification for each user-visible behavior, before or alongside the code.
3. If the pipeline goes red on `main`, fixing it is the team's top priority. Fix forward quickly or revert.
4. Never skip or disable a failing test to go green. A failing test is information.
5. Release only images that came out of the release stage. Never build an image by hand for production.
