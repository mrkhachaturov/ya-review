# ya-review Design Document

**Date:** 2026-02-24
**Status:** Approved
**Package name:** `ya-review`
**CLI command:** `yarev`
**Location:** `/Users/mrkhachaturov/Developer/ya-metrics/ya-review`

---

## Overview

`ya-review` is a TypeScript npm package + CLI tool that scrapes Yandex Maps business reviews, stores them in a local SQLite database, and provides an AI-agent-friendly query interface. It ports the scraping logic from `ya-reviews-mcp` (Python) into a self-contained Node.js package with no Python dependency.

Primary use cases:
1. Track multiple businesses ("mine" and "competitors") and keep reviews in sync
2. Incremental daily syncs that are fast and lightweight
3. Compare your business(es) against competitors
4. Feed structured review data to AI agents via JSON output

---

## Reference Projects

| Project | Role | Key takeaways |
|---|---|---|
| `ya-reviews-mcp` | Scraper logic source | DOM selectors, pagination strategy, anti-detection, 3 browser backends |
| `hae-vault` | Architectural template | Commander.js CLI, better-sqlite3, raw SQL, tsx/tsc, project structure, JSON output |

---

## Technology Stack

| Component | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict, ESM) | Matches hae-vault |
| Node.js | >= 22.0.0 | Matches hae-vault |
| CLI framework | Commander.js | Matches hae-vault |
| Database | better-sqlite3 (raw SQL, WAL mode) | Matches hae-vault; zero-config, no ORM |
| Browser (default) | Patchright | Anti-detection, same as ya-reviews-mcp default |
| Browser (alt) | Playwright, remote CDP | Full flexibility, same 3 backends as ya-reviews-mcp |
| Scheduler | node-cron | For daemon mode; lightweight |
| Build | tsc | Matches hae-vault |
| Dev | tsx | Matches hae-vault |
| Test | Native Node.js test runner | Matches hae-vault |
| Package manager | npm | Standard distribution |

---

## Project Structure

```
ya-review/
├── src/
│   ├── index.ts                  ← Entry point: load config, run CLI
│   ├── config.ts                 ← Env config singleton
│   │
│   ├── cli/
│   │   ├── index.ts              ← Program registry (all commands)
│   │   ├── init.ts               ← yarev init
│   │   ├── track.ts              ← yarev track <org_id>
│   │   ├── untrack.ts            ← yarev untrack <org_id>
│   │   ├── sync.ts               ← yarev sync
│   │   ├── daemon.ts             ← yarev daemon
│   │   ├── companies.ts          ← yarev companies
│   │   ├── reviews.ts            ← yarev reviews <org_id>
│   │   ├── compare.ts            ← yarev compare --org <id>
│   │   ├── competitor.ts         ← yarev competitor add/rm/list
│   │   ├── query.ts              ← yarev query <sql>
│   │   ├── status.ts             ← yarev status
│   │   └── helpers.ts            ← Shared CLI utilities (output formatting)
│   │
│   ├── db/
│   │   ├── schema.ts             ← openDb(), CREATE TABLE, migrations
│   │   ├── companies.ts          ← upsertCompany(), listCompanies()
│   │   ├── reviews.ts            ← upsertReviews(), queryReviews()
│   │   ├── competitors.ts        ← addCompetitor(), getCompetitors()
│   │   └── sync-log.ts           ← logSync(), getLastSync()
│   │
│   ├── scraper/
│   │   ├── browser.ts            ← Browser lifecycle (Patchright/Playwright/remote CDP)
│   │   ├── reviews.ts            ← scrapeReviews(orgId, opts) — DOM parsing + pagination
│   │   ├── company.ts            ← scrapeCompanyInfo(orgId) — metadata extraction
│   │   └── selectors.ts          ← CSS selectors (ported from ya-reviews-mcp)
│   │
│   └── types/
│       └── index.ts              ← Review, CompanyInfo, SyncResult, etc.
│
├── tests/
│   ├── db/
│   ├── scraper/
│   └── cli/
├── package.json
├── tsconfig.json
├── .env.example
└── docs/
    └── plans/
```

---

## Browser Backends

Three backends, matching ya-reviews-mcp:

