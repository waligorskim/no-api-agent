/**
 * no-api-agent — main module export.
 * Use programmatically or import into hooks.
 */

export { runCascade } from './cascade.mjs';
export { createResult, packContent, classifyFailure } from './result.mjs';
export { getProfile, recordSuccess, recordFailure, getAllProfiles } from './site-profiles.mjs';
export { getAntiAnnoyanceScripts, AD_BLOCK_DOMAINS, OPT_OUT_COOKIES, setOptOutCookies } from './anti-annoyance.mjs';
