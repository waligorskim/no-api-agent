#!/usr/bin/env node

/**
 * no-api-agent CLI
 *
 * Usage:
 *   no-api-agent <url> [--intent "what you want"] [--max-level 3] [--screenshot] [--json] [--profiles]
 *
 * Examples:
 *   no-api-agent https://example.com/pricing --intent "extract plan names and prices"
 *   no-api-agent https://spa-app.com --max-level 2 --json
 *   no-api-agent --profiles    # Show site profile cache
 */

import { runCascade } from './cascade.mjs';
import { getAllProfiles } from './site-profiles.mjs';

const args = process.argv.slice(2);

// Parse flags
function getFlag(name, hasValue = true) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  if (!hasValue) { args.splice(idx, 1); return true; }
  const val = args[idx + 1];
  args.splice(idx, 2);
  return val;
}

const intent = getFlag('intent') || '';
const maxLevel = parseInt(getFlag('max-level') || '3', 10);
const jsonOutput = getFlag('json', false);
const showProfiles = getFlag('profiles', false);
const screenshot = getFlag('screenshot', false);

// Show profiles
if (showProfiles) {
  const profiles = await getAllProfiles();
  if (Object.keys(profiles).length === 0) {
    console.log('No site profiles cached yet.');
  } else {
    console.log(JSON.stringify(profiles, null, 2));
  }
  process.exit(0);
}

// Get URL (first non-flag argument)
const url = args[0];
if (!url) {
  console.error(`Usage: no-api-agent <url> [--intent "..."] [--max-level N] [--screenshot] [--json]`);
  console.error(`       no-api-agent --profiles`);
  process.exit(1);
}

// Validate URL
try {
  new URL(url);
} catch {
  console.error(`Invalid URL: ${url}`);
  process.exit(1);
}

// Run cascade
console.error(`🔍 Starting cascade for: ${url}`);
if (intent) console.error(`   Intent: ${intent}`);
console.error(`   Max level: ${maxLevel}`);
console.error('');

const result = await runCascade(url, { intent, maxLevel, screenshot });

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  // Human-readable output
  if (result.success) {
    console.error(`✅ Success via Level ${result.level_used} (${result.method}) in ${result.metadata.total_duration_ms}ms`);
    if (result.metadata.page_title) console.error(`   Title: ${result.metadata.page_title}`);
    if (result.metadata.final_url) console.error(`   URL: ${result.metadata.final_url}`);
    console.error(`   Content: ${result.content.byte_size} bytes (${result.content.format})`);
    if (result.content.truncated) console.error(`   ⚠️  Content was truncated to 8KB`);
    console.error('');
    console.log(result.content.data);
  } else {
    console.error(`❌ All levels failed (${result.metadata.total_duration_ms}ms)`);
    console.error('');

    // Show attempt log
    for (const attempt of result.levels_attempted) {
      const status = attempt.error ? '✗' : '✓';
      const skip = attempt.skipped_reason ? ` (skipped: ${attempt.skipped_reason})` : '';
      console.error(`   ${status} L${attempt.level} ${attempt.method} — ${attempt.duration_ms}ms${skip}`);
      if (attempt.error) console.error(`     ${attempt.error}`);
    }

    console.error('');
    if (result.diagnostic) {
      console.error(`   Root cause: ${result.diagnostic.root_cause}`);
      console.error(`   ${result.diagnostic.suggested_action}`);
    }
  }
}

process.exit(result.success ? 0 : 1);
