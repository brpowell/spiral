-- Sample rows for schema version 6. Plain INSERTs, valid for that schema only.
-- When adding version N+1, copy this file to seed/v<N+1>.sql and adjust it for
-- the new schema, keeping rows that exercise earlier migrations' edge cases.
-- Migration 3 seeds the Tracks (1) and Other (2) sources, but the generated
-- fixture holds only the schema and this seed, so restate them here. Tracks'
-- root is stored relative to the Spiral folder. Other holds one loose track
-- (5) with play history, lyrics and a playlist entry, which migration 7 drops.
INSERT OR IGNORE INTO sources (id, name, root_path, auto_organize, path_format, import_target,
                               created_at)
  VALUES (1, 'Tracks', 'Tracks', 1, NULL, 1, '2024-01-01T00:00:00Z'),
         (2, 'Other Files', NULL, 0, NULL, 0, '2024-01-01T00:00:00Z');
INSERT INTO sources (id, name, root_path, auto_organize, path_format, import_target, created_at)
  VALUES (3, 'Collection', '/collection', 0, '{title}.{ext}', 0, '2024-01-01T00:00:00Z'),
         (4, 'Removed', '/removed', 0, NULL, 0, '2024-01-01T00:00:00Z');
-- A removed source: its id must not be reused.
DELETE FROM sources WHERE id = 4;
INSERT INTO tracks (id, title, artist, album, rel_path, date_added, recording_mbid, source_id,
                    missing_since, file_size, file_mtime_ms, play_count, rating)
  VALUES (1, 'Song A', 'Artist X', 'Album 1', 'Artist X/Album 1/a.mp3', '2024-01-01T00:00:00Z',
          '11111111-1111-1111-1111-111111111111', 1, NULL, 1024, 1700000000000, 3, 80),
         (2, 'Song B', 'Artist X', 'Album 1', 'Artist X/Album 1/b.mp3', '2024-01-02T00:00:00Z',
          NULL, 1, NULL, NULL, NULL, 0, 0),
         (3, 'Song C', 'Artist Y', 'Album 2', 'Sub/c.flac', '2024-01-03T00:00:00Z', NULL, 3,
          '2024-02-01T00:00:00Z', 2048, 1700000000000, 0, 0),
         (4, 'Song D', 'Artist Z', 'Album 3', 'Artist Z/Album 3/d.mp3', '2024-01-04T00:00:00Z',
          NULL, 1, '2024-02-02T00:00:00Z', 4096, 1700000000001, 1, 0),
         (5, 'Song E', 'Artist Z', NULL, '/elsewhere/e.mp3', '2024-01-05T00:00:00Z', NULL, 2,
          NULL, NULL, NULL, 0, 0);
INSERT INTO playlists (id, title, date_created, last_used_at, position)
  VALUES (1, 'Favourites', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 0),
         (2, 'Another', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 1);
INSERT INTO playlist_tracks (playlist_id, track_id, position)
  VALUES (1, 1, 0), (1, 2, 1), (2, 3, 0), (2, 4, 1), (2, 5, 2);
INSERT INTO artist_images (artist_key, art_path)
  VALUES ('artist x', '/art/x.png'), ('artist y', '/art/y.png');
INSERT INTO track_lyrics (track_id, lines_json, plain_text, updated_at)
  VALUES (1, '[]', 'la la', '2024-01-01T00:00:00Z'),
         (4, '[]', 'do re', '2024-01-04T00:00:00Z'),
         (5, '[]', 'mi fa', '2024-01-05T00:00:00Z');
INSERT INTO listen_events (track_id, started_at, ended_at, listened_seconds, completion, ui_mode)
  VALUES (1, '2024-01-03T10:00:00Z', '2024-01-03T10:03:00Z', 180.0, 'completed', 'library'),
         (4, '2024-01-04T10:00:00Z', '2024-01-04T10:03:00Z', 180.0, 'completed', 'library'),
         (5, '2024-01-05T10:00:00Z', '2024-01-05T10:03:00Z', 180.0, 'completed', 'library');
INSERT INTO musicbrainz_entities (kind, mbid, json, fetched_at)
  VALUES ('release', '22222222-2222-2222-2222-222222222222', '{}', '2024-01-01T00:00:00Z');
