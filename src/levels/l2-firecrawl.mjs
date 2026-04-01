/**
 * Level 2 — Firecrawl scrape.
 * Handles JS-rendered pages, SPAs, and dynamic content.
 * Uses Firecrawl API (cloud) or CLI (self-hosted).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1';

/**
 * @param {string} url
 * @param {{ apiKey?: string, timeout?: number, formats?: string[] }} options
 * @returns {Promise<{ success: boolean, data?: string, error?: string }>}
 */
export async function execute(url, options = {}) {
  const apiKey = options.apiKey || process.env.FIRECRAWL_API_KEY;
  const timeout = options.timeout || 30000;
  const formats = options.formats || ['markdown'];

  // Try API first (faster, handles more sites), fall back to CLI
  if (apiKey) {
    const result = await scrapeViaApi(url, apiKey, formats, timeout);
    if (result.success) return result;
  }

  // Fallback: try CLI (npx firecrawl)
  return scrapeViaCli(url, timeout);
}

/**
 * Scrape via Firecrawl REST API.
 */
async function scrapeViaApi(url, apiKey, formats, timeout) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${FIRECRAWL_API_URL}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats,
        waitFor: 3000,        // Wait for JS to render
        timeout: 20000,
        removeBase64Images: true,
        blockAds: true,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: `Firecrawl API: HTTP ${response.status} — ${err}` };
    }

    const data = await response.json();

    if (!data.success) {
      return { success: false, error: `Firecrawl: ${data.error || 'unknown error'}` };
    }

    const content = data.data?.markdown || data.data?.html || '';
    if (!content || content.length < 100) {
      return { success: false, error: 'Firecrawl returned minimal content' };
    }

    return {
      success: true,
      data: content,
      page_title: data.data?.metadata?.title,
      final_url: data.data?.metadata?.sourceURL,
    };
  } catch (err) {
    return {
      success: false,
      error: err.name === 'AbortError' ? 'Timeout' : `Firecrawl API: ${err.message}`,
    };
  }
}

/**
 * Scrape via Firecrawl CLI (self-hosted fallback).
 */
async function scrapeViaCli(url, timeout) {
  try {
    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['firecrawl-cli', 'scrape', url, '--format', 'markdown'],
      { timeout, maxBuffer: 1024 * 1024 }
    );

    const output = stdout.trim();
    if (!output || output.length < 100) {
      return { success: false, error: `Firecrawl CLI: thin output (${output.length} bytes)` };
    }

    return { success: true, data: output };
  } catch (err) {
    if (err.code === 'ENOENT' || err.message?.includes('not found')) {
      return { success: false, error: 'Firecrawl CLI not installed (npm i -g firecrawl-cli)' };
    }
    return { success: false, error: `Firecrawl CLI: ${err.message}` };
  }
}

export const LEVEL = 2;
export const METHOD = 'firecrawl';
