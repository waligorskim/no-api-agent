#!/usr/bin/env node

/**
 * Claude Code PostToolUse Hook — Auto-triggers cascade when WebFetch/fetch fails.
 *
 * Install in ~/.claude/settings.json:
 * {
 *   "hooks": {
 *     "PostToolUse": [{
 *       "matcher": "WebFetch|mcp__fetch__fetch",
 *       "hooks": [{
 *         "type": "command",
 *         "command": "node /path/to/no-api-agent/hooks/web-access-fallback.mjs",
 *         "timeout": 120000
 *       }]
 *     }]
 *   }
 * }
 *
 * Reads tool result from stdin, detects failures, runs cascade, returns additionalContext.
 */

import { runCascade } from '../src/cascade.mjs';

// Read hook input from stdin
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
}

let hookData;
try {
  hookData = JSON.parse(input);
} catch {
  // Not valid JSON — ignore
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

const { tool_name, tool_input, tool_result } = hookData;

// Only process fetch-like tools
if (!['WebFetch', 'mcp__fetch__fetch'].includes(tool_name)) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

// Extract URL from tool input
const url = tool_input?.url || tool_input?.uri || '';
if (!url) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

// Detect if the fetch actually failed
const resultStr = typeof tool_result === 'string' ? tool_result : JSON.stringify(tool_result || '');
const isFailure = detectFailure(resultStr, tool_result);

if (!isFailure) {
  // Fetch succeeded — no intervention needed
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

// Fetch failed — run cascade
process.stderr.write(`[no-api-agent] WebFetch failed for ${url}, initiating cascade...\n`);

try {
  const result = await runCascade(url, {
    intent: '',  // We don't know the intent from the hook context
    maxLevel: 2, // Hook runs L0-L2 only (fast). L3+ is too slow for automatic hook.
  });

  if (result.success) {
    // Return content as additional context for Claude
    const context = [
      `--- no-api-agent: WebFetch fallback succeeded (Level ${result.level_used}: ${result.method}) ---`,
      `URL: ${url}`,
      result.metadata.page_title ? `Title: ${result.metadata.page_title}` : '',
      `Content (${result.content.byte_size} bytes, ${result.content.format}):`,
      '',
      result.content.data,
      '',
      `--- end no-api-agent ---`,
    ].filter(Boolean).join('\n');

    process.stdout.write(JSON.stringify({ additionalContext: context }));
  } else {
    // Cascade failed too — give Claude hints on what to try next
    const hints = [
      `--- no-api-agent: WebFetch AND cascade fallback both failed for ${url} ---`,
      `Levels attempted: ${result.levels_attempted.map(a => `L${a.level}:${a.method}`).join(' → ')}`,
      '',
      `Root cause: ${result.diagnostic?.root_cause || 'unknown'}`,
      result.diagnostic?.suggested_action || '',
      '',
      'Recommended next steps for Claude:',
      '1. Try mcp__puppeteer__puppeteer_navigate + puppeteer_evaluate (full browser)',
      '2. Try mcp__browser-tools__takeScreenshot to see the page in the user\'s browser',
      '3. Ask the user to navigate to the URL and copy the relevant content',
      `--- end no-api-agent ---`,
    ].join('\n');

    process.stdout.write(JSON.stringify({ additionalContext: hints }));
  }
} catch (err) {
  process.stderr.write(`[no-api-agent] Cascade error: ${err.message}\n`);
  process.stdout.write(JSON.stringify({
    additionalContext: `[no-api-agent] Automatic fallback failed: ${err.message}. Try using mcp__puppeteer or mcp__browser-tools directly.`,
  }));
}

/**
 * Detect if a WebFetch/fetch result indicates failure.
 * @param {string} resultStr
 * @param {any} rawResult
 * @returns {boolean}
 */
function detectFailure(resultStr, rawResult) {
  const lower = resultStr.toLowerCase();

  // Explicit error indicators
  if (lower.includes('econnrefused') || lower.includes('etimedout') ||
      lower.includes('enotfound') || lower.includes('fetch failed') ||
      lower.includes('network error') || lower.includes('aborted')) {
    return true;
  }

  // HTTP error status codes
  const statusMatch = resultStr.match(/(?:status|HTTP\/\d)\s*:?\s*(\d{3})/i);
  if (statusMatch) {
    const status = parseInt(statusMatch[1]);
    if (status >= 400) return true;
  }

  // Bot challenge / access denied
  if (lower.includes('access denied') || lower.includes('forbidden') ||
      lower.includes('cloudflare') || lower.includes('enable javascript') ||
      lower.includes('captcha') || lower.includes('checking your browser')) {
    return true;
  }

  // Very thin response (likely SPA or blocked)
  if (rawResult && typeof rawResult === 'object' && rawResult.content) {
    const contentLen = (rawResult.content || '').length;
    if (contentLen < 500 && contentLen > 0) return true;
  }

  return false;
}
