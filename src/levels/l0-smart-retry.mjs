/**
 * Level 0 — Smart Retry with header rotation.
 * Pure Node.js fetch with progressively aggressive header spoofing.
 */

import { packContent, classifyFailure } from '../result.mjs';

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
];

const HEADER_VARIANTS = [
  // Minimal
  {},
  // Browser-like
  {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  },
  // With referer (looks like Google click-through)
  {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://www.google.com/',
    'DNT': '1',
    'Upgrade-Insecure-Requests': '1',
  },
];

/**
 * @param {string} url
 * @param {{ timeout?: number, maxAttempts?: number }} options
 * @returns {Promise<{ success: boolean, data?: string, status?: number, error?: string, attempts: number, final_url?: string, page_title?: string }>}
 */
export async function execute(url, options = {}) {
  const { timeout = 10000, maxAttempts = 3 } = options;
  let lastError = '';
  let lastStatus = 0;
  let lastBody = '';

  for (let i = 0; i < maxAttempts; i++) {
    const ua = USER_AGENTS[i % USER_AGENTS.length];
    const headers = {
      'User-Agent': ua,
      ...HEADER_VARIANTS[i % HEADER_VARIANTS.length],
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);

      lastStatus = response.status;
      lastBody = await response.text();

      // Success check: 2xx with actual content
      if (response.ok && lastBody.length > 500) {
        // Quick check: is this a bot challenge page?
        if (isChallengeResponse(lastBody)) {
          lastError = 'Bot challenge page detected';
          continue;
        }

        const title = extractTitle(lastBody);
        return {
          success: true,
          data: lastBody,
          status: lastStatus,
          attempts: i + 1,
          final_url: response.url,
          page_title: title,
        };
      }

      // Got response but it's thin — might be SPA or blocked
      if (response.ok && lastBody.length <= 500) {
        lastError = `Response too thin (${lastBody.length} bytes) — likely SPA or bot block`;
        continue;
      }

      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err.name === 'AbortError' ? 'Timeout' : err.message;
    }

    // Brief pause between retries
    if (i < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    }
  }

  return {
    success: false,
    status: lastStatus,
    error: lastError,
    attempts: maxAttempts,
  };
}

/**
 * Detect if a response is actually a bot challenge page.
 * @param {string} html
 */
function isChallengeResponse(html) {
  const lower = html.toLowerCase();
  const signals = [
    'just a moment',           // Cloudflare
    'checking your browser',   // Cloudflare
    'cf-browser-verification', // Cloudflare
    'challenge-platform',      // Cloudflare
    'ray id',                  // Cloudflare
    'ddos-guard',              // DDoS-Guard
    'access denied',           // Generic WAF
    'bot detection',           // Generic
    'please verify you are a human', // Various
    'captcha',                 // Various
  ];
  const matchCount = signals.filter(s => lower.includes(s)).length;
  return matchCount >= 2; // Need at least 2 signals to avoid false positives
}

/**
 * Extract <title> from HTML.
 * @param {string} html
 */
function extractTitle(html) {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/is);
  return match ? match[1].trim() : undefined;
}

export const LEVEL = 0;
export const METHOD = 'smart_retry';
