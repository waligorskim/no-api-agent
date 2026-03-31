# "No API? No Problem!" — Resilient Web Access Agent

> **Spec v1.0** — March 31, 2026
> Author: Claude (decisions based on Mateusz's profile & tooling)

---

## 1. Problem Statement

Claude Code frequently attempts `WebFetch` or `mcp__fetch` calls that fail due to:
- No API exists for the target service
- API requires auth tokens we don't have
- API is rate-limited, geo-blocked, or returns 403/401
- Target is a JS-rendered SPA that returns empty HTML to fetch
- Site has aggressive bot protection (Cloudflare, Akamai, etc.)

**Current behavior**: Claude retries the same failing method 3-5 times, wastes context window, then gives up or asks the user to manually copy-paste content.

**Desired behavior**: Automatic fallback cascade through progressively more capable (and heavier) web access methods until data is retrieved.

---

## 2. Design Decisions (Pre-Made)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Claude Code hook + standalone CLI | Hook auto-triggers on fetch failure; CLI for manual/scheduled use |
| Headless vs visual | Both — headless first, visual fallback | You already have browser-tools MCP + puppeteer MCP connected |
| Target scale | Unknown/dynamic sites | The whole point is handling the unexpected |
| Scheduling | On-demand primary, cron secondary | Matches your workflow — you hit problems ad-hoc |
| Auth handling | Full cascade: stored creds → session cookies → manual pause | You're pragmatic about auth (PoE2 doc shows multi-method thinking) |
| External services | Free/self-hosted first, paid as last resort | Cost-conscious (Displate budget analysis instinct) |
| Output format | Structured JSON when possible, clean markdown fallback | Needs to feed back into Claude's context |
| Failure mode | Diagnostic report + interactive ask | You want to stay in the loop |

---

## 3. Fallback Cascade Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    TRIGGER LAYER                         │
│  Hook detects: WebFetch/mcp__fetch failure (4xx, 5xx,   │
│  empty body, JS-rendered, timeout, CORS, bot-blocked)   │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│              ANTI-ANNOYANCE LAYER (always active)        │
│  Applied to ALL methods below — see §5                  │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─ LEVEL 0 ──── Smart Retry (0-3 seconds) ───────────────┐
│  • Retry with different User-Agent (rotate pool)        │
│  • Add Accept-Language, Referer headers                 │
│  • Try with/without cookies                             │
│  • Try HTTP/2 vs HTTP/1.1                               │
│  • If Cloudflare: detect challenge page, skip to L2     │
│  Tool: mcp__fetch (with modified headers)               │
└──────────────────────┬──────────────────────────────────┘
                       ▼ FAIL
┌─ LEVEL 1 ──── Brave Search Extraction (3-8 sec) ───────┐
│  • Query Brave Search for the specific content          │
│  • Extract answer snippets, cached page content         │
│  • Use Brave's "goggles" for site-specific results      │
│  • Often sufficient for public data, news, docs         │
│  Tool: brave-search-mcp-server                          │
│  Cost: Free (2000 queries/mo) or $5/mo                  │
└──────────────────────┬──────────────────────────────────┘
                       ▼ FAIL / INSUFFICIENT
┌─ LEVEL 2 ──── Firecrawl Scrape (5-15 sec) ─────────────┐
│  • Full page scrape with JS rendering                   │
│  • Handles SPAs, dynamic content, infinite scroll       │
│  • Returns clean markdown or structured data            │
│  • Built-in proxy rotation and anti-bot handling        │
│  • Supports /crawl for multi-page, /map for sitemaps    │
│  Tool: firecrawl CLI / SDK                              │
│  Cost: Free tier (500 credits/mo) or $19/mo             │
│  Fallback: self-hosted with `npx firecrawl-cli`         │
└──────────────────────┬──────────────────────────────────┘
                       ▼ FAIL
┌─ LEVEL 3 ──── Headless Puppeteer (10-30 sec) ──────────┐
│  • Full Chrome via puppeteer MCP (already connected)    │
│  • Custom navigation scripts per-site                   │
│  • Can handle login flows with stored credentials       │
│  • Screenshot + DOM extraction                          │
│  • Stealth mode (puppeteer-extra-plugin-stealth)        │
│  Tool: mcp__puppeteer__*                                │
│  Cost: Free (local Chrome)                              │
└──────────────────────┬──────────────────────────────────┘
                       ▼ FAIL
┌─ LEVEL 4 ──── Browser-Tools MCP / Live Browser (15-45s)─┐
│  • Uses YOUR actual browser session                     │
│  • Has real cookies, extensions, logged-in state        │
│  • Can read console, network, DOM from real page        │
│  • Best for sites requiring your authenticated session  │
│  Tool: mcp__browser-tools__*                            │
│  Cost: Free (your Chrome + extension)                   │
│  Requires: Chrome extension + BrowserTools server       │
└──────────────────────┬──────────────────────────────────┘
                       ▼ FAIL
┌─ LEVEL 5 ──── Alumnium AI Browser Agent (30-120 sec) ──┐
│  • AI-driven browser automation                         │
│  • Natural language navigation ("find the pricing page  │
│    and extract all plan details")                       │
│  • Handles CAPTCHAs, complex JS, dynamic layouts        │
│  • Vision-based — doesn't rely on DOM selectors         │
│  • WebVoyager benchmark: human-like browsing accuracy   │
│  Tool: alumnium SDK                                     │
│  Cost: Free (open-source, local)                        │
└──────────────────────┬──────────────────────────────────┘
                       ▼ FAIL
┌─ LEVEL 6 ──── Computer Use / Full Vision (60-180 sec) ──┐
│  • Claude computer_use tool or similar                  │
│  • Screenshot → reason → click → screenshot loop        │
│  • Last resort — slowest but handles anything visible   │
│  • Can solve CAPTCHAs, navigate unknown UIs             │
│  Tool: Anthropic computer_use API / browser-use         │
│  Cost: API tokens (expensive per-run)                   │
└──────────────────────┬──────────────────────────────────┘
                       ▼ ALL FAILED
┌─ DIAGNOSTIC REPORT ─────────────────────────────────────┐
│  • What was attempted at each level                     │
│  • HTTP status codes, error messages, screenshots       │
│  • Likely root cause classification:                    │
│    - Bot protection (which type?)                       │
│    - Auth required (what kind?)                         │
│    - Content doesn't exist                              │
│    - Geographic restriction                             │
│  • Suggested manual workaround                          │
│  → Interactive: ask user how to proceed                 │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Cascade Logic — Decision Engine

The cascade is NOT always linear. The engine should **skip levels** based on early signals:

```
SIGNAL                              → SKIP TO
─────────────────────────────────────────────────
HTTP 403 + "Cloudflare"             → L2 (Firecrawl) or L3 (Puppeteer stealth)
HTTP 401 / 403 + login form         → L4 (Browser-Tools, has your session)
Empty HTML body (<1KB)              → L2 (Firecrawl, JS rendering)
HTTP 200 but content is paywall     → L1 (Brave cached) or L4 (if subscribed)
CAPTCHA detected                    → L5 (Alumnium) or L6 (Computer Use)
Site known to be API-friendly       → Stay at L0, try harder with headers
Site is a known SPA framework       → L2 (Firecrawl) minimum
Target requires multi-page nav      → L3+ (needs stateful browsing)
```

### Site Profile Cache

Maintain a local JSON cache (`~/.claude/web-access-profiles.json`) that remembers:
```json
{
  "linkedin.com": {
    "minimum_level": 4,
    "reason": "aggressive bot detection, requires auth session",
    "last_success": "L4_browser_tools",
    "last_attempt": "2026-03-31"
  },
  "docs.python.org": {
    "minimum_level": 0,
    "reason": "static site, no protection",
    "last_success": "L0_fetch",
    "last_attempt": "2026-03-31"
  }
}
```

This prevents wasting time retrying methods that are known to fail for specific domains.

---

## 5. Anti-Annoyance Layer (AAL)

Applied **universally** across all levels that control a browser (L3–L6):

### 5.1 Cookie Consent Handling
```
STRATEGY: Dismiss All
- Detect common cookie consent frameworks:
  - OneTrust, CookieBot, TrustArc, Didomi, Quantcast
  - Generic: elements with text matching /accept|agree|got it|ok|consent/i
- Action sequence:
  1. Wait 500ms after page load for consent banners to render
  2. Try clicking "Reject All" / "Necessary Only" first (less tracking)
  3. Fallback: click "Accept All" to dismiss
  4. If no button found: inject CSS `[class*="cookie"], [id*="cookie"],
     [class*="consent"], [class*="gdpr"] { display: none !important; }`
  5. Set common opt-out cookies preemptively:
     - `OptanonAlertBoxClosed=<timestamp>`
     - `CookieConsent=necessary`
```

### 5.2 Popup/Modal Suppression
```
STRATEGY: Kill on Sight
- Newsletter signup modals → close or hide
- "Download our app" banners → close
- Chat widgets (Intercom, Drift, Zendesk) → minimize/hide
- Notification permission requests → browser set to "deny" by default
- Push notification prompts → auto-deny via browser preferences
- "Sign up to continue reading" → try removing overlay via DOM manipulation
- Login walls → if can't bypass, escalate to next cascade level
- Implementation:
  1. MutationObserver watching for new overlays/modals
  2. CSS injection: `[class*="modal-overlay"], [class*="popup"],
     [role="dialog"]:not([aria-label*="essential"]) { display: none !important; }`
  3. Remove `overflow: hidden` from body when modals are hidden
```

### 5.3 Ad/Tracker Blocking
```
STRATEGY: Block at Network Level
- For Puppeteer (L3): Use request interception
  - Block requests matching ad/tracker domains (EasyList-derived)
  - Block: googlesyndication, doubleclick, facebook pixel, hotjar,
    analytics.js, gtag, segment, mixpanel
  - Allow: first-party resources, CDN assets, API calls
- For Browser-Tools (L4): Rely on user's installed extensions
  (uBlock Origin, Ghostery — recommend installation)
- For Alumnium/Computer Use (L5-L6): Pre-configure browser profile
  with extensions installed
```

### 5.4 Performance Optimizations
```
STRATEGY: Strip Non-Essential Resources
- Disable image loading when only text content needed
  (puppeteer: page.setRequestInterception → abort image/media)
- Disable CSS loading when only extracting data
  (optional, can break layout-dependent extraction)
- Disable web fonts (saves 200-500ms per page)
- Set viewport to 1920x1080 (avoid mobile layouts with less content)
- Disable animations: `*, *::before, *::after { animation: none !important;
  transition: none !important; }`
- Set navigator.webdriver = false (stealth)
- Randomize viewport slightly (±50px) to avoid fingerprinting
```

### 5.5 Stability Patterns
```
STRATEGY: Don't Break on Unexpected State
- Always wait for networkidle0 OR 10s timeout (whichever first)
- Retry element clicks 3x with 500ms backoff (elements may shift)
- Handle "are you a robot?" interstitials:
  1. Wait 5s (some are timed delays, not real CAPTCHAs)
  2. If persists, escalate to next cascade level
- Handle infinite scroll: scroll 3 viewport-heights max, then stop
- Handle pagination: follow "next" links up to 10 pages max
- Handle iframes: switch context when target content is in iframe
- Timeout per level: enforce wallclock limit, don't let any level hang
```

---

## 6. Claude Code Integration

### 6.1 Hook: Auto-Trigger on Fetch Failure

**File**: `~/.claude/hooks/web-access-fallback.mjs`

**Trigger**: `PostToolUse` — fires after any tool execution

**Logic**:
```
IF tool_name IN (WebFetch, mcp__fetch__fetch) AND result contains:
  - HTTP 4xx or 5xx status
  - "ECONNREFUSED" or "ETIMEDOUT"
  - Empty/minimal body (<500 chars of actual content)
  - "Enable JavaScript" / "browser check" in body
  - "Access Denied" / "Forbidden" in body
THEN:
  1. Extract target URL and intent from context
  2. Check site profile cache for known minimum level
  3. Inject assistant-turn message:
     "WebFetch failed for {url}. Initiating fallback cascade from Level {N}.
      Reason: {classification}. Attempting {method}..."
  4. Execute next appropriate cascade level
  5. Return extracted content as additionalContext
```

### 6.2 Skill: Manual Invocation

**Invocation**: `/scrape <url> [intent]`

**Examples**:
```
/scrape https://linkedin.com/company/displate "get employee count and recent posts"
/scrape https://competitor.com/pricing "extract all plan names and prices"
/scrape https://internal-dashboard.example.com/metrics "get Q1 2026 KPIs"
```

### 6.3 Permissions Required

```json
// ~/.claude/settings.json — additions needed
{
  "permissions": {
    "allow": [
      // Brave Search MCP
      "mcp__brave_search__*",
      // Puppeteer MCP (already available)
      "mcp__puppeteer__*",
      // Browser Tools MCP (already available)
      "mcp__browser-tools__*",
      // Bash commands for Firecrawl CLI
      "Bash(npx firecrawl*)",
      "Bash(npx @anthropic-ai/computer-use*)",
      // Local file access for site profiles cache
      "Read(~/.claude/web-access-profiles.json)",
      "Write(~/.claude/web-access-profiles.json)"
    ]
  }
}
```

### 6.4 Hook Configuration

```json
// ~/.claude/hooks/hooks.json — additions
{
  "PostToolUse": [
    {
      "matcher": "WebFetch|mcp__fetch__fetch",
      "hooks": [
        {
          "type": "command",
          "command": "node ~/.claude/hooks/web-access-fallback.mjs",
          "timeout": 180000
        }
      ]
    }
  ]
}
```

---

## 7. Required Installations & Setup

### 7.1 MCP Servers

| Server | Purpose | Install |
|--------|---------|---------|
| brave-search-mcp | L1 — search extraction | `npx @anthropic-ai/brave-search-mcp` + `BRAVE_API_KEY` |
| puppeteer MCP | L3 — headless browser | Already connected ✓ |
| browser-tools MCP | L4 — live browser | Already connected ✓ |

### 7.2 NPM Packages (Global)

```bash
npm i -g firecrawl-cli          # L2 — JS-rendered scraping
npm i -g alumnium               # L5 — AI browser agent
npm i -g puppeteer-extra         # L3 — stealth plugin support
npm i -g puppeteer-extra-plugin-stealth
```

### 7.3 Browser Extensions (for L4 — Browser-Tools)

Recommended for your Chrome profile:
- **uBlock Origin** — ad/tracker blocking
- **Cookie AutoDelete** — auto-clear cookies post-session
- **Don't F*** With Paste** — bypass paste-disabled fields

### 7.4 Environment Variables

```bash
# ~/.claude/.env or shell profile
BRAVE_API_KEY=...                 # Free at https://brave.com/search/api/
FIRECRAWL_API_KEY=...             # Free tier at https://firecrawl.dev
ALUMNIUM_BROWSER=chromium         # or chrome
```

---

## 8. Output Contract

Every cascade execution returns a standardized result:

```typescript
interface WebAccessResult {
  success: boolean;
  url: string;
  intent: string;                    // what we were trying to get
  level_used: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  method: string;                    // e.g., "firecrawl_scrape"
  levels_attempted: {
    level: number;
    method: string;
    duration_ms: number;
    error?: string;
    skipped_reason?: string;         // e.g., "site profile says min L4"
  }[];
  content: {
    format: "json" | "markdown" | "html" | "screenshot";
    data: string;                    // the actual content
    truncated: boolean;              // if content was too large
    byte_size: number;
  };
  metadata: {
    total_duration_ms: number;
    page_title?: string;
    final_url?: string;              // after redirects
    screenshots?: string[];          // file paths to screenshots taken
  };
  diagnostic?: {                     // only if success === false
    root_cause: "bot_protection" | "auth_required" | "content_missing"
                | "geo_blocked" | "rate_limited" | "unknown";
    details: string;
    suggested_action: string;
  };
}
```

---

## 9. Known Hard Problems & Mitigations

| Problem | Impact | Mitigation |
|---------|--------|------------|
| CAPTCHAs (reCAPTCHA v3, hCaptcha) | Blocks L2-L4 entirely | L5/L6 can solve visually; or escalate to user |
| Login-walled content | Common on LinkedIn, Glassdoor, etc. | L4 uses your real session; for others, store creds in env vars |
| Rate limiting across levels | Burning through free tiers | Site profile cache prevents retrying known-failing methods |
| Context window bloat | Large pages eat Claude's context | Truncate to 8KB max, extract only relevant sections |
| Flaky selectors | DOM changes break extraction | Prefer text-based/semantic extraction over CSS selectors; Alumnium uses vision |
| Cost escalation at L5/L6 | API tokens add up | Budget cap per-run (configurable, default $0.50) |
| Legal/ToS concerns | Scraping may violate site ToS | Respect robots.txt at L0-L2; user accepts risk at L3+ |
| Stale site profiles | Cache says "needs L4" but site changed | TTL on cache entries (7 days), periodic re-verify |

---

## 10. Implementation Phases

### Phase 1 — Core Cascade (Week 1)
- [ ] Implement L0 (smart retry with header rotation)
- [ ] Integrate Brave Search MCP as L1
- [ ] Set up Firecrawl CLI as L2
- [ ] Wire Puppeteer MCP as L3 with stealth plugin
- [ ] Build Anti-Annoyance Layer for L3
- [ ] Create site profile cache
- [ ] Build standardized output contract

### Phase 2 — Claude Code Integration (Week 2)
- [ ] Build PostToolUse hook for auto-trigger
- [ ] Implement cascade decision engine (skip logic)
- [ ] Create `/scrape` skill
- [ ] Configure permissions in settings.json
- [ ] Build diagnostic report generator

### Phase 3 — Advanced Fallbacks (Week 3)
- [ ] Integrate Browser-Tools MCP as L4
- [ ] Set up Alumnium as L5
- [ ] Integrate computer_use / browser-use as L6
- [ ] Extend AAL to L4-L6
- [ ] Add budget cap enforcement

### Phase 4 — Polish (Week 4)
- [ ] Site profile learning (auto-update after successes/failures)
- [ ] Content extraction quality scoring
- [ ] Scheduled scrape support (cron integration)
- [ ] Monitoring dashboard (optional)

---

## 11. Example Scenarios

### Scenario A: Fetch competitor pricing
```
User asks: "What are Displate's competitor prices?"
Claude tries: WebFetch("https://competitor.com/pricing") → 200 OK but empty body (SPA)
Hook triggers → L0 skip (already got 200) → L2 Firecrawl scrape
Firecrawl renders JS → returns clean markdown with pricing table
Claude receives structured pricing data, continues analysis
Total time: ~8 seconds
```

### Scenario B: Pull LinkedIn company data
```
User asks: "How many employees does Company X have on LinkedIn?"
Claude tries: WebFetch("https://linkedin.com/company/x") → 403 (bot blocked)
Hook triggers → Site profile says min L4 for linkedin.com
Skip to L4 → Browser-Tools reads from user's logged-in Chrome session
Returns company page data
Total time: ~15 seconds
```

### Scenario C: Extract data from internal dashboard
```
User asks: "Get this month's metrics from internal-dashboard.example.com"
Claude tries: WebFetch → ECONNREFUSED (VPN/internal only)
Hook triggers → L0 fails → L1 fails (not indexed) → L2 fails (can't reach)
→ L3 fails (can't reach) → L4 Browser-Tools (user has VPN + session)
Returns dashboard data
Total time: ~25 seconds
```

---

*This spec is ready for your review. Say "go" and I'll start building Phase 1.*
