/**
 * Level 1 — Brave Search extraction.
 * Uses Brave Search API to find cached/indexed content when direct fetch fails.
 * Falls back to MCP tool hint if no API key available.
 */

const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';

/**
 * @param {string} url
 * @param {string} intent
 * @param {{ apiKey?: string, timeout?: number }} options
 * @returns {Promise<{ success: boolean, data?: string, error?: string, mcp_hint?: string }>}
 */
export async function execute(url, intent = '', options = {}) {
  const apiKey = options.apiKey || process.env.BRAVE_API_KEY;
  const timeout = options.timeout || 10000;

  // If no API key, return MCP hint for Claude to use brave-search MCP
  if (!apiKey) {
    return {
      success: false,
      error: 'No BRAVE_API_KEY — escalate to MCP',
      mcp_hint: buildMcpHint(url, intent),
    };
  }

  try {
    // Build search query: site-specific + intent
    const domain = new URL(url).hostname;
    const path = new URL(url).pathname;
    const query = intent
      ? `site:${domain} ${intent}`
      : `site:${domain} ${path.replace(/[/-]/g, ' ').trim()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const searchUrl = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=5&text_decorations=false`;
    const response = await fetch(searchUrl, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      return { success: false, error: `Brave API: HTTP ${response.status}` };
    }

    const data = await response.json();
    const results = data.web?.results || [];

    if (results.length === 0) {
      return { success: false, error: 'No search results found' };
    }

    // Compile results into markdown
    const markdown = results.map((r, i) => {
      const parts = [`### ${i + 1}. ${r.title}`, `**URL:** ${r.url}`];
      if (r.description) parts.push(r.description);
      if (r.extra_snippets?.length) {
        parts.push('', ...r.extra_snippets);
      }
      return parts.join('\n');
    }).join('\n\n---\n\n');

    return {
      success: true,
      data: markdown,
      result_count: results.length,
    };
  } catch (err) {
    return {
      success: false,
      error: err.name === 'AbortError' ? 'Timeout' : err.message,
    };
  }
}

/**
 * Build a hint for Claude to use the Brave Search MCP tool instead.
 * @param {string} url
 * @param {string} intent
 */
function buildMcpHint(url, intent) {
  const domain = new URL(url).hostname;
  const query = intent ? `site:${domain} ${intent}` : `site:${domain}`;
  return `Use mcp__brave_search__web_search with query: "${query}" count: 5`;
}

export const LEVEL = 1;
export const METHOD = 'brave_search';
