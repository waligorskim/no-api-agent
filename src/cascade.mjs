/**
 * Cascade Engine — orchestrates fallback levels.
 * Runs levels sequentially, skips based on site profiles and signal detection,
 * returns standardized WebAccessResult.
 */

import * as L0 from './levels/l0-smart-retry.mjs';
import * as L1 from './levels/l1-brave-search.mjs';
import * as L2 from './levels/l2-firecrawl.mjs';
import * as L3 from './levels/l3-puppeteer.mjs';
import { createResult, packContent, classifyFailure } from './result.mjs';
import { getProfile, recordSuccess, recordFailure } from './site-profiles.mjs';

/**
 * Signal detection — analyze early failures to skip levels intelligently.
 * @param {number} status
 * @param {string} body
 * @param {string} error
 * @returns {{ skipTo: number | null, reason: string }}
 */
function detectSignal(status, body = '', error = '') {
  const text = (body + ' ' + error).toLowerCase();

  // Cloudflare / bot protection → skip to Puppeteer stealth
  if (text.includes('cloudflare') || text.includes('cf-browser-verification') ||
      text.includes('challenge-platform') || text.includes('ddos-guard')) {
    return { skipTo: 3, reason: 'Bot protection detected (Cloudflare/DDoS-Guard)' };
  }

  // Login required → will need real browser session (L4+) but try L3 first
  if (status === 401 || (status === 403 && (text.includes('login') || text.includes('sign in')))) {
    return { skipTo: 3, reason: 'Authentication required' };
  }

  // SPA / empty body → Firecrawl can render JS
  if (status === 200 && body.length < 500 && !text.includes('captcha')) {
    return { skipTo: 2, reason: 'Thin response — likely SPA, needs JS rendering' };
  }

  // CAPTCHA → need vision-based approach (MCP hint for L5/L6)
  if (text.includes('captcha') || text.includes('recaptcha') || text.includes('hcaptcha')) {
    return { skipTo: 3, reason: 'CAPTCHA detected — escalating to browser' };
  }

  return { skipTo: null, reason: '' };
}

/**
 * @typedef {Object} CascadeOptions
 * @property {string} [intent] — What we're trying to get
 * @property {number} [maxLevel] — Highest level to attempt (default: 3 for Phase 1)
 * @property {number} [startLevel] — Override starting level
 * @property {boolean} [screenshot] — Take screenshots at browser levels
 * @property {number} [maxContentBytes] — Max content size to return (default: 8192)
 * @property {number} [budgetCents] — Max cost in cents (not enforced in Phase 1)
 */

/**
 * Run the cascade for a given URL.
 * @param {string} url
 * @param {CascadeOptions} options
 * @returns {Promise<import('./result.mjs').WebAccessResult>}
 */
