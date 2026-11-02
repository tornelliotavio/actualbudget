# @actual-app/mcp-server

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant read
and manage an Actual budget: categorize transactions, maintain rules, reconcile
schedules, run bank sync and report on spending. It talks to a sync server
through `@actual-app/api`, built from the same commit, so it always understands
the budget's schema.

It serves Streamable HTTP at `/mcp` and is its own OAuth 2.1 authorization
server (dynamic client registration, PKCE, refresh tokens), so it can be added
as a custom connector in claude.ai (which also makes it available in the Claude
mobile and desktop apps), in Claude Code, or as a custom MCP app in ChatGPT.
Signing in asks for a single password on a page this server renders.

## Configuration

| Variable                    | Required | Description                                                                                                                                                                           |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTUAL_SERVER_URL`         | yes      | Sync server URL.                                                                                                                                                                      |
| `ACTUAL_PASSWORD`           | yes      | Sync server password.                                                                                                                                                                 |
| `ACTUAL_SYNC_ID`            |          | Budget sync ID. Optional when the server holds exactly one budget.                                                                                                                    |
| `MCP_PUBLIC_URL`            | prod     | Public base URL, used as the OAuth issuer. Defaults to `http://localhost:$PORT`.                                                                                                      |
| `MCP_AUTH_PASSWORD`         |          | Password for the sign-in page. Defaults to `ACTUAL_PASSWORD`.                                                                                                                         |
| `MCP_ALLOWED_REDIRECT_URIS` |          | Comma-separated OAuth redirect URIs clients may register; an entry ending in `/*` matches that path prefix. Defaults to the Claude and ChatGPT callbacks; loopback is always allowed. |
| `MCP_DATA_DIR`              |          | Budget cache, backups, audit log and OAuth state. Defaults to `./data`; `/data` in the Docker image.                                                                                  |
| `PORT`                      |          | Defaults to `5007`.                                                                                                                                                                   |
| `MCP_SYNC_TTL_SECONDS`      |          | How long reads reuse the local copy before syncing. Defaults to `30`.                                                                                                                 |
| `MCP_DAILY_JOB`             |          | Daily backup plus bank sync. Defaults to `true`.                                                                                                                                      |
| `MCP_DAILY_JOB_HOUR`        |          | Local hour it runs at (set `TZ`). Defaults to `6`.                                                                                                                                    |
| `MCP_DAILY_BANK_SYNC`       |          | Include bank sync in the daily job. Defaults to `true`.                                                                                                                               |
| `MCP_BACKUP_RETENTION`      |          | Backups kept. Defaults to `14`.                                                                                                                                                       |
| `SMTP_HOST`                 |          | SMTP server for `send_daily_report`. Takes precedence over Resend.                                                                                                                    |
| `SMTP_PORT`                 |          | Defaults to `465` (implicit TLS); any other port must offer STARTTLS.                                                                                                                 |
| `SMTP_USER`                 | SMTP     | Mailbox to log in with. Also the default sender.                                                                                                                                      |
| `SMTP_PASSWORD`             | SMTP     | Its password.                                                                                                                                                                         |
| `RESEND_API_KEY`            |          | [Resend](https://resend.com) key, used when `SMTP_HOST` is unset.                                                                                                                     |
| `REPORT_EMAIL_TO`           | email    | Comma-separated recipients of the report. Fixed here so that no tool call can send the budget anywhere else. Without it, the tool reports that email is not configured.               |
| `REPORT_EMAIL_FROM`         |          | Sender. Defaults to `SMTP_USER`, or to `Actual <onboarding@resend.dev>` with Resend, which only reaches the Resend account's own address.                                             |
| `REPORT_IGNORED_CATEGORIES` |          | Comma-separated categories the report treats as neither spending nor income. Defaults to `Movimentações internas,Starting Balances`.                                                  |

## Daily report

`send_daily_report` builds a PDF and emails it over SMTP or, without
`SMTP_HOST`, through Resend's HTTPS API: spending by category, what was received, bills and card bills left to pay this
month, and account balances. The numbers are computed here, from the budget,
with the rules of the app's overview (`fork/home/README.md`), so they match what
the app shows. The caller only adds what happened today: a summary, the
corrections made and the questions for the owner. `dry_run` returns the data
without sending anything.

## Safety

- Every change is appended to `audit.jsonl` with its previous values; the
  `get_change_history` tool reads it back.
- The budget is exported to `backups/` before the first change each day and by
  the daily job.
- Bulk rule application previews by default.

## Development

```bash
yarn build --scope=@actual-app/mcp-server
ACTUAL_SERVER_URL=http://localhost:5006 ACTUAL_PASSWORD=... \
  node packages/mcp-server/dist/index.js
claude mcp add --transport http actual http://localhost:5007/mcp
```

`yarn typecheck` emits `tsc` output into `packages/api/dist`, replacing the
bundled build the server loads at runtime; rebuild the API with
`yarn workspace @actual-app/api build` before running the server locally.
