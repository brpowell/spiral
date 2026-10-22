-- Generated fixture for schema version 2. Do not edit; see docs/contributing/database-migrations.md.
PRAGMA user_version = 2;
CREATE TABLE tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  album_artist TEXT,
  track_number INTEGER,
  total_tracks INTEGER,
  disc_number INTEGER,
  total_discs INTEGER,
  year INTEGER,
  genre TEXT,
  duration_seconds REAL,
  sample_rate INTEGER,
  bitrate INTEGER,
  codec TEXT,
  file_path TEXT NOT NULL UNIQUE,
  art_path TEXT,
  date_added TEXT NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT,
  rating INTEGER NOT NULL DEFAULT 0,
  recording_mbid TEXT,
  release_mbid TEXT,
  artist_mbids TEXT,
  album_artist_mbids TEXT
);
CREATE TABLE listen_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  listened_seconds REAL NOT NULL,
  library_listened_seconds REAL NOT NULL DEFAULT 0,
  skin_listened_seconds REAL NOT NULL DEFAULT 0,
  track_duration_seconds REAL,
  completion TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'library',
  ui_mode TEXT NOT NULL DEFAULT 'library',
  theme_id TEXT,
  theme_name TEXT,
  skin_id TEXT,
  skin_name TEXT,
  visualizer_id TEXT,
  visualizer_name TEXT
);
CREATE INDEX idx_listen_events_ended_at ON listen_events(ended_at);
CREATE INDEX idx_listen_events_track_id ON listen_events(track_id);
CREATE TABLE playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  date_created TEXT NOT NULL,
  last_used_at TEXT NOT NULL
, image_mode TEXT NOT NULL DEFAULT 'generated', custom_image_path TEXT, cover_background TEXT, cover_background_end TEXT, cover_icon TEXT, position INTEGER NOT NULL DEFAULT 0);
CREATE TABLE playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);
CREATE TABLE artist_images (
  artist_key TEXT NOT NULL PRIMARY KEY,
  art_path TEXT NOT NULL
);
CREATE TABLE track_lyrics (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  format TEXT NOT NULL DEFAULT 'plain',
  source TEXT,
  lines_json TEXT NOT NULL,
  plain_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE TABLE musicbrainz_entities (
  kind TEXT NOT NULL,
  mbid TEXT NOT NULL,
  json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (kind, mbid)
);
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
