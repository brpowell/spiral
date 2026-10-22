-- Sample rows for schema version 2. Plain INSERTs, valid for that schema only.
-- When adding version N+1, copy this file to seed/v<N+1>.sql and adjust it for
-- the new schema, keeping rows that exercise earlier migrations' edge cases.
INSERT INTO tracks (id, title, artist, album, file_path, date_added, recording_mbid)
  VALUES (1, 'Song A', 'Artist X', 'Album 1', '/music/a.mp3', '2024-01-01T00:00:00Z',
          '11111111-1111-1111-1111-111111111111'),
         (2, 'Song B', 'Artist X', 'Album 1', '/music/b.mp3', '2024-01-02T00:00:00Z', NULL);
INSERT INTO playlists (id, title, date_created, last_used_at, position)
  VALUES (1, 'Favourites', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 0),
         (2, 'Another', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 1);
INSERT INTO playlist_tracks (playlist_id, track_id, position)
  VALUES (1, 1, 0), (1, 2, 1);
INSERT INTO artist_images (artist_key, art_path)
  VALUES ('artist x', '/art/x.png'), ('artist y', '/art/y.png');
INSERT INTO track_lyrics (track_id, lines_json, plain_text, updated_at)
  VALUES (1, '[]', 'la la', '2024-01-01T00:00:00Z');
INSERT INTO listen_events (track_id, started_at, ended_at, listened_seconds, completion, ui_mode)
  VALUES (1, '2024-01-03T10:00:00Z', '2024-01-03T10:03:00Z', 180.0, 'completed', 'library');
INSERT INTO musicbrainz_entities (kind, mbid, json, fetched_at)
  VALUES ('release', '22222222-2222-2222-2222-222222222222', '{}', '2024-01-01T00:00:00Z');