| Backend | Default? | Description |
|---|---|---|
| **Patchright** | Yes (default) | Anti-detection Playwright fork. Native navigator.webdriver hiding. |
| **Playwright** | Alt | Standard Playwright. Requires own init script to hide webdriver. |
| **Remote CDP** | Alt | Connect to external browser via WebSocket. No local browser needed. |

### Configuration

```env
BROWSER_BACKEND=patchright          # patchright | playwright | remote
BROWSER_WS_URL=ws://localhost:3000  # For remote backend only
BROWSER_HEADLESS=true               # false for visual debugging
```

CLI override: `yarev sync --backend playwright` or `yarev sync --browser-url ws://...`

### Browser Installation

```bash
yarev init                    # Installs Patchright + Chromium by default
yarev init --backend playwright  # Install Playwright instead
```

---

## SQL Schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Tracked organizations
CREATE TABLE companies (
  id INTEGER PRIMARY KEY,
  org_id TEXT UNIQUE NOT NULL,
  name TEXT,
  rating REAL,
  review_count INTEGER,
  address TEXT,
  categories TEXT,                       -- JSON array string
  role TEXT NOT NULL DEFAULT 'tracked',  -- 'mine' | 'competitor' | 'tracked'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Competitor relationships (many-to-many)
-- Supports multiple "mine" companies, each with own competitors
CREATE TABLE company_relations (
  id INTEGER PRIMARY KEY,
  company_org_id TEXT NOT NULL,          -- the "mine" company
  competitor_org_id TEXT NOT NULL,       -- the competitor
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_org_id, competitor_org_id),
  FOREIGN KEY (company_org_id) REFERENCES companies(org_id),
  FOREIGN KEY (competitor_org_id) REFERENCES companies(org_id)
);

-- Reviews
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  org_id TEXT NOT NULL,
  review_key TEXT UNIQUE NOT NULL,       -- stable dedup key
  author_name TEXT,
  author_icon_url TEXT,
  author_profile_url TEXT,
  date TEXT,                             -- ISO 8601
  text TEXT,
  stars REAL,
  likes INTEGER NOT NULL DEFAULT 0,
  dislikes INTEGER NOT NULL DEFAULT 0,
  review_url TEXT,
  business_response TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES companies(org_id)
);

CREATE INDEX idx_reviews_org_id ON reviews(org_id);
CREATE INDEX idx_reviews_date ON reviews(date);
CREATE INDEX idx_reviews_stars ON reviews(stars);

-- Sync history
CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY,
  org_id TEXT NOT NULL,
  sync_type TEXT NOT NULL,               -- 'full' | 'incremental'
  reviews_added INTEGER NOT NULL DEFAULT 0,
  reviews_updated INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,                  -- 'running' | 'ok' | 'error'
  error_message TEXT,
  FOREIGN KEY (org_id) REFERENCES companies(org_id)
);
```

### Multiple "mine" Companies Example

A user runs a car service (org 111) and a car wash (org 222). Each has its own competitors:

```
companies:
  111  "Auto Pro Service"   role=mine
  222  "Sparkle Wash"       role=mine
  333  "Rival Service A"    role=competitor
  444  "Rival Service B"    role=competitor
  555  "Rival Wash X"       role=competitor

