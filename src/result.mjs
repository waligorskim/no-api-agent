/**
 * Standardized output contract for all cascade levels.
 *
 * @typedef {'json' | 'markdown' | 'html' | 'screenshot'} ContentFormat
 *
 * @typedef {Object} LevelAttempt
 * @property {number} level
 * @property {string} method
 * @property {number} duration_ms
 * @property {string} [error]
 * @property {string} [skipped_reason]
 *
 * @typedef {'bot_protection' | 'auth_required' | 'content_missing' | 'geo_blocked' | 'rate_limited' | 'unknown'} RootCause
 *
 * @typedef {Object} Diagnostic
 * @property {RootCause} root_cause
 * @property {string} details
 * @property {string} suggested_action
 *
 * @typedef {Object} WebAccessResult
 * @property {boolean} success
 * @property {string} url
 * @property {string} intent
 * @property {number} level_used
 * @property {string} method
 * @property {LevelAttempt[]} levels_attempted
 * @property {{ format: ContentFormat, data: string, truncated: boolean, byte_size: number }} content
 * @property {{ total_duration_ms: number, page_title?: string, final_url?: string, screenshots?: string[] }} metadata
 * @property {Diagnostic} [diagnostic]
 */

/**
 * @param {Partial<WebAccessResult>} overrides
 * @returns {WebAccessResult}
 */
export function createResult(overrides = {}) {
  return {
    success: false,
    url: '',
    intent: '',
    level_used: -1,
    method: '',
    levels_attempted: [],
    content: { format: 'markdown', data: '', truncated: false, byte_size: 0 },
    metadata: { total_duration_ms: 0 },
    ...overrides,
  };
}

/**
 * @param {string} data
 * @param {ContentFormat} format
 * @param {number} maxBytes
 */
export function packContent(data, format = 'markdown', maxBytes = 8192) {
  const truncated = Buffer.byteLength(data) > maxBytes;
  const trimmed = truncated ? data.slice(0, maxBytes) + '\n\n[...truncated]' : data;
  return {
    format,
    data: trimmed,
    truncated,
    byte_size: Buffer.byteLength(trimmed),
  };
}

/**
 * Classify a fetch failure into a root cause.
 * @param {number} status
 * @param {string} body
 * @param {string} [errorMessage]
 * @returns {RootCause}
 */
export function classifyFailure(status, body = '', errorMessage = '') {
  const text = (body + ' ' + errorMessage).toLowerCase();

  if (text.includes('captcha') || text.includes('challenge') || text.includes('cloudflare'))
    return 'bot_protection';
  if (status === 401 || status === 403 || text.includes('login') || text.includes('sign in'))
    return 'auth_required';
  if (status === 404 || status === 410)
    return 'content_missing';
  if (text.includes('geo') || text.includes('not available in your') || text.includes('region'))
    return 'geo_blocked';
  if (status === 429 || text.includes('rate limit') || text.includes('too many requests'))
    return 'rate_limited';
  return 'unknown';
}
