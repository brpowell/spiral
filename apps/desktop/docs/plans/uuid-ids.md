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
- [x] Migration drafted: `uuid_ids` in `src-tauri/src/db_migrations.rs`, **not registered in
      `MIGRATIONS`**, so it never runs; its data test is `#[ignore]`d
- [ ] Rust: switch id types (below)
- [ ] TypeScript: switch id types (below)
- [ ] Register `uuid_ids` as version 8, un-ignore its test, run `cargo test --lib db_migrations`
- [ ] Try it on a copy of a real library (the migration backs up to `Library.db.bak-v7` first)

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

- [ ] Add the id newtypes (one module, with `new()` calling `Uuid::now_v7()`)

- [ ] `models.rs`: `Track.id`, `Playlist.id`, `Playlist.track_ids`, lyrics/listen `track_id`,
      `event_id`
- [ ] `db.rs`: every track/playlist/event query; inserts generate ids with `Uuid::now_v7()`
      instead of reading `last_insert_rowid()` (track insert, playlist create at `db.rs:864`, listen
      event at `db.rs:383`)
- [ ] Playlist reorder writes one key between the moved track's new neighbours instead of
      renumbering (`db.rs:991`); add appends a key after the last one (`db.rs:920`). Playlist
      sidebar reorder (`db.rs:1025`) and create (`db.rs:838`) do the same. Pick a `fractional_index` crate or port the
      generator.
- [ ] `session.rs`: `Vec<i64>` → `Vec<String>`. An old `playback-session.json` holds numbers, so
      it fails to parse and `read_session` already returns `None`: the app starts with an empty
      queue. Add a test that an old-format session reads as `None`.
- [ ] `commands/library.rs`, `commands/playlists.rs`, `commands/lyrics.rs`, `commands/metadata.rs`
- [ ] `file_plan.rs`, `source_scan.rs`, `sources.rs`, `track_identity.rs`, `popularity.rs`,
      `rating_sync.rs`, `artwork_*.rs`, `mbid_tags.rs`, `lyrics_normalize.rs`, `lib.rs`
- [ ] Test helpers that build tracks by hand: `source_test_support.rs`, the `CREATE TABLE tracks`
      copies in `db.rs` and `artwork_organize.rs` tests
- [ ] `file_plan.rs:335` and `:1608` order by `id`: still fine (time-ordered), but confirm

## TypeScript changes

About 87 source files and 23 test files mention track, playlist or event ids.

- [ ] Types: `types/track.ts`, `types/playlist.ts`, `types/listenEvent.ts`, `types/playable.ts`,
      `types/playbackSession.ts`, `types/lyrics.ts`, `types/source.ts`: `number` → `string`
- [ ] `lib/tauri.ts` command signatures
- [ ] `lib/skin/skinPlaylist.ts:35` parses `playlist:<id>` with `parseInt`
- [ ] Selection and roving focus (`TrackList/useTrackListRowRoving.ts`), visualizer track
      (`visualizer/vizTrack.ts`), `hooks/usePopularity.ts`
- [ ] Anything that sorts, compares or does arithmetic on ids (search `- a.id`, `< b.id`)

## Decisions

- No old → new id map: the saved playback queue is dropped.
- A track is in a playlist at most once; no per-entry ids.
- Ids are Rust newtypes over `String`.
- Playlist order and sidebar order both use fractional keys in this PR.

## Checks

```bash
cd apps/desktop/src-tauri && cargo test --lib db_migrations && cargo clippy --all-targets
```

```bash
cd apps/desktop && npm run lint && npm test
```