company_relations:
  111 → 333  (Auto Pro's competitor)
  111 → 444  (Auto Pro's competitor)
  222 → 555  (Sparkle Wash's competitor)
```

`yarev compare --org 111` shows Auto Pro vs Rival Service A + B.
`yarev compare --org 222` shows Sparkle Wash vs Rival Wash X.

---

## CLI Commands

### Setup & Tracking

```bash
yarev init                                  # Create DB, install default browser (Patchright)
yarev init --backend playwright             # Use Playwright instead

yarev track <org_id> [--name "My Biz"]      # Add org, auto-scrape full on first track
yarev track <org_id> --role mine            # Mark as "my" company
yarev track <org_id> --role competitor      # Mark as competitor
yarev untrack <org_id>                      # Remove org + its reviews
```

### Syncing

```bash
yarev sync                                  # Incremental sync all tracked orgs
yarev sync --org <org_id>                   # Sync one specific org
yarev sync --full                           # Force full scrape (scroll all pages)
yarev sync --backend playwright             # Override browser for this sync
yarev sync --browser-url ws://localhost:3000 # Use remote browser
```

### Daemon

```bash
yarev daemon                                # Run scheduler (default: daily at 08:00)
yarev daemon --cron "0 8 * * *"             # Custom cron expression
yarev daemon --interval 3600                # Every N seconds (alternative to cron)
```

### Querying

```bash
yarev companies                             # List all tracked companies
yarev companies --role mine                 # Only "mine" companies
yarev reviews <org_id>                      # Recent reviews (default: last 30 days)
yarev reviews <org_id> --since 2025-01-01   # Reviews since date
yarev reviews <org_id> --stars 1-3          # Filter by star range
yarev reviews <org_id> --limit 50           # Limit results
yarev status                                # Last sync times, review counts per org
```

### Competitors

```bash
yarev competitor add --org <mine> --competitor <theirs>
yarev competitor rm --org <mine> --competitor <theirs>
yarev competitor list --org <mine>          # Show competitors for this org
yarev compare --org <mine>                  # Rating, count, avg stars vs competitors
```

### Power User / AI Agent

```bash
yarev query "SELECT * FROM reviews WHERE stars <= 2 ORDER BY date DESC LIMIT 10"
yarev reviews <org_id> --json               # Force JSON output
```

---

## Output Format

- **TTY (human)**: Formatted tables with aligned columns, truncated text
- **Pipe / --json**: JSON output — one JSON object per line (NDJSON), or single JSON array
- **Auto-detect**: If stdout is not a TTY, default to JSON

Example JSON output for `yarev reviews 123 --json`:
```json
[
  {
    "org_id": "123",
    "author_name": "Иван",
    "date": "2025-12-15",
    "stars": 5,
    "text": "Отличный сервис!",
    "likes": 3,
    "dislikes": 0,
    "business_response": "Спасибо!"
  }
]
```

Example JSON output for `yarev compare --org 123 --json`:
```json
{
  "company": {
    "org_id": "123",
    "name": "Auto Pro",
    "rating": 4.8,
    "review_count": 342,
    "avg_stars": 4.7
  },
  "competitors": [
    {
      "org_id": "456",
      "name": "Rival A",
      "rating": 4.2,
      "review_count": 189,
      "avg_stars": 4.0
    }
  ]
}
```

---

## Sync Strategy

### Full Sync (first time or `--full`)

1. Navigate to `https://yandex.ru/maps/org/{org_id}/reviews/`
2. Parse company info from DOM
3. Parse initial reviews (first page, ~50 reviews)
4. Scroll to load more — repeat up to `MAX_PAGES` (default 20, ~1000 reviews)
5. Click "Show organization response" buttons to reveal business replies
6. Upsert all reviews into SQLite keyed by `review_key`
7. Update company metadata in `companies` table
8. Log sync in `sync_log` as type `full`

### Incremental Sync (default)

1. Navigate to reviews page — no scrolling
2. Parse whatever reviews Yandex shows by default (~50)
3. For each review, compute `review_key`:
   - Use `review_url` if available (most stable)
   - Fallback: `sha256(org_id + author_name + date + text_first_100_chars)`
4. INSERT OR REPLACE keyed on `review_key` — new reviews inserted, changed ones updated
5. Update `updated_at` timestamp on modified rows
6. Update company metadata
7. Log sync as type `incremental`

### Configuration

```env
INCREMENTAL_WINDOW_SIZE=50          # Max reviews to fetch in incremental mode
MAX_PAGES=20                        # Max scroll iterations for full sync
REQUEST_DELAY=2.0                   # Delay between scroll loads (seconds)
PAGE_TIMEOUT=30000                  # Page load timeout (ms)
```

---

## Scraper Architecture (ported from ya-reviews-mcp)

### Browser Lifecycle

```typescript
// scraper/browser.ts
async function createBrowser(config: Config): Promise<Browser>
  // Patchright (default): launch with anti-detection
  // Playwright: launch with webdriver-hiding init script
  // Remote: connect_over_cdp(ws_url)

async function createContext(browser: Browser): Promise<BrowserContext>
  // Fresh context per scrape (isolated cookies/state)
  // Viewport: 1280x720, locale: ru-RU
```

### CSS Selectors (ported)

```typescript
// scraper/selectors.ts — direct port from ya-reviews-mcp
const SEL = {
  REVIEW: '.business-reviews-card-view__review',
  AUTHOR_NAME: "[itemprop='name']",
  DATE: "meta[itemprop='datePublished']",
  RATING: "meta[itemprop='ratingValue']",
  TEXT: '.business-review-view__body',
  BIZ_COMMENT_EXPAND: '.business-review-view__comment-expand',
  BIZ_COMMENT_TEXT: '.business-review-comment-content__bubble',
  COMPANY_NAME: 'h1.orgpage-header-view__header',
  COMPANY_RATING: '.business-summary-rating-badge-view__rating',
  COMPANY_REVIEW_COUNT: "meta[itemprop='reviewCount']",
  COMPANY_ADDRESS: "[class*='business-contacts-view__address-link']",
  COMPANY_CATEGORIES: '.business-categories-view__category',
  // ... likes, dislikes, avatar, profile URL
} as const;
```

### Anti-Detection (ported)

- Patchright: native navigator.webdriver hiding (default)
- Playwright: init script to override `navigator.webdriver`
- Launch flags: `--disable-blink-features=AutomationControlled`, `--no-sandbox`
- Custom user-agent (Chrome 120 on macOS)
- Configurable delays between scroll loads

---

## Configuration

All via environment variables (matching hae-vault pattern):

```env
# Database
DB_PATH=~/.yarev/reviews.db         # Default SQLite path

# Browser
BROWSER_BACKEND=patchright           # patchright | playwright | remote
BROWSER_WS_URL=                      # For remote backend
BROWSER_HEADLESS=true
BROWSER_LOCALE=ru-RU

# Scraping
PAGE_TIMEOUT=30000
INTERCEPT_TIMEOUT=15000
REQUEST_DELAY=2.0
MAX_PAGES=20
SCRAPER_RETRIES=3
SCRAPER_RETRY_DELAY=2.0
INCREMENTAL_WINDOW_SIZE=50

# Daemon
DAEMON_CRON=0 8 * * *               # Default: daily at 08:00
```

Loaded via dotenv from `.env` file. CLI flags override env vars.

---

## Error Handling

- Scraping errors: retry with exponential backoff (matches ya-reviews-mcp)
- Page not found: log warning, skip org, continue with next
- Browser crash: restart browser, retry current org
- Sync errors logged to `sync_log` table with `status='error'` and `error_message`
- CLI exits with non-zero code on fatal errors

---

## package.json Shape

```json
{
  "name": "ya-review",
  "version": "0.1.0",
  "type": "module",
  "bin": { "yarev": "dist/index.js" },
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "prepare": "npm run build",
    "test": "tsx --test tests/**/*.test.ts"
  },
  "dependencies": {
    "better-sqlite3": "^12.x",
    "commander": "^12.x",
    "dotenv": "^17.x",
    "node-cron": "^3.x"
  },
  "optionalDependencies": {
    "patchright": "^1.x",
    "playwright": "^1.x"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "tsx": "^4.x",
    "@types/better-sqlite3": "^7.x",
    "@types/node": "^22.x"
  }
}
```

**Patchright is the default but optional** — if the user only wants remote CDP, they don't need a local browser installed. `yarev init` handles installation.

---

## Design Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| Language | TypeScript (no Python dependency) | Self-contained npm package, port scraper to TS |
| Browser default | Patchright | Best anti-detection, matches ya-reviews-mcp recommendation |
| Database | better-sqlite3 raw SQL | Matches hae-vault, zero-config, fast |
| ORM | None | Direct SQL, matches hae-vault pattern |
| Competitor model | Relational (company_relations table) | Supports multiple "mine" companies, each with own competitors |
| Sync strategy | Full initial + incremental daily | Fast morning syncs, reliable dedup via review_key |
| Output | Auto-detect TTY → table, pipe → JSON | AI-friendly by default when consumed programmatically |
| Config | Environment variables + dotenv | Matches hae-vault, simple |
| v1 scope | CLI only (no MCP server) | Keep scope tight; MCP can be added later |