export async function runCascade(url, options = {}) {
  const {
    intent = '',
    maxLevel = 3,
    startLevel,
    screenshot = false,
    maxContentBytes = 8192,
  } = options;

  const startTime = Date.now();
  const result = createResult({ url, intent });

  // Check site profile for known minimum level
  const profile = await getProfile(url);
  let currentLevel = startLevel ?? profile?.level ?? 0;

  if (profile) {
    result.levels_attempted.push({
      level: -1,
      method: 'site_profile_lookup',
      duration_ms: 0,
      skipped_reason: `Profile says min level ${profile.level}: ${profile.reason}`,
    });
  }

  // ─── LEVEL 0: Smart Retry ───
  if (currentLevel <= 0 && maxLevel >= 0) {
    const t0 = Date.now();
    const l0 = await L0.execute(url);
    const attempt = { level: 0, method: L0.METHOD, duration_ms: Date.now() - t0 };

    if (l0.success) {
      attempt.error = undefined;
      result.levels_attempted.push(attempt);
      return finalize(result, 0, L0.METHOD, l0.data, 'markdown', l0.page_title, l0.final_url, maxContentBytes, startTime);
    }

    attempt.error = l0.error;
    result.levels_attempted.push(attempt);
    await recordFailure(url, 0, l0.error);

    // Check signals to skip levels
    const signal = detectSignal(l0.status, l0.data || '', l0.error);
    if (signal.skipTo !== null && signal.skipTo > currentLevel) {
      currentLevel = signal.skipTo;
      result.levels_attempted.push({
        level: currentLevel - 1,
        method: 'signal_skip',
        duration_ms: 0,
        skipped_reason: signal.reason,
      });
    } else {
      currentLevel = 1;
    }
  }

  // ─── LEVEL 1: Brave Search ───
  if (currentLevel <= 1 && maxLevel >= 1) {
    const t0 = Date.now();
    const l1 = await L1.execute(url, intent);
    const attempt = { level: 1, method: L1.METHOD, duration_ms: Date.now() - t0 };

    if (l1.success) {
      result.levels_attempted.push(attempt);
      return finalize(result, 1, L1.METHOD, l1.data, 'markdown', undefined, undefined, maxContentBytes, startTime);
    }

    attempt.error = l1.error;
    if (l1.mcp_hint) {
      attempt.error += ` | MCP hint: ${l1.mcp_hint}`;
    }
    result.levels_attempted.push(attempt);
    currentLevel = 2;
  }

  // ─── LEVEL 2: Firecrawl ───
  if (currentLevel <= 2 && maxLevel >= 2) {
    const t0 = Date.now();
    const l2 = await L2.execute(url);
    const attempt = { level: 2, method: L2.METHOD, duration_ms: Date.now() - t0 };

    if (l2.success) {
      result.levels_attempted.push(attempt);
      return finalize(result, 2, L2.METHOD, l2.data, 'markdown', l2.page_title, l2.final_url, maxContentBytes, startTime);
    }

    attempt.error = l2.error;
    result.levels_attempted.push(attempt);
    await recordFailure(url, 2, l2.error);
    currentLevel = 3;
  }

  // ─── LEVEL 3: Puppeteer Stealth ───
  if (currentLevel <= 3 && maxLevel >= 3) {
    const t0 = Date.now();
    const l3 = await L3.execute(url, { screenshot });
    const attempt = { level: 3, method: L3.METHOD, duration_ms: Date.now() - t0 };

    if (l3.success) {
      result.levels_attempted.push(attempt);
      const screenshots = l3.screenshot_path ? [l3.screenshot_path] : undefined;
      return finalize(result, 3, L3.METHOD, l3.data, 'markdown', l3.page_title, l3.final_url, maxContentBytes, startTime, screenshots);
    }

    attempt.error = l3.error;
    result.levels_attempted.push(attempt);
    await recordFailure(url, 3, l3.error);
  }

  // ─── ALL LEVELS FAILED ───
  const totalTime = Date.now() - startTime;
  result.metadata.total_duration_ms = totalTime;

  // Build diagnostic
  const lastError = result.levels_attempted[result.levels_attempted.length - 1]?.error || 'unknown';
  const rootCause = classifyFailure(0, '', lastError);

  result.diagnostic = {
    root_cause: rootCause,
    details: `All ${result.levels_attempted.length} levels failed. Last error: ${lastError}`,
    suggested_action: getSuggestedAction(rootCause, url),
  };

  // Return MCP escalation hints for Claude
  result.diagnostic.details += `\n\n--- MCP ESCALATION ---\n` +
    `The standalone cascade exhausted levels 0-${maxLevel}. ` +
    `Claude should now try these MCP tools in order:\n` +
    `1. mcp__browser-tools__takeScreenshot — check if the page is visible in your browser\n` +
    `2. mcp__puppeteer__puppeteer_navigate to "${url}" + mcp__puppeteer__puppeteer_evaluate to extract content\n` +
    `3. If auth needed: ask the user to navigate to the URL in their browser, then use mcp__browser-tools__getSelectedElement\n`;

  return result;
}

/**
 * Finalize a successful result.
 */
function finalize(result, level, method, data, format, title, finalUrl, maxBytes, startTime, screenshots) {
  result.success = true;
  result.level_used = level;
  result.method = method;
  result.content = packContent(data, format, maxBytes);
  result.metadata = {
    total_duration_ms: Date.now() - startTime,
    page_title: title,
    final_url: finalUrl,
    screenshots,
  };

  // Record success in site profiles
  recordSuccess(result.url, level, method).catch(() => {});

  return result;
}

/**
 * Suggest next steps based on root cause.
 */
function getSuggestedAction(rootCause, url) {
  const actions = {
    bot_protection: `Site has aggressive bot protection. Try: (1) use your real browser via Browser-Tools MCP, (2) use Alumnium AI browser agent, or (3) navigate manually and copy content.`,
    auth_required: `Authentication required. Try: (1) open ${url} in your browser while logged in, then use Browser-Tools MCP to read it, (2) provide credentials as env vars for automated login.`,
    content_missing: `Content may not exist at this URL. Verify the URL is correct, or search for the content on Brave/Google.`,
    geo_blocked: `Content is geo-restricted. Try: (1) use a VPN, (2) search for cached/mirrored versions via Brave Search.`,
    rate_limited: `Rate limited. Wait and retry later, or use a different IP/proxy.`,
    unknown: `Unclear why all methods failed. Try navigating to ${url} manually to diagnose.`,
  };
  return actions[rootCause] || actions.unknown;
}
