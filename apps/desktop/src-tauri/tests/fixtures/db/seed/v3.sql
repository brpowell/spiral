-- Sample rows for schema version 3. Plain INSERTs, valid for that schema only.
-- When adding version N+1, copy this file to seed/v<N+1>.sql and adjust it for
-- the new schema, keeping rows that exercise earlier migrations' edge cases.
-- Every track lives in the Tracks source of a library at /library.
INSERT INTO sources (id, name, root_path, import_target, created_at)
  VALUES (1, 'Tracks', '/library/Tracks', 1, '2024-01-01T00:00:00Z');
INSERT INTO tracks (id, title, artist, album, source_id, rel_path, date_added, recording_mbid,
                    play_count, rating)
  VALUES (1, 'Song A', 'Artist X', 'Album 1', 1, 'a.mp3', '2024-01-01T00:00:00Z',
          '11111111-1111-1111-1111-111111111111', 0, 0),
         (2, 'Song B', 'Artist X', 'Album 1', 1, 'b.mp3', '2024-01-02T00:00:00Z', NULL, 0, 0),
         (3, 'Song C', 'Artist Z', 'Album 3', 1, 'Artist Z/Album 3/c.mp3',
          '2024-01-03T00:00:00Z', NULL, 3, 80),
         (4, 'Song D', 'Artist Z', NULL, 1, 'd.mp3', '2024-01-04T00:00:00Z', NULL, 0, 0),
         (5, 'Removed', NULL, NULL, 1, 'removed.mp3', '2024-01-05T00:00:00Z', NULL, 0, 0);
-- A removed track: its id must not be reused.
DELETE FROM tracks WHERE id = 5;
INSERT INTO playlists (id, title, date_created, last_used_at, position)
  VALUES (1, 'Favourites', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 0),
         (2, 'Another', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 1);
INSERT INTO playlist_tracks (playlist_id, track_id, position)
  VALUES (1, 1, 0), (1, 2, 1), (1, 3, 2), (2, 3, 0), (2, 4, 1);
INSERT INTO artist_images (artist_key, art_path)
  VALUES ('artist x', '/art/x.png'), ('artist y', '/art/y.png');
INSERT INTO track_lyrics (track_id, lines_json, plain_text, updated_at)
  VALUES (1, '[]', 'la la', '2024-01-01T00:00:00Z'),
         (3, '[]', 'do re', '2024-01-03T00:00:00Z');
INSERT INTO listen_events (track_id, started_at, ended_at, listened_seconds, completion, ui_mode)
  VALUES (1, '2024-01-03T10:00:00Z', '2024-01-03T10:03:00Z', 180.0, 'completed', 'library'),
         (3, '2024-01-04T10:00:00Z', '2024-01-04T10:03:00Z', 180.0, 'completed', 'library');
INSERT INTO musicbrainz_entities (kind, mbid, json, fetched_at)
  VALUES ('release', '22222222-2222-2222-2222-222222222222', '{}', '2024-01-01T00:00:00Z');
