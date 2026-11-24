# UUIDv7 id migration

Working plan for step 1 of "Foundations on the host" in the
[sync architecture doc](https://claude.ai/artifact/XbnvbRvhCUZStC86e4RBwR). It becomes the PR
description and is removed before merge.

Tracks, playlists and listen events switch from integer keys to UUIDv7 text ids
in one migration (v8). The same id string is used in SQL, Rust, TypeScript and the sync protocol.
The PR ships no sync code.

## Status

- [x] `uuid` crate (`v7` feature) added to the desktop crate
- [x] Fixture for schema 7 (`tests/fixtures/db/seed/v7.sql`, generated `v7.sql`), with an empty
      playlist and a track listened to twice
- [x] Migration `uuid_ids` in `src-tauri/src/db_migrations.rs`
- [x] Rust: switch id types (below)
- [x] TypeScript: switch id types (below)
- [x] Register `uuid_ids` as version 8, un-ignore its test, run `cargo test --lib db_migrations`
- [x] Tried on a test library (816 tracks, 50 listens): every row and link kept, and ids sort
      exactly as the old integer ids did. Not yet tried on a library with playlists.

## What the migration does

| Table | Before | After |
| --- | --- | --- |
| `tracks` | `id INTEGER AUTOINCREMENT` | `id TEXT`, UUIDv7 stamped with `date_added` |
| `playlists` | `id INTEGER AUTOINCREMENT`, integer `position` | `id TEXT`, UUIDv7 stamped with `date_created`; `position TEXT` (fractional key) |
| `listen_events` | `id`, `track_id` integers | `id TEXT` stamped with `started_at`, `track_id TEXT` |
| `playlist_tracks` | integer ids, integer `position` | text ids, `position TEXT` (fractional key); key still `(playlist_id, track_id)` |
| `track_lyrics`, `track_lyrics_attempts` | `track_id INTEGER` | `track_id TEXT` |

- Stamping ids with each row's creation time keeps "order by id" meaning "order of creation".
- Playlist positions use `fractional-indexing` keys (`a0`, `a1`, … `az`, `b00`), assigned in
  current order. Moving a track rewrites only that track's row, so reorders on two devices merge
  track by track. A track is still in a playlist at most once.
- No old → new id map is kept: the saved playback queue is dropped instead (a clean cut).
- `sources` keep integer ids: a source is a folder on one machine, never synced as an entity.
- `playlists.position` (sidebar order) gets fractional keys the same way, in current sidebar order.

## Rust changes

Ids become newtypes over `String`: `TrackId`, `PlaylistId`, `EventId`, so one kind of id can't be
passed where another belongs. Each is `#[serde(transparent)]` and implements rusqlite's
`ToSql`/`FromSql`, so JSON and SQL see a plain string.

- [x] Add the id newtypes (`src-tauri/src/ids.rs`)

- [x] `models.rs`, `db.rs`: inserts generate ids instead of reading `last_insert_rowid()`
- [x] Position keys: `src-tauri/src/position_key.rs`, a port of the `fractional-indexing` generator.
      `position_key::reorder` keeps the keys of the longest run already in order and rekeys only
      the rest, so moving one track writes one row. Used for playlist tracks and the sidebar.
- [x] `session.rs`: ids are plain strings (they are the frontend's track list ids, `cd:<n>`
      included). An old `playback-session.json` holds numbers, fails to parse and reads as `None`;
      tested.
- [x] Commands, scan, file plan, identity, popularity, rating sync, artwork, lyrics modules
- [x] Test helpers and tests. Tests of old migrations (v3, v7) now stop at their own version.
- [x] `file_plan.rs` orders by `id`: fine, ids are time-ordered

## TypeScript changes

- [x] Types: `TrackId`, `TrackListId` (`types/track.ts`) and `PlaylistId` (`types/playlist.ts`),
      all `string`
- [x] Track list ids: library rows use the track's UUID; pending imports are `pending:<n>`
      (`allocPendingTrackId`), CD rows `cd:<n>` (`cdTrackListId`). `isLibraryTrackId` replaces the
      old `id > 0` checks.
- [x] `lib/tauri.ts` command signatures, `skinPlaylist.ts` (`playlist:<id>` no longer parsed as a
      number), drag reorder (`String(source.id)`), visualizer preview id (`"preview"`)
- [x] Tests

## Decisions

- No old → new id map: the saved playback queue is dropped.
- A track is in a playlist at most once; no per-entry ids.
- Ids are Rust newtypes over `String`.
- Playlist order and sidebar order both use fractional keys in this PR.
- An id the backend receives as JSON must be a UUID (`ids.rs` deserializes through `TryFrom`), so
  ids are safe in file names (playlist art is named `<id>-<title>`).

## Known leftovers

- Custom playlist art saved before the migration keeps its `<old int id>-<title>` file name. The
  stored path still points at it, so it shows; but replacing or removing that art clears files by
  the new id's prefix, so the old file stays on disk.

## Checks

```bash
cd apps/desktop/src-tauri && cargo test --lib db_migrations && cargo clippy --all-targets
```

```bash
cd apps/desktop && npm run lint && npm test
```
