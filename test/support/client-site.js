import { JSDOM } from 'jsdom';

export const SCRIPT_URL = 'https://widgets.example/widget.js';

/**
 * Simulates a client's website for the embed script: a page on its own origin
 * that includes widget.js from the widget server, with fetch stubbed.
 *
 * The script can only be loaded once per process, and Node runs each test file
 * in its own process. So a test file that needs the script to start in a
 * different situation (e.g. while the page is still loading) gets its own file.
 *
 * @param {{ scriptUrl?: string | null, pageStillLoading?: boolean }} [options]
 */
export function simulateClientSite({ scriptUrl = SCRIPT_URL, pageStillLoading = false } = {}) {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://client.example/' });
  const { document } = window;
  if (scriptUrl) Object.defineProperty(document, 'currentScript', { value: { src: scriptUrl }, configurable: true });
  if (pageStillLoading) Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });

  const site = {
    window,
    document,
    requests: [],
    respond: () => ({ ok: true, status: 200, json: async () => ({}) }),

    respondWith(data) {
      site.respond = () => ({ ok: true, status: 200, json: async () => data });
    },

    /** Adds an element to the page, embedded with the widget id if given. */
    addWidget(id) {
      const host = document.createElement('div');
      if (id) host.setAttribute('data-review-widget', id);
      document.body.append(host);
      return host;
    },

    loadScript: () => import('../../public/widget.js'),

    finishLoading() {
      delete document.readyState;
      document.dispatchEvent(new window.Event('DOMContentLoaded'));
    },
  };

  globalThis.window = window;
  globalThis.document = document;
  globalThis.fetch = async (url, options) => {
    site.requests.push({ url, options });
    return site.respond();
  };
  return site;
}
