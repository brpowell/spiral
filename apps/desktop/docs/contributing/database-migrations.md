# Database migrations

The library database (`Library.db`) lives in the user's library folder, so it outlives app installs: a "brand new install" can open a database created by any earlier release. Schema changes therefore have to carry existing databases forward, not just describe the shape a new install gets. Issue [#63](https://github.com/brpowell/spiral/issues/63) was this exact mistake: a `CREATE TABLE IF NOT EXISTS` was edited and old databases kept the old primary key.

All of it lives in `src-tauri/src/db_migrations.rs`. `db::open` calls `db_migrations::run`.

## How it works

- The schema version is stored in SQLite's `PRAGMA user_version`.
- `MIGRATIONS` is an ordered, append-only list. A fresh database runs every migration from empty; an existing one runs only those newer than its version. There is no separate "current schema" script, so a new install and an upgrade always take the same path.
- Each migration runs in its own transaction together with its version bump. On failure it rolls back and the database stays at the previous version.
- Before changing an existing database, `run` copies it to `Library.db.bak-v<N>` (first backup per version is kept).
- A database whose version is newer than the app knows is refused untouched, with a message to update Spiral.
- Foreign keys are switched off during the run (needed for table rebuilds) and `foreign_key_check` must pass before each commit.

## Adding a migration

1. Append a `Migration { version, name, up }` to `MIGRATIONS` with the next version number. Never edit, reorder or delete an existing entry: it has already run on users' databases.
2. Write the migration's SQL out in full. Don't reference the current schema or shared constants, so later changes can't alter what an old migration does.
3. `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN` can't change a primary key, unique constraint, column type or nullability. For those, rebuild the table: create `<table>_new`, copy rows, drop the old table, rename. See `artist_images_single_key` for a worked example, including how to collapse duplicates.
4. Update the Rust code that reads and writes the table in the same change.
5. Add a test in `db_migrations.rs` for what the migration does to existing data: build the *before* shape by hand, run `run(&conn, None)`, assert on the result.
6. Run `cargo test --lib db_migrations` from `apps/desktop/src-tauri`.

## What the tests guard

`upgraded_legacy_database_matches_fresh_schema` builds an old-shaped database, upgrades it, and compares every table's columns, types, nullability and keys against a fresh database. If a migration and the intended schema disagree, it fails. Extend its legacy setup when a migration is meant to change an existing table's shape.

Spiral does not currently support any released schema, so there are no fixtures of historical databases. If that changes, a seeded dump of each supported version, upgraded in a test, is the natural next step.

## For agents

- Never edit the `CREATE TABLE` of an existing table without a migration; there is no schema script to edit. Add a migration.
- Never modify an existing `MIGRATIONS` entry; add a new one.
- After a schema change, `cargo test --lib db_migrations` must pass. If the schema-parity test fails, the migrations and the intended schema disagree; fix the migration.
