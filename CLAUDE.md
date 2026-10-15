@AGENTS.md
@.github/agents/pr-and-commit-rules.md

# Fork rules

This checkout is a **hard fork** of [actualbudget/actual](https://github.com/actualbudget/actual).
It stopped tracking upstream on 2026-10-14, at upstream `master` @ `358823017`.
Everything in `AGENTS.md` still applies for build, test, lint, and style
conventions — read it first. The rules below are additional and specific to
this fork.

## Branches

| Branch     | Role                                                                              |
| ---------- | --------------------------------------------------------------------------------- |
| `master`   | Frozen at the last upstream commit the fork was based on. **Never commit to it.** |
| `personal` | The fork's main line. Work happens here or on feature branches merged into it.    |
| `deploy`   | Fast-forwarded from `personal`. Railway builds this via `sync-server.Dockerfile`. |

Never commit directly to `master` or `deploy`.

## Changing core code

Upstream compatibility is no longer a constraint. Schema, migrations,
`loot-core`, the UI and the sync server can all change when a feature needs it;
there is no reason to work around "not touching the core". What still holds:

1. **Migrations stay additive for one release.** Stale clients of this same
   instance (a cached browser bundle, the MCP server before it is redeployed)
   keep sending CRDT messages for the old schema. Stop using a table or column
   first; drop it in a later release, once every client runs the release that
   stopped using it.
2. **Every client ships together.** The sync server, the web client and the MCP
   server (`packages/mcp-server`, which embeds `loot-core` through
   `@actual-app/api` and runs a daily bank sync) are deployed from the same
   commit.
3. **Synced writes go through CRDT.** Data that must reach other devices is
   written with `db.insert`/`db.update`/`db.delete_` (or the AQL helpers), never
   with raw SQL from a migration. Rows two devices may create independently get
   deterministic ids.
4. **One concern per commit.** Keep refactors, formatting and features in
   separate commits so each can be reviewed or reverted on its own.

## Coding preferences

These apply to all code written in this checkout.

- **SOLID.** Single responsibility, dependencies pointing at abstractions, no
  god-objects or grab-bag modules.
- **Match the surrounding code.** Style, naming, file layout, and idiom come from
  the code you're editing, not from your own defaults.
- **Follow Actual conventions.** If the codebase has an established way to do
  something, use it.
- **Design for extension.** New code should have the seams to grow along the axes
  it will plausibly grow along, without being speculatively general.
- **Minimal comments.** Comment only where the code genuinely can't carry the
  meaning: a non-obvious invariant, a workaround and the reason for it, a
  third-party quirk. No restating what the line does.
- **Never write comments addressed to the reader-as-requester.** No "as you
  asked", no "per your request", no references to prompts, tasks, or this
  conversation. Comments describe the code, permanently, for whoever reads it
  next.

## Before committing

- Run `yarn typecheck` from the repo root. Always, before every commit.
- Run `yarn lint:fix` and the relevant tests for what you touched.
- Follow the commit rules in `.github/agents/pr-and-commit-rules.md` — including
  the `[AI]` prefix, which the pre-commit guard enforces.

## Fork documentation

- `fork/PATCHES.md` — inventory of the changes made while the fork still tracked
  upstream. Frozen; new work is documented by feature instead.
- `fork/RUNBOOK.md` — deploying, the MCP connector, production procedures.
- `fork/NOTES.md` — context about this instance.
- `fork/credit-cards/` — the native credit card feature: design, data model,
  Pluggy behaviour per bank.
- `fork/home/` — the Overview a tracking budget opens on: where its numbers
  come from, paying bills, layout, fork translations (`locale-fork/`).

Keep these current as part of the change, not afterwards.
