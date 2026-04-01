/**
 * Level 3 — Headless Puppeteer with stealth.
 * Full Chrome browser for JS-heavy sites with bot protection.
 */

import { packContent } from '../result.mjs';
import { getAntiAnnoyanceScripts, AD_BLOCK_DOMAINS } from '../anti-annoyance.mjs';

/** @type {import('puppeteer').Browser | null} */
let browserInstance = null;

/**
 * @param {string} url
 * @param {{ timeout?: number, extractText?: boolean, screenshot?: boolean, screenshotPath?: string }} options
 * @returns {Promise<{ success: boolean, data?: string, error?: string, page_title?: string, final_url?: string, screenshot_path?: string }>}
 */
export async function execute(url, options = {}) {
  const { timeout = 30000, extractText = true, screenshot = false, screenshotPath } = options;

  let browser, page;
  try {
    // Dynamic import — puppeteer-extra is optional
    const puppeteerExtra = await import('puppeteer-extra').catch(() => null);
    const stealthPlugin = await import('puppeteer-extra-plugin-stealth').catch(() => null);

    if (puppeteerExtra && stealthPlugin) {
      puppeteerExtra.default.use(stealthPlugin.default());
      browser = await puppeteerExtra.default.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-notifications',
          '--disable-popup-blocking',
        ],
      });
    } else {
      // Fallback: plain puppeteer
      const puppeteer = await import('puppeteer');
      browser = await puppeteer.default.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-notifications',
          '--disable-popup-blocking',
        ],
      });
    }

    page = await browser.newPage();

    // Set realistic viewport
    const jitter = Math.floor(Math.random() * 50);
    await page.setViewport({ width: 1920 + jitter, height: 1080 + jitter });

    // Request interception: block ads, trackers, and optionally images
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      const reqUrl = req.url();

      // Block ads and trackers
      if (AD_BLOCK_DOMAINS.some(d => reqUrl.includes(d))) {
        req.abort();
        return;
      }

      // Block heavy resources when we only need text
      if (extractText && ['image', 'media', 'font'].includes(resourceType)) {
        req.abort();
        return;
      }

      req.continue();
    });

    // Navigate with timeout
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout,
    });

    // Inject anti-annoyance scripts
    const aaScripts = getAntiAnnoyanceScripts();
    await page.evaluate(aaScripts.dismissCookieConsent);
    await page.evaluate(aaScripts.killPopups);
    await page.evaluate(aaScripts.disableAnimations);

    // Wait a beat for any remaining JS
    await new Promise(r => setTimeout(r, 1000));

    // Extract content
    const title = await page.title();
    const finalUrl = page.url();

    let content = '';
    if (extractText) {
      // Extract readable text content
      content = await page.evaluate(() => {
        // Remove script, style, nav, footer, aside elements
        const removeSelectors = ['script', 'style', 'nav', 'footer', 'aside', 'header',
          '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
          '[class*="cookie"]', '[class*="popup"]', '[class*="modal"]', '[class*="overlay"]',
          '[class*="sidebar"]', '[class*="ad-"]', '[class*="advertisement"]'];
        removeSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => el.remove());
        });

        // Get main content area or fall back to body
        const main = document.querySelector('main, [role="main"], article, .content, #content');
        const target = main || document.body;

        return target.innerText?.trim() || '';
      });
    }

    // Take screenshot if requested
    let screenshotFile;
    if (screenshot) {
      screenshotFile = screenshotPath || `/tmp/no-api-agent-${Date.now()}.png`;
      await page.screenshot({ path: screenshotFile, fullPage: false });
    }

    if (!content || content.length < 100) {
      return {
        success: false,
        error: `Puppeteer: thin content (${content.length} chars)`,
        page_title: title,
        final_url: finalUrl,
      };
    }

    return {
      success: true,
      data: content,
      page_title: title,
      final_url: finalUrl,
      screenshot_path: screenshotFile,
    };
  } catch (err) {
    return {
      success: false,
      error: `Puppeteer: ${err.message}`,
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

export const LEVEL = 3;
export const METHOD = 'puppeteer_stealth';
