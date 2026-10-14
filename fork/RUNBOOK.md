# Fork runbook

Operational procedures for this fork. See `CLAUDE.md` for the rules that govern
changes.

Branch roles, for reference:

- `master` — frozen at the last upstream commit (`358823017`), never committed to.
- `personal` — the fork's main line. All work happens here.
- `deploy` — fast-forwarded from `personal`; Railway builds it twice: the sync
  server via `sync-server.Dockerfile` and the MCP connector via
  `mcp-server.Dockerfile` (§4).

---

## 1. Rebasing onto new upstream code

Retired. The fork stopped tracking upstream on 2026-10-14. Upstream fixes worth
having are ported by hand, as ordinary commits on `personal`.

---

## 2. Deploy

Railway builds `deploy` from `sync-server.Dockerfile`. `deploy` must always be a
fast-forward of `personal` — never commit to it, never merge into it.

### Railway configuration

The service's settings, for reference — if a deploy behaves unexpectedly, check
these first, they're the whole contract between the repo and Railway:

| Setting                   | Value                    | Notes                                                                       |
| ------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| Source branch             | `deploy`                 | Pushing to `deploy` is what triggers a build.                               |
| `RAILWAY_DOCKERFILE_PATH` | `sync-server.Dockerfile` | Without it Railway guesses the build and gets it wrong.                     |
| `ACTUAL_DATA_DIR`         | `/data`                  | Where the server keeps budget files and its SQLite DBs.                     |
| Volume mount path         | `/data`                  | Must match `ACTUAL_DATA_DIR` or data is lost on redeploy.                   |
| `PORT`                    | injected by Railway      | Don't set it. The server reads it; hardcoding breaks routing.               |
| `ACTUAL_BUILD_METADATA`   | _unset_                  | Optional override. Leave unset — the commit SHA is picked up automatically. |

The volume is the only stateful part of the deploy. Everything else is rebuilt
from the image, so a bad deploy is recoverable by redeploying — a wrong mount path
is not.

### Identifying which commit is deployed

`package.json` only changes at an upstream release, so a fork tracking `master`
reports the same version for every build in between. The deploy appends the
commit as semver build metadata, so Settings reads `v<version>+<sha>` for both
client and server. No configuration is needed — `sync-server.Dockerfile` reads
`RAILWAY_GIT_COMMIT_SHA` itself.

Railway only provides the git variables when the deploy came from a git trigger.
A redeploy started from the dashboard, or one triggered by editing a variable,
builds with an empty SHA and reports a bare version. Push to `deploy` to get a
stamped build back.

**Do not set `ACTUAL_BUILD_METADATA` to `${{ RAILWAY_GIT_COMMIT_SHA }}`.** It
resolves to an empty string, which is the whole reason the Dockerfile reads the
SHA directly. Railway's git variables are _deploy-scoped_: injected into builds
and deployments, but never part of the service's variable set that `${{ }}`
interpolates against. The giveaway is that `list-variables` for the service also
omits `RAILWAY_DEPLOYMENT_ID` and `RAILWAY_REPLICA_ID`, which unquestionably
exist inside every running container.

Set `ACTUAL_BUILD_METADATA` only to override the SHA with something else; it
takes precedence when non-empty. The value is shown verbatim, and the SHA is the
full 40 characters.

Two consequences worth knowing. Railway only provides git variables when the
deploy _originated from a git trigger_, so a redeploy triggered by a variable
change can come up unstamped — push a commit to restamp it. And if the SHA
reaches the runtime container but not the build, Settings shows a stamped server
version beside an unstamped client one; the client bakes its value in at build
time, while the server resolves it at start. The build log prints
`Client build metadata: …`, which says which of the two happened.

Locally there is no Dockerfile to map one name to the other, so set both. The
client name carries Vite's `REACT_APP_` prefix, without which Vite ignores it:

```bash
ACTUAL_BUILD_METADATA=$(git rev-parse --short HEAD) \
REACT_APP_BUILD_METADATA=$(git rev-parse --short HEAD) \
  yarn start:server-dev
```

Vite reads the environment once at startup, so the dev server has to be
restarted — exporting the variable in an already-running shell does nothing.
"Server version" only renders when the client is connected to a server; it shows
`N/A` otherwise.

### Pushing a deploy

```bash
# 1. personal is green: typecheck, lint, tests, and a local smoke test all pass.
git checkout personal
yarn typecheck

# 2. Fast-forward deploy.
git checkout deploy
git merge --ff-only personal

# 3. Push. This is what triggers the Railway build.
git push origin deploy

# 4. Back to the working branch.
git checkout personal
```

