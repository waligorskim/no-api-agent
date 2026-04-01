/**
 * Anti-Annoyance Layer (AAL)
 * Universal scripts and patterns for suppressing cookie banners,
 * popups, ads, trackers, and other browsing friction.
 * Applied to all browser-based cascade levels (L3+).
 */

/**
 * Domains to block at the network level (ads, trackers, analytics).
 * Used by Puppeteer request interception.
 */
export const AD_BLOCK_DOMAINS = [
  // Google Ads / Analytics
  'googlesyndication.com',
  'doubleclick.net',
  'google-analytics.com',
  'googletagmanager.com',
  'googleadservices.com',
  'pagead2.googlesyndication.com',
  // Facebook / Meta
  'facebook.net',
  'facebook.com/tr',
  'connect.facebook.net',
  'fbevents.js',
  // Analytics & tracking
  'hotjar.com',
  'segment.com',
  'segment.io',
  'mixpanel.com',
  'amplitude.com',
  'fullstory.com',
  'clarity.ms',
  'newrelic.com',
  'nr-data.net',
  'sentry.io',
  // Ad networks
  'amazon-adsystem.com',
  'criteo.com',
  'outbrain.com',
  'taboola.com',
  'adnxs.com',
  'adsrvr.org',
  'rubiconproject.com',
  // Chat widgets (we don't need them)
  'intercom.io',
  'intercomcdn.com',
  'drift.com',
  'zendesk.com',
  'tawk.to',
  'crisp.chat',
  'livechatinc.com',
  // Cookie consent platforms (we handle consent ourselves)
  'cookiebot.com',
  'onetrust.com',
  'trustarc.com',
  'quantcast.com',
  'didomi.io',
  'consensu.org',
];

/**
 * Common cookie consent opt-out cookies.
 * Set these preemptively to suppress banners.
 */
export const OPT_OUT_COOKIES = [
  { name: 'OptanonAlertBoxClosed', value: new Date().toISOString() },
  { name: 'OptanonConsent', value: 'isGpcEnabled=0&datestamp=' + encodeURIComponent(new Date().toISOString()) + '&version=6.38.0&isIABGlobal=false&consentId=0&interactionCount=1&landingPath=NotLandingPage&groups=C0001:1,C0002:0,C0003:0,C0004:0' },
  { name: 'CookieConsent', value: 'necessary' },
  { name: 'cookie_consent', value: 'accepted' },
  { name: 'gdpr_consent', value: '1' },
  { name: 'cookie-agreed', value: '2' },
  { name: '_cookieconsent', value: '!' },
  { name: 'cookieconsent_status', value: 'dismiss' },
];

/**
 * Get injectable browser scripts for anti-annoyance.
 * These are designed to run via page.evaluate() in Puppeteer.
 */
export function getAntiAnnoyanceScripts() {
  return {
    /**
     * Dismiss cookie consent banners.
     * Tries "Reject All" first, then "Accept All" as fallback.
     */
    dismissCookieConsent: () => {
      // Strategy 1: Click reject/necessary-only buttons first
      const rejectPatterns = /reject|deny|necessary only|essential only|decline|refuse/i;
      const acceptPatterns = /accept all|agree|got it|ok|i understand|allow|consent|continue/i;

      function findAndClick(pattern) {
        const candidates = [
          ...document.querySelectorAll('button'),
          ...document.querySelectorAll('a[role="button"]'),
          ...document.querySelectorAll('[class*="cookie"] a'),
          ...document.querySelectorAll('[class*="consent"] a'),
        ];
        for (const el of candidates) {
          const text = (el.textContent || el.getAttribute('aria-label') || '').trim();
          if (pattern.test(text) && el.offsetParent !== null) {
            el.click();
            return true;
          }
        }
        return false;
      }

      // Try reject first, then accept
      if (!findAndClick(rejectPatterns)) {
        findAndClick(acceptPatterns);
      }

      // Strategy 2: Hide remaining consent elements via CSS
      const style = document.createElement('style');
      style.textContent = `
        [class*="cookie-banner"], [class*="cookie-consent"], [class*="cookieBanner"],
        [class*="CookieConsent"], [id*="cookie-banner"], [id*="cookie-consent"],
        [id*="CookieConsent"], [class*="gdpr"], [id*="gdpr"],
        [class*="consent-banner"], [class*="consent-modal"],
        .cc-banner, .cc-window, .cc-overlay,
        #onetrust-banner-sdk, #onetrust-consent-sdk,
        .didomi-popup, .didomi-notice,
        [class*="cookie-wall"], [class*="cookie-overlay"],
        .qc-cmp-ui-container { display: none !important; visibility: hidden !important; }
        body { overflow: auto !important; }
        html { overflow: auto !important; }
      `;
      document.head.appendChild(style);
    },

    /**
     * Kill popups, modals, newsletter signups, app install banners, chat widgets.
     */
    killPopups: () => {
      const style = document.createElement('style');
      style.textContent = `
        /* Newsletter / signup modals */
        [class*="newsletter"], [class*="subscribe-modal"], [class*="signup-modal"],
        [class*="popup-overlay"], [class*="modal-overlay"],
        /* App install banners */
        [class*="app-banner"], [class*="smart-banner"], [class*="download-app"],
        [id*="branch-banner"], .smartbanner,
        /* Chat widgets */
        [class*="intercom"], [class*="drift-"], [id*="hubspot-messages"],
        [class*="zendesk"], [class*="tawk-"], [class*="crisp-client"],
        [id*="livechat"], [class*="livechat"],
        /* Generic overlays that look like modals */
        [class*="overlay"]:not([class*="video"]):not([class*="image"]) {
          display: none !important;
          visibility: hidden !important;
        }
        /* Restore scroll on body when modals are hidden */
        body.modal-open, body.no-scroll, body.overflow-hidden,
        body[style*="overflow: hidden"], body[style*="overflow:hidden"] {
          overflow: auto !important;
          position: static !important;
        }
      `;
      document.head.appendChild(style);

      // Also try to close via MutationObserver for late-loading modals
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            const el = /** @type {HTMLElement} */ (node);
            const cls = (el.className || '').toString().toLowerCase();
            const id = (el.id || '').toLowerCase();
            if (/modal|popup|overlay|newsletter|subscribe/.test(cls + id)) {
              el.style.display = 'none';
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // Auto-disconnect after 10 seconds to save resources
      setTimeout(() => observer.disconnect(), 10000);
    },

    /**
     * Disable CSS animations and transitions for faster rendering.
     */
    disableAnimations: () => {
      const style = document.createElement('style');
      style.textContent = `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          scroll-behavior: auto !important;
        }
      `;
      document.head.appendChild(style);
    },
  };
}

/**
 * Set preemptive opt-out cookies on a Puppeteer page.
 * @param {import('puppeteer').Page} page
 * @param {string} url
 */
export async function setOptOutCookies(page, url) {
  const domain = new URL(url).hostname;
  const cookies = OPT_OUT_COOKIES.map(c => ({
    ...c,
    domain: `.${domain}`,
    path: '/',
    httpOnly: false,
    secure: false,
  }));
  await page.setCookie(...cookies);
}
