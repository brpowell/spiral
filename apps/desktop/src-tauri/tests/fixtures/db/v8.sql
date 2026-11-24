-- Generated fixture for schema version 8. Do not edit; see docs/contributing/database-migrations.md.
PRAGMA user_version = 8;
CREATE TABLE artist_images (
  artist_key TEXT NOT NULL PRIMARY KEY,
  art_path TEXT NOT NULL
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
            name TEXT NOT NULL,
            root_path TEXT,
            auto_organize INTEGER NOT NULL DEFAULT 0 CHECK (auto_organize IN (0, 1)),
            path_format TEXT,
            import_target INTEGER NOT NULL DEFAULT 0 CHECK (import_target IN (0, 1)),
            created_at TEXT NOT NULL
        );
CREATE UNIQUE INDEX idx_sources_root ON sources(root_path);
CREATE UNIQUE INDEX idx_sources_import_target ON sources(import_target)
            WHERE import_target = 1;
CREATE TRIGGER sources_root_on_insert BEFORE INSERT ON sources
            WHEN new.root_path IS NULL
            BEGIN SELECT RAISE(ABORT, 'every source has a root'); END;
CREATE TRIGGER sources_root_on_update BEFORE UPDATE OF id, root_path ON sources
            WHEN new.id != old.id OR new.root_path IS NULL
            BEGIN SELECT RAISE(ABORT, 'every source has a root'); END;
CREATE TABLE genre_settings (
            genre_key TEXT PRIMARY KEY,
            background_kind TEXT CHECK (background_kind IN ('color', 'theme_solid')),
            background_start TEXT,
            background_end TEXT
        );
CREATE TABLE removed_tracks (
            source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
            rel_path TEXT NOT NULL,
            path_key TEXT NOT NULL,
            removed_at TEXT NOT NULL,
            PRIMARY KEY (source_id, path_key)
        );
CREATE TABLE "tracks" (
            id TEXT PRIMARY KEY NOT NULL,
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
            source_id INTEGER NOT NULL REFERENCES sources(id),
            rel_path TEXT NOT NULL,
            art_path TEXT,
            date_added TEXT NOT NULL,
            play_count INTEGER NOT NULL DEFAULT 0,
            last_played_at TEXT,
            rating INTEGER NOT NULL DEFAULT 0,
            recording_mbid TEXT,
            release_mbid TEXT,
            artist_mbids TEXT,
            album_artist_mbids TEXT,
            missing_since TEXT,
            file_size INTEGER,
            file_mtime_ms INTEGER,
            UNIQUE (source_id, rel_path)
        );
CREATE TABLE "listen_events" (
            id TEXT PRIMARY KEY NOT NULL,
            track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
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
CREATE TABLE "playlists" (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            date_created TEXT NOT NULL,
            last_used_at TEXT NOT NULL,
            image_mode TEXT NOT NULL DEFAULT 'generated',
            custom_image_path TEXT,
            cover_background TEXT,
            cover_background_end TEXT,
            cover_icon TEXT,
            position TEXT NOT NULL
        );
CREATE TABLE "playlist_tracks" (
            playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            position TEXT NOT NULL,
            PRIMARY KEY (playlist_id, track_id)
        );
CREATE TABLE "track_lyrics" (
            track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
            format TEXT NOT NULL DEFAULT 'plain',
            source TEXT,
            lines_json TEXT NOT NULL,
            plain_text TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
        );
CREATE TABLE "track_lyrics_attempts" (
            track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            lrclib_id INTEGER NOT NULL,
            applied_at TEXT NOT NULL,
            PRIMARY KEY (track_id, lrclib_id)
        );
CREATE INDEX idx_listen_events_ended_at ON listen_events(ended_at);
CREATE INDEX idx_listen_events_track_id ON listen_events(track_id);
CREATE INDEX idx_playlist_tracks_order ON playlist_tracks(playlist_id, position, track_id);
CREATE INDEX idx_playlist_tracks_track ON playlist_tracks(track_id);
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