If step 2 refuses to fast-forward, `deploy` has commits `personal` doesn't. Don't
force-push past it — find out what landed there and replay it onto `personal`
first, then fast-forward.

Push `personal` too so the patch set is backed up:

```bash
git push origin personal
```

### Watching the deploy

Railway builds on push to `deploy`. Watch the build log for the Docker stage
failing on workspace manifests — the sync-server image copies a pruned set of
`package.json` files, so a newly added workspace dependency needs its manifest
copied in `sync-server.Dockerfile` or the install stage fails.

After it goes live, check the server responds and that an existing client can
still sync before considering the deploy done.

### Rolling back

Railway can redeploy a previous build from its dashboard — do that first, it's
the fastest path. To roll back in git, reset `deploy` to the last good commit and
force-push with lease:

```bash
git checkout deploy
git reset --hard <last-good-sha>
git push --force-with-lease origin deploy
```

Force-pushing `deploy` is acceptable because nothing branches from it. Never
force-push `personal` or `master`.

---

## 3. Testing an upstream PR locally

Retired with §1. To evaluate an upstream change, port it onto a feature branch
off `personal` and test it like any other change.

---

## 4. The MCP connector

`packages/mcp-server` is what lets Claude manage the budget. It runs as a second
Railway service, `actual-mcp`, built from the same `deploy` commit as the sync
server so its API always matches the budget's migrations.

### Railway configuration

| Setting                   | Value                                                 | Notes                                                                                              |
| ------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Source branch             | `deploy`                                              | Same trigger as the sync server.                                                                   |
| Watch paths               | `packages/{mcp-server,api,loot-core,crdt}/**`, …      | Only changes that affect the connector rebuild it.                                                 |
| `RAILWAY_DOCKERFILE_PATH` | `mcp-server.Dockerfile`                               |                                                                                                    |
| Volume mount path         | `/data`                                               | Budget cache, `backups/`, `audit.jsonl`, `auth.json` (OAuth clients and tokens), `daily-job.json`. |
| Domain                    | `actual-mcp-production-fff5.up.railway.app`           |                                                                                                    |
| `MCP_PUBLIC_URL`          | `https://actual-mcp-production-fff5.up.railway.app`   | OAuth issuer. Must match the domain or sign-in breaks.                                             |
| `ACTUAL_SERVER_URL`       | `https://actualbudget-production-c3bf.up.railway.app` |                                                                                                    |
| `ACTUAL_PASSWORD`         | _secret_, set in the dashboard                        | The sync server password. Also the connector's sign-in password unless `MCP_AUTH_PASSWORD` is set. |
| `TZ`                      | `America/Sao_Paulo`                                   | "Today" for schedules and the daily job's hour.                                                    |
| `MCP_DAILY_JOB_HOUR`      | `6`                                                   | Daily backup plus bank sync. See `packages/mcp-server/README.md` for every variable.               |
| Healthcheck               | `/healthz`                                            |                                                                                                    |

Secrets are typed into the dashboard rather than set by an agent, so they never
pass through a transcript.

### Connecting clients

- **claude.ai** (then mobile and desktop too): Settings → Connectors → Add
  custom connector → `https://actual-mcp-production-fff5.up.railway.app/mcp`.
  Signing in opens the connector's password page.
- **Claude Code**: run the command below, then `/mcp` to sign in.

  ```bash
  claude mcp add --transport http actual https://actual-mcp-production-fff5.up.railway.app/mcp
  ```

Tokens last an hour and refresh for 90 days of inactivity. To sign every client
out, delete `/data/auth.json` and restart the service.

### Recovering from a bad change

Every change the connector makes is in `/data/audit.jsonl` with its previous
values, and the budget is exported to `/data/backups/` before the first change
each day. To roll back wholesale, import a backup zip in Actual (Settings →
Import) as a new budget and check it before switching over.

### Local development

`yarn typecheck` runs `tsgo -b`, which writes plain `tsc` output over
`packages/api/dist`. Rebuild the bundle with `yarn workspace @actual-app/api
build` before running the connector locally, or it fails to start. The Docker
build never typechecks, so deploys are unaffected.

Test writes against a throwaway sync server rather than production: start
`packages/sync-server/build/app.js` with a temporary `ACTUAL_DATA_DIR`, bootstrap
it, import a backup zip with the API, and upload it.

---

## 5. Credit cards

The first credit card module (flag `creditCards`) was removed on 2026-10-14. Its
migrations `1791656900000` and `1791656901000` stay, and the `credit_card_*`
tables they created are no longer read or written. They are dropped in a later
release, once the web client and the MCP connector both run a build without
the old module (`CLAUDE.md`, "Changing core code").

Credit cards are now native accounts. Design and data model:
`fork/credit-cards/`.
