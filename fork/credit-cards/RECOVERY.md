# Recovering from the credit card migration

The migration only adds tables. It does not rewrite `transactions`,
`accounts`, or balances. Rolling a server image back does not roll the
database back. Read this before pointing the budget at a build that does
not contain these migration files.

## Before the first production deploy

1. Export a backup from the running server and keep it outside Railway.
2. Tag the current deploy: `pre-credit-cards/deploy`.
3. Deploy with the `creditCards` flag off. The tables are created empty.
   The nav entry stays hidden until the flag is turned on.

Development until that deploy uses a local server and the demo budget.
The production file is not opened by this branch.

## Going back to this fork, flag off

Turn the flag off in Settings → Experimental. The tables stay. Accounts,
transactions and balances are unchanged, because the module never wrote
them. This is the normal way to hide the feature.

## Going back to a stock Actual build

Stock Actual tolerates an unknown migration id from the additive era
(`checkDatabaseValidity` in
`packages/loot-core/src/server/migrate/migrations.ts`) only when every
migration that stock build knows about is already applied. Two cases:

- The stock build is the same upstream commit this fork is based on, or
  newer but with no migrations this database is missing. The budget opens.
  The `credit_card_*` tables sit unused. Card transactions are ordinary
  transactions and stay visible. The bill UI is gone. The fork's other
  patches (dashboard cards, MCP server, notes-contains default) are gone
  with the image, which is independent of this module.
- The stock build has a migration this database has not applied, and the
  database has the fork migration id, which the stock build does not know.
  Load fails with `out-of-sync-migrations`. That is the "unknown migration
  next to a missing known one" check. It is not data loss. Fix it on a
  copy of a backup, not on the live file:

  1. Download a backup (or copy `db.sqlite` out of the export zip).
  2. Open it with any SQLite client.
  3. Delete the fork's row. The id is the numeric prefix of
     `packages/loot-core/migrations/*credit_card*.sql` on the deployed
     commit. There are two of them.

     ```sql
     DELETE FROM __migrations__ WHERE id IN (
       1791656900000,
       1791656901000
     );
     ```

  4. Leave the `credit_card_*` tables in place. Stock Actual does not read
     them, and an unknown table does not affect sync of the tables it does
     know.
  5. Import that file into the stock server.

Do not delete the migration files from a fork build that has already opened
the budget. A missing file next to an applied id is the same
`out-of-sync-migrations` error. If the module is ever removed from the
fork, the migration files stay forever and the feature flag stays off.

## Going back to an older official release

Not safe, with or without this module. This fork tracks upstream `master`.
A release older than the base commit (`358823017` at the time of writing)
is missing upstream migrations the database has already applied, and those
ids are also unknown to it. Restore the pre-deploy backup instead.

## The backup is the clean exit

The export taken before the first deploy opens on stock Actual with no
`__migrations__` edit. It does not contain anything entered after it was
taken. Exports taken after the deploy do contain the tables and the
migration ids, and need the edit above only in the failure case.

## What this module will not do

It will not run Reset Sync, Revert, or delete transactions to repair
itself. A divergence between a confirmed bill and the transactions assigned
to it is shown and left for the user.
