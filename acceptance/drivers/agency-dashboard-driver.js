import { chromium } from 'playwright';
import { config } from '../config.js';

/**
 * Drives the agency dashboard in a real browser: signs in with the agency's API
 * key, as a person would, and reads what the widget list shows.
 */
export class AgencyDashboardDriver {
  #browser = null;

  async #page() {
    this.#browser ??= await chromium.launch({ executablePath: config.chromiumPath });
    return this.#browser.newPage();
  }

  async listWidgets(apiKey) {
    const page = await this.#page();
    try {
      await page.goto(`${config.baseUrl}/admin/`);
      await page.fill('#api-key', apiKey);
      await page.click('#login-form button[type=submit]');
      await page.waitForSelector('#widget-list li, #no-widgets:not([hidden])', { timeout: 10_000 });

      return await page.evaluate(() =>
        [...document.querySelectorAll('#widget-list li')].map((li) => {
          const usage = li.querySelector('.usage');
          const numbers = /(\d+) of (\d+)/.exec(usage?.textContent ?? '');
          return {
            name: li.querySelector('strong').textContent.trim(),
            googleRequests: numbers ? { used: Number(numbers[1]), allowance: Number(numbers[2]) } : null,
            allowanceUsedUp: Boolean(usage?.classList.contains('used-up')),
          };
        }),
      );
    } finally {
      await page.close();
    }
  }

  async close() {
    await this.#browser?.close();
  }
}
