# Fork runbook

Operational procedures for this fork. See `CLAUDE.md` for the rules that govern
patches, and `fork/PATCHES.md` for what's currently carried.

Branch roles, for reference:

- `master` — mirrors upstream, never committed to.
- `personal` — patches on top of upstream `master`. All work happens here.
- `deploy` — fast-forwarded from `personal`; Railway builds it twice: the sync
  server via `sync-server.Dockerfile` and the MCP connector via
  `mcp-server.Dockerfile` (§4).

---

## 1. Rebasing onto new upstream code

Since 2026-07-30 this fork tracks upstream `master` rather than release tags — a
deliberate call that master is stable enough for this instance. The tradeoff is
real and worth restating: tags are release-tested, arbitrary master commits are
not. Prefer to sync at a moment when upstream CI is green, and always smoke-test
before deploying (§3).

The procedure below works either way. Substitute a tag for `upstream/master`
anywhere it appears if you want to go back to release-based syncing.

### 1.1 Update the upstream mirror

```bash
git fetch upstream --tags          # add the remote first if missing:
                                   # git remote add upstream https://github.com/actualbudget/actual.git
git checkout master
git merge --ff-only upstream/master
```

`--ff-only` is deliberate: if it refuses, something was committed to `master`
that shouldn't have been. Fix that before going further — don't merge.

The new base is `upstream/master`. If you're targeting a release tag instead:

```bash
git tag --list 'v26.*' --sort=-v:refname | head
```

### 1.2 Review what you're carrying before you replay it

```bash
git log --oneline <old-base>..personal
```

`<old-base>` is the `Base:` commit recorded at the top of `fork/PATCHES.md`.

Cross-check each commit against `fork/PATCHES.md` and, for anything with an
upstream PR, check whether it merged. **Drop patches that upstream fixed** — that
is the entire point of the drop-when column. Dropping is done by removing the
commit from the todo list in the next step.

### 1.3 Replay

Tag the current state of every branch you're about to rewrite — this is the
escape hatch, and it costs nothing:

```bash
git tag -a pre-sync-<date>/personal personal -m "state before syncing onto <new-base>"
git tag -a pre-sync-<date>/deploy   deploy   -m "last known-good deployed commit"
```

Then replay:

```bash
git rebase --onto upstream/master <old-base> personal
```

Tags beat backup branches here: they don't clutter `git branch`, they survive
force-pushes, and pushing them puts the escape hatch on GitHub too. Delete them
once the deploy has been healthy for a while.

On a conflict: resolve, `git add`, `git rebase --continue`. To abandon a patch
mid-rebase (upstream superseded it), `git rebase --skip`. To bail out entirely,
`git rebase --abort` — the branch is untouched.

If a patch conflicts heavily, that's a signal upstream restructured the code
underneath it. Re-derive the patch against the new code rather than forcing the
old diff through.

### 1.4 Verify

```bash
yarn install
yarn typecheck
yarn lint
yarn test
```

Then build what actually ships:

```bash
yarn build:server
```

Smoke-test locally before deploying — see §3.

### 1.5 Record

Update `fork/PATCHES.md`: new base commit, refreshed commit SHAs (the rebase
rewrote them), and move anything dropped into the Dropped table with the reason.
Also re-check anything in `CLAUDE.md` or this runbook that names the old base —
a stale base reference is the easiest way to mislead the next rebase.

Delete the escape-hatch tags once the deploy has been healthy for a while:

```bash
git tag -d pre-sync-<date>/personal pre-sync-<date>/deploy
git push origin --delete pre-sync-<date>/personal pre-sync-<date>/deploy
```

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

Useful before adopting a fix as a patch, or to check whether an upstream PR
actually solves the problem a local patch works around.

### Mind the version gap

`personal` now sits directly on upstream `master`, so PRs written against `master`
generally cherry-pick cleanly — that was the main practical win of the 2026-07-30
sync. The gap reopens as `master` moves on, so the further `personal` drifts from
the `Base:` commit in `fork/PATCHES.md`, the more a failed cherry-pick just means
"resync first, then try again."

### Fetch the PR

```bash
git fetch upstream pull/<PR-number>/head:pr-<PR-number>
git checkout pr-<PR-number>
yarn install
```

This gives you the PR branch as upstream authored it, on top of upstream's base —
not your patches.

### Test it against the fork

To see how it behaves with your patches, replay the PR onto `personal` in a
throwaway branch:

```bash
git checkout -b try-pr-<PR-number> personal
git cherry-pick personal..pr-<PR-number>
```

Conflicts here are informative: they show exactly which local patches the PR
collides with, which usually means the PR supersedes one of them.

### Run it

```bash
yarn typecheck
yarn test
yarn start              # browser client on :3001
yarn start:server-dev   # sync server on :5006 + client
```

Use **"View demo"** on the setup screen (after "Don't use a server") for a budget
with realistic sample data — far more useful than an empty one. Never test
against the production budget file.

### Clean up

```bash
git checkout personal
git branch -D pr-<PR-number> try-pr-<PR-number>
```

If the PR works and you want it now rather than at the next release, cherry-pick
it onto `personal` as a patch — and add a `fork/PATCHES.md` row whose drop
condition is "upstream PR #N ships in a release we've rebased onto."

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

The module is merged with the `creditCards` flag off. Migrations
`1791656900000_credit_cards.sql` and `1791656901000_credit_card_details.sql`
run on every budget this fork opens. They only add tables. Account balances
stay the sum of `transactions`.

Do not fast-forward `deploy` for this until a backup of "Duarte Finances" is
exported and tagged `pre-credit-cards/deploy`. Rolling the image back does not
undo the tables. `fork/credit-cards/RECOVERY.md` is the procedure, including
the two `__migrations__` ids to delete on a backup copy if a stock build
reports `out-of-sync-migrations`.

The module never runs Reset Sync or deletes transactions. Projected
installments are calculated, not posted. "Sync from bank" writes bill totals
and limits only.
