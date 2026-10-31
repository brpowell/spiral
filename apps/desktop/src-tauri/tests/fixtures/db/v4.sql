-- Generated fixture for schema version 4. Do not edit; see docs/contributing/database-migrations.md.
PRAGMA user_version = 4;
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
CREATE TABLE sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL CHECK (kind IN ('managed', 'watched', 'external')),
            root_path TEXT,
            name TEXT NOT NULL,
            writable INTEGER NOT NULL DEFAULT 0 CHECK (writable IN (0, 1)),
            created_at TEXT NOT NULL,
            CHECK ((kind = 'watched') = (root_path IS NOT NULL))
        );
CREATE UNIQUE INDEX idx_sources_single_kind ON sources(kind)
            WHERE kind IN ('managed', 'external');
CREATE UNIQUE INDEX idx_sources_watched_root ON sources(root_path)
            WHERE kind = 'watched';
CREATE TRIGGER sources_keep_builtin BEFORE DELETE ON sources
            WHEN old.kind != 'watched'
            BEGIN SELECT RAISE(ABORT, 'the managed and external sources cannot be removed'); END;
CREATE TRIGGER sources_keep_kind BEFORE UPDATE OF kind ON sources
            WHEN new.kind != old.kind
            BEGIN SELECT RAISE(ABORT, 'a source cannot change kind'); END;
CREATE TABLE "tracks" (
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
            album_artist_mbids TEXT,
            source_id INTEGER NOT NULL REFERENCES sources(id),
            missing_since TEXT
        , file_size INTEGER, file_mtime_ms INTEGER);
CREATE INDEX idx_tracks_source_id ON tracks(source_id);
-- Sample rows for schema version 4. Plain INSERTs, valid for that schema only.
-- When adding version N+1, copy this file to seed/v<N+1>.sql and adjust it for
-- the new schema, keeping rows that exercise earlier migrations' edge cases.
-- Migration 3 seeds the managed (1) and external (2) sources, but the generated
-- fixture holds only the schema and this seed, so restate them here.
-- Managed tracks sit in /library/Tracks: tests attach /library as the Spiral
-- folder before upgrading.
INSERT OR IGNORE INTO sources (id, kind, root_path, name, writable, created_at)
  VALUES (1, 'managed', NULL, 'Spiral Library', 1, '2024-01-01T00:00:00Z'),
         (2, 'external', NULL, 'Other Files', 0, '2024-01-01T00:00:00Z');
INSERT INTO sources (id, kind, root_path, name, writable, created_at)
  VALUES (3, 'watched', '/collection', 'Collection', 0, '2024-01-01T00:00:00Z'),
         (4, 'watched', '/removed', 'Removed', 0, '2024-01-01T00:00:00Z');
-- A removed watched folder: its id must not be reused.
DELETE FROM sources WHERE id = 4;
INSERT INTO tracks (id, title, artist, album, file_path, date_added, recording_mbid, source_id,
                    missing_since, file_size, file_mtime_ms)
  VALUES (1, 'Song A', 'Artist X', 'Album 1', '/music/a.mp3', '2024-01-01T00:00:00Z',
          '11111111-1111-1111-1111-111111111111', 2, NULL, NULL, NULL),
         (2, 'Song B', 'Artist X', 'Album 1', '/music/b.mp3', '2024-01-02T00:00:00Z', NULL, 2,
          NULL, NULL, NULL),
         (3, 'Song C', 'Artist Y', 'Album 2', '/collection/Sub/c.flac', '2024-01-03T00:00:00Z',
          NULL, 3, '2024-02-01T00:00:00Z', 2048, 1700000000000),
         (4, 'Song D', 'Artist Z', 'Album 3', '/library/Tracks/Artist Z/Album 3/d.mp3',
          '2024-01-04T00:00:00Z', NULL, 1, NULL, 4096, 1700000000001),
         (5, 'Song E', 'Artist Z', NULL, '/elsewhere/e.mp3', '2024-01-05T00:00:00Z', NULL, 3,
          NULL, NULL, NULL);
INSERT INTO playlists (id, title, date_created, last_used_at, position)
  VALUES (1, 'Favourites', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 0),
         (2, 'Another', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 1);
INSERT INTO playlist_tracks (playlist_id, track_id, position)
  VALUES (1, 1, 0), (1, 2, 1), (2, 3, 0), (2, 4, 1);
INSERT INTO artist_images (artist_key, art_path)
  VALUES ('artist x', '/art/x.png'), ('artist y', '/art/y.png');
INSERT INTO track_lyrics (track_id, lines_json, plain_text, updated_at)
  VALUES (1, '[]', 'la la', '2024-01-01T00:00:00Z'),
         (4, '[]', 'do re', '2024-01-04T00:00:00Z');
INSERT INTO listen_events (track_id, started_at, ended_at, listened_seconds, completion, ui_mode)
  VALUES (1, '2024-01-03T10:00:00Z', '2024-01-03T10:03:00Z', 180.0, 'completed', 'library'),
         (4, '2024-01-04T10:00:00Z', '2024-01-04T10:03:00Z', 180.0, 'completed', 'library');
INSERT INTO musicbrainz_entities (kind, mbid, json, fetched_at)
  VALUES ('release', '22222222-2222-2222-2222-222222222222', '{}', '2024-01-01T00:00:00Z');
