-- Sample rows for schema version 8. Plain INSERTs, valid for that schema only.
-- When adding version N+1, copy this file to seed/v<N+1>.sql and adjust it for
-- the new schema, keeping rows that exercise earlier migrations' edge cases.
-- Every track lives in the Tracks source of a library at /library.
INSERT INTO sources (id, name, root_path, import_target, created_at)
  VALUES (1, 'Tracks', '/library/Tracks', 1, '2024-01-01T00:00:00Z');
INSERT INTO tracks (id, title, artist, album, source_id, rel_path, date_added, recording_mbid,
                    play_count, rating, file_size, file_mtime_ms)
  VALUES ('018d0000-0000-7000-8000-000000000001', 'Song A', 'Artist X', 'Album 1', 1, 'a.mp3',
          '2024-01-01T00:00:00Z', '11111111-1111-1111-1111-111111111111', 0, 0, 100, 200),
         ('018d0000-0000-7000-8000-000000000002', 'Song B', 'Artist X', 'Album 1', 1, 'b.mp3',
          '2024-01-02T00:00:00Z', NULL, 0, 0, 100, 200),
         ('018d0000-0000-7000-8000-000000000003', 'Song C', 'Artist Z', 'Album 3', 1,
          'Artist Z/Album 3/c.mp3', '2024-01-03T00:00:00Z', NULL, 3, 80, 100, 200),
         ('018d0000-0000-7000-8000-000000000004', 'Song D', 'Artist Z', NULL, 1, 'd.mp3',
          '2024-01-04T00:00:00Z', NULL, 0, 0, 100, 200);
-- Artists joined with '/' or the ID3v2.4 null: v7 marks these for re-reading.
INSERT INTO tracks (id, title, artist, album_artist, source_id, rel_path, date_added,
                    play_count, rating, file_size, file_mtime_ms)
  VALUES ('018d0000-0000-7000-8000-000000000006', 'Joined', 'Artist X/Artist Y', 'Artist X', 1,
          'e.m4a', '2024-01-06T00:00:00Z', 0, 0, 100, 200),
         ('018d0000-0000-7000-8000-000000000007', 'Featured',
          'Artist X' || char(0) || 'Artist Y', 'Artist X', 1, 'f.mp3', '2024-01-07T00:00:00Z',
          0, 0, 100, 200);
INSERT INTO playlists (id, title, date_created, last_used_at, position)
  VALUES ('018d0000-0000-7000-8000-0000000000a1', 'Favourites', '2024-01-01T00:00:00Z',
          '2024-01-01T00:00:00Z', 'a0'),
         ('018d0000-0000-7000-8000-0000000000a2', 'Another', '2024-01-01T00:00:00Z',
          '2024-01-01T00:00:00Z', 'a1'),
         -- v8 gives entries their own position keys: an empty playlist must survive with none.
         ('018d0000-0000-7000-8000-0000000000a3', 'Empty', '2024-01-09T00:00:00Z',
          '2024-01-09T00:00:00Z', 'a2');
-- Track C is in two playlists.
INSERT INTO playlist_tracks (playlist_id, track_id, position)
  VALUES ('018d0000-0000-7000-8000-0000000000a1', '018d0000-0000-7000-8000-000000000001', 'a0'),
         ('018d0000-0000-7000-8000-0000000000a1', '018d0000-0000-7000-8000-000000000002', 'a1'),
         ('018d0000-0000-7000-8000-0000000000a1', '018d0000-0000-7000-8000-000000000003', 'a2'),
         ('018d0000-0000-7000-8000-0000000000a2', '018d0000-0000-7000-8000-000000000003', 'a0'),
         ('018d0000-0000-7000-8000-0000000000a2', '018d0000-0000-7000-8000-000000000004', 'a1');
INSERT INTO artist_images (artist_key, art_path)
  VALUES ('artist x', '/art/x.png'), ('artist y', '/art/y.png');
INSERT INTO track_lyrics (track_id, lines_json, plain_text, updated_at)
  VALUES ('018d0000-0000-7000-8000-000000000001', '[]', 'la la', '2024-01-01T00:00:00Z'),
         ('018d0000-0000-7000-8000-000000000003', '[]', 'do re', '2024-01-03T00:00:00Z');
-- A track listened to twice keeps both events.
INSERT INTO listen_events (id, track_id, started_at, ended_at, listened_seconds, completion, ui_mode)
  VALUES ('018d0000-0000-7000-8000-0000000000e1', '018d0000-0000-7000-8000-000000000001',
          '2024-01-03T10:00:00Z', '2024-01-03T10:03:00Z', 180.0, 'completed', 'library'),
         ('018d0000-0000-7000-8000-0000000000e2', '018d0000-0000-7000-8000-000000000003',
          '2024-01-04T10:00:00Z', '2024-01-04T10:03:00Z', 180.0, 'completed', 'library'),
         ('018d0000-0000-7000-8000-0000000000e3', '018d0000-0000-7000-8000-000000000003',
          '2024-01-10T10:00:00Z', '2024-01-10T10:01:00Z', 60.0, 'skipped', 'library');
INSERT INTO musicbrainz_entities (kind, mbid, json, fetched_at)
  VALUES ('release', '22222222-2222-2222-2222-222222222222', '{}', '2024-01-01T00:00:00Z');
INSERT INTO track_lyrics_attempts (track_id, lrclib_id, applied_at)
  VALUES ('018d0000-0000-7000-8000-000000000001', 1001, '2024-01-05T00:00:00Z'),
         ('018d0000-0000-7000-8000-000000000001', 1002, '2024-01-06T00:00:00Z'),
         ('018d0000-0000-7000-8000-000000000003', 2001, '2024-01-07T00:00:00Z');
INSERT INTO removed_tracks (source_id, rel_path, path_key, removed_at)
  VALUES (1, 'Gone.mp3', 'gone.mp3', '2024-01-08T00:00:00Z');
