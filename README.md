# ya-review (`yarev`)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)

CLI tool for scraping, storing, and querying Yandex Maps business reviews.

Track your business reviews and competitors, store them in SQLite, and query with filters or raw SQL. Designed for AI-friendly output (JSON by default when piped).

## Requirements

- Node.js >= 22
- One of: [Patchright](https://github.com/nicedayfor/patchright) (default), Playwright, or a remote CDP browser

## Install

```bash
npm install
yarev init  # creates database + installs browser
```

## Quick Start

```bash
# Track your business
yarev track 1248139252 --role mine --name "My Business"

# Track a competitor
yarev track 9876543210 --role competitor --name "Rival Corp"
yarev competitor add --org 1248139252 --competitor 9876543210

# Scrape reviews (first run = full, subsequent = incremental)
yarev sync --org 1248139252 --full
yarev sync  # sync all tracked companies

# Get a quick overview
yarev stats 1248139252

# Analyze reviews
yarev digest 1248139252 --stars 1-3 --limit 10    # compact negative reviews
yarev search "дорого"                               # text search across all orgs
yarev trends 1248139252                             # monthly review volume
yarev unanswered 1248139252 --stars 1-3             # need response urgently

# Compare with competitors
yarev compare --org 1248139252

# Full review data & raw SQL
yarev reviews 1248139252 --stars 1-3 --since 2025-01-01
yarev query "SELECT COUNT(*) as cnt FROM reviews WHERE stars >= 4"
```

## Commands

### Setup & Tracking

| Command | Description |
|---------|-------------|
| `init` | Initialize database and install browser |
| `track <org_id>` | Start tracking an organization (`--role mine\|competitor`) |
| `untrack <org_id>` | Stop tracking and remove data |
| `companies` | List tracked companies |
| `competitor add\|rm\|list` | Manage competitor relationships |

### Scraping

| Command | Description |
|---------|-------------|
| `sync` | Scrape reviews for tracked orgs (`--org`, `--full`) |
| `status` | Show sync status for all companies |
| `daemon` | Scheduled sync via cron (`--cron`) |

### Querying & Analysis

| Command | Description |
|---------|-------------|
| `reviews <org_id>` | Full review data (`--since`, `--stars`, `--limit`) |
| `stats <org_id>` | Star distribution, response rate, averages |
| `digest <org_id>` | Compact listing for AI — date/stars/text only |
| `search <text>` | Full-text search across all reviews (`--org`) |
| `trends <org_id>` | Review count & avg rating by month/week/quarter |
| `unanswered <org_id>` | Reviews without business response |
| `compare --org <id>` | Side-by-side comparison vs competitors |
| `query <sql>` | Run raw SQL (returns JSON) |

## Output

All commands support `--json` flag. When stdout is not a TTY (piped), JSON is used automatically — making it easy to integrate with AI tools or scripts.

## Configuration

Environment variables (or `.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `YAREV_DB_URL` | — | PostgreSQL connection string (if set, uses PG) |
| `YAREV_DB_PATH` | `~/.yarev/reviews.db` | SQLite database path |
| `BROWSER_BACKEND` | `patchright` | `patchright`, `playwright`, or `remote` |
| `BROWSER_WS_URL` | — | WebSocket URL for remote browser |
| `BROWSER_HEADLESS` | `true` | Run browser headless |
| `MAX_PAGES` | `20` | Max scroll pages during full sync |
| `DAEMON_CRON` | `0 8 * * *` | Cron schedule for daemon mode |

See [.env.example](.env.example) for all options.

## Development

```bash
npm run dev -- --help    # run via tsx
npm test                 # run tests
npm run build            # compile to dist/
```

## License

[MIT](LICENSE)
