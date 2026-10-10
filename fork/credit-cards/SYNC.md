# Syncing the credit card tables

The module uses Actual's existing CRDT sync. The protocol is not modified.

## How a write becomes a message

`db.insertWithUUID`, `db.update` and `db.delete_` in
`packages/loot-core/src/server/db/index.ts` send one message per column:

```ts
{ dataset: table, row: id, column, value, timestamp }
```

`dataset` is the table name. There is no registry of synced tables. A
table participates when it has a single primary key column named `id`.
`delete_` writes `tombstone = 1` rather than removing the row. Reads filter
`tombstone = 0`.

Handlers that mutate go through `mutator(undoable(...))`, the same wrapping
`tags-create` uses, so the messages are undoable and serialized with other
writes.

## What a client does with a table it does not have

`apply()` in `packages/loot-core/src/server/sync/index.ts` inserts or
updates the cell. When the incoming message names a table or column this
build does not have, and the message came from the server, the error
matches `isMissingSchemaError` (`no such table`, `no such column`, `has no
column named`). The message is copied to `messages_pending` and the rest of
the batch still applies. It is also written to `messages_crdt`, so the
merkle tree stays aligned and the other device is not asked to send it
again.

On the next budget load, after migrations, `replayPendingMessages`
(`packages/loot-core/src/server/sync/replay.ts`, called from
`budgetfiles/app.ts`) applies whatever now fits. Cells that still don't fit
stay pending. A local write to an unknown column is a bug and raises
`invalid-schema` instead of being deferred.

So an older fork build that syncs a budget already using credit cards keeps
working. The card rows sit in `messages_pending` until that build is
updated, and the user sees the existing "update available" notice. A stock
Actual client does the same: it never crashes on these messages, and it
never shows the data, because it will never run this migration.

## Migrations

Files live in `packages/loot-core/migrations/` and run in timestamp order.
`ADDITIVE_ONLY_CUTOFF` is `1780606215001`. Migrations after that may create
a table, add a nullable column or a `NOT NULL` column with a default, and
add a non-unique index. They may not drop, rename, or tighten a column.
`additive-migrations.test.ts` checks the schema before and after each one.
The credit card migrations use ids above `1788468782000` (the latest
migration on this branch, `add_messages_pending`).

`CREATE TABLE IF NOT EXISTS` is used so a renumbered id is safe to replay.

These tables are synced, so they are not added to `NON_SYNCED_TABLES`.

## What does not happen automatically

Creating the SQLite table is not enough on its own, but it is enough for
sync once writes go through `db.insert` / `update` / `delete_`. The module
does not register the tables in the AQL schema. Tags are synced the same
way, with raw SQL, and staying out of `aql/schema/index.ts` keeps the
noisiest upstream file untouched.

`sync/reset.ts` hardcodes the tables whose tombstoned rows are deleted
during Reset Sync. The new tables are added to that list. Nothing in this
module calls Reset Sync.

Export, local backup and Actual-zip import copy the whole `db.sqlite`
(`cloud-storage.exportBuffer`, `budgetfiles/backups.ts`,
`importers/actual.ts`). The new tables travel with the file. Local backups
strip `messages_crdt` and `messages_clock`, which is existing behavior and
applies equally to every table.

## Conflicts

Two devices editing the same cell: the later timestamp wins, which is
Actual's normal rule. Deterministic ids mean both devices write the same
bill row. Aggregates are recomputed from the facts, so a merged bill cannot
end up with a paid amount that is the sum of two writers' totals.

## Version skew inside the fork

`credit-cards-schema-version` is a synced pref set by this code. A build
whose supported version is lower than the stored one serves reads and
rejects writes for these handlers. That is the guard against an older fork
producing rows a newer schema cannot read. Upstream builds ignore the pref.

## Tests that lock this in

`packages/loot-core/src/server/credit-cards/sync.test.ts` uses
`mockSyncServer` the way `sync/sync.test.ts` does:

- Client A inserts a card, client B syncs and reads the same row.
- Both update the same cell; the later timestamp wins and the other columns
  survive.
- A delete on A arrives as `tombstone = 1` on B.
- A message for `credit_cards` applied with the table dropped is deferred,
  then replayed once the table exists again. The row is intact.
- A second apply of the same messages does not create a second row.

Backup round-trip is covered by exporting the database file and opening it,
asserting the card, bill, installment and payment rows are still related.
