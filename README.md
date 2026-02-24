# ya-review (`yarev`)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)

**English** | [Русский](README.ru.md)

CLI tool for scraping, storing, and querying Yandex Maps business reviews with AI-powered topic analysis.

Track your business reviews and competitors, store them in SQLite, classify by topic using OpenAI embeddings, and score quality across dimensions. Designed for AI-friendly output (JSON by default when piped).

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
yarev track <org_id> --role mine --name "My Business"

# Track a competitor
yarev track <competitor_id> --role competitor --name "Rival Corp"
yarev competitor add --org <org_id> --competitor <competitor_id>

# Scrape reviews (first run = full, subsequent = incremental)
yarev sync --org <org_id> --full
yarev sync  # sync all tracked companies

# Get a quick overview
yarev stats <org_id>

# Analyze reviews
yarev digest <org_id> --stars 1-3 --limit 10    # compact negative reviews
yarev search "дорого"                               # text search across all orgs
yarev trends <org_id>                             # monthly review volume
yarev unanswered <org_id> --stars 1-3             # need response urgently

# Compare with competitors
yarev compare --org <org_id>

# AI topic analysis (requires YAREV_OPENAI_API_KEY)
yarev apply                                      # sync config.yaml → DB
yarev embed <org_id>                             # generate embeddings
yarev classify <org_id>                          # assign reviews to topics
yarev topics <org_id>                            # topic breakdown with stats
yarev score <org_id>                             # AI quality score per topic
yarev score --compare org1,org2                  # side-by-side comparison
yarev similar --text "долго ждать"               # semantic similarity search

# Full review data & raw SQL
yarev reviews <org_id> --stars 1-3 --since 2025-01-01
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

### AI & Embeddings

Requires `YAREV_OPENAI_API_KEY` and a `config.yaml` with topic definitions. See [config.example.yaml](config.example.yaml) ([на русском](config.example.ru.yaml)).

| Command | Description |
|---------|-------------|
| `apply` | Sync YAML config to database (companies, topics, relations) |
| `embed <org_id>` | Generate OpenAI embeddings for reviews and topic labels |
| `classify <org_id>` | Assign reviews to topics by embedding similarity |
| `topics <org_id>` | Show topic hierarchy with review counts and avg stars |
| `similar` | Find semantically similar reviews (`--text` or `--review`) |
| `score <org_id>` | AI quality score per topic (`--full`, `--compare`, `--refresh`) |

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
| `YAREV_OPENAI_API_KEY` | — | OpenAI API key (required for embeddings) |
| `YAREV_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `YAREV_CONFIG` | `~/.yarev/config.yaml` | Path to YAML config |

See [.env.example](.env.example) for all options.

## Development

```bash
npm run dev -- --help    # run via tsx
npm test                 # run tests
npm run build            # compile to dist/
```

## License

[MIT](LICENSE)
