import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const PROFILE_PATH = join(homedir(), '.claude', 'web-access-profiles.json');
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** @typedef {{ minimum_level: number, reason: string, last_success: string, last_attempt: string }} SiteProfile */

/** @type {Map<string, SiteProfile>} */
let cache = null;

/** Load profiles from disk. */
async function load() {
  if (cache) return cache;
  try {
    const raw = await readFile(PROFILE_PATH, 'utf-8');
    const obj = JSON.parse(raw);
    cache = new Map(Object.entries(obj));
  } catch {
    cache = new Map();
  }
  return cache;
}

/** Persist profiles to disk. */
async function save() {
  if (!cache) return;
  const obj = Object.fromEntries(cache);
  await mkdir(dirname(PROFILE_PATH), { recursive: true });
  await writeFile(PROFILE_PATH, JSON.stringify(obj, null, 2));
}

/**
 * Extract domain from URL.
 * @param {string} url
 */
function domain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Get the recommended minimum cascade level for a URL.
 * Returns 0 if unknown or stale.
 * @param {string} url
 * @returns {Promise<{ level: number, reason: string } | null>}
 */
export async function getProfile(url) {
  const profiles = await load();
  const d = domain(url);
  const profile = profiles.get(d);
  if (!profile) return null;

  // Check TTL
  const age = Date.now() - new Date(profile.last_attempt).getTime();
  if (age > TTL_MS) {
    profiles.delete(d);
    await save();
    return null;
  }

  return { level: profile.minimum_level, reason: profile.reason };
}

/**
 * Record a successful access method for a domain.
 * @param {string} url
 * @param {number} level
 * @param {string} method
 * @param {string} reason
 */
export async function recordSuccess(url, level, method, reason = '') {
  const profiles = await load();
  const d = domain(url);
  const existing = profiles.get(d);

  profiles.set(d, {
    minimum_level: level,
    reason: reason || `succeeded with ${method}`,
    last_success: method,
    last_attempt: new Date().toISOString(),
  });

  await save();
}

/**
 * Record a failure — bump minimum level if needed.
 * @param {string} url
 * @param {number} failedLevel
 * @param {string} reason
 */
export async function recordFailure(url, failedLevel, reason = '') {
  const profiles = await load();
  const d = domain(url);
  const existing = profiles.get(d);
  const currentMin = existing?.minimum_level ?? 0;

  if (failedLevel >= currentMin) {
    profiles.set(d, {
      minimum_level: failedLevel + 1,
      reason: reason || `level ${failedLevel} failed`,
      last_success: existing?.last_success ?? 'none',
      last_attempt: new Date().toISOString(),
    });
    await save();
  }
}

/**
 * Get all profiles (for diagnostics).
 * @returns {Promise<Record<string, SiteProfile>>}
 */
export async function getAllProfiles() {
  const profiles = await load();
  return Object.fromEntries(profiles);
}
