-- Generated fixture for schema version 9. Do not edit; see docs/contributing/database-migrations.md.
PRAGMA user_version = 9;
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
CREATE TABLE library_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            library_id TEXT NOT NULL,
            rev INTEGER NOT NULL DEFAULT 0
        );
CREATE TABLE change_log (
            rev INTEGER PRIMARY KEY,
            entity TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
            UNIQUE (entity, entity_id)
        );
CREATE TRIGGER library_meta_keep_row BEFORE DELETE ON library_meta
        BEGIN
            SELECT RAISE(ABORT, 'library_meta must keep its one row');
        END;
CREATE TRIGGER change_log_tracks_insert AFTER INSERT ON tracks
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'track' AND entity_id = NEW.id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'track', NEW.id, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_tracks_update AFTER UPDATE ON tracks
            WHEN OLD.title IS NOT NEW.title OR OLD.artist IS NOT NEW.artist OR OLD.album IS NOT NEW.album OR OLD.album_artist IS NOT NEW.album_artist OR OLD.track_number IS NOT NEW.track_number OR OLD.total_tracks IS NOT NEW.total_tracks OR OLD.disc_number IS NOT NEW.disc_number OR OLD.total_discs IS NOT NEW.total_discs OR OLD.year IS NOT NEW.year OR OLD.genre IS NOT NEW.genre OR OLD.duration_seconds IS NOT NEW.duration_seconds OR OLD.sample_rate IS NOT NEW.sample_rate OR OLD.bitrate IS NOT NEW.bitrate OR OLD.codec IS NOT NEW.codec OR OLD.art_path IS NOT NEW.art_path OR OLD.rating IS NOT NEW.rating OR OLD.recording_mbid IS NOT NEW.recording_mbid OR OLD.release_mbid IS NOT NEW.release_mbid OR OLD.artist_mbids IS NOT NEW.artist_mbids OR OLD.album_artist_mbids IS NOT NEW.album_artist_mbids OR OLD.file_size IS NOT NEW.file_size OR OLD.file_mtime_ms IS NOT NEW.file_mtime_ms
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'track' AND entity_id = NEW.id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'track', NEW.id, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_tracks_delete AFTER DELETE ON tracks
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'track' AND entity_id = OLD.id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'track', OLD.id, 'delete' FROM library_meta; END;
CREATE TRIGGER change_log_playlists_insert AFTER INSERT ON playlists
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'playlist' AND entity_id = NEW.id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'playlist', NEW.id, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_playlists_update AFTER UPDATE ON playlists
            WHEN OLD.title IS NOT NEW.title OR OLD.description IS NOT NEW.description OR OLD.position IS NOT NEW.position OR OLD.image_mode IS NOT NEW.image_mode OR OLD.custom_image_path IS NOT NEW.custom_image_path OR OLD.cover_background IS NOT NEW.cover_background OR OLD.cover_background_end IS NOT NEW.cover_background_end OR OLD.cover_icon IS NOT NEW.cover_icon
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'playlist' AND entity_id = NEW.id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'playlist', NEW.id, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_playlists_delete AFTER DELETE ON playlists
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'playlist' AND entity_id = OLD.id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'playlist', OLD.id, 'delete' FROM library_meta; END;
CREATE TRIGGER change_log_playlist_tracks_insert AFTER INSERT ON playlist_tracks
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'playlist_track' AND entity_id = NEW.playlist_id || ':' || NEW.track_id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'playlist_track', NEW.playlist_id || ':' || NEW.track_id, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_playlist_tracks_update AFTER UPDATE ON playlist_tracks
            WHEN OLD.position IS NOT NEW.position
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'playlist_track' AND entity_id = NEW.playlist_id || ':' || NEW.track_id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'playlist_track', NEW.playlist_id || ':' || NEW.track_id, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_playlist_tracks_delete AFTER DELETE ON playlist_tracks
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'playlist_track' AND entity_id = OLD.playlist_id || ':' || OLD.track_id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'playlist_track', OLD.playlist_id || ':' || OLD.track_id, 'delete' FROM library_meta; END;
CREATE TRIGGER change_log_track_lyrics_insert AFTER INSERT ON track_lyrics
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'track_lyrics' AND entity_id = NEW.track_id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'track_lyrics', NEW.track_id, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_track_lyrics_update AFTER UPDATE ON track_lyrics
            WHEN OLD.format IS NOT NEW.format OR OLD.source IS NOT NEW.source OR OLD.lines_json IS NOT NEW.lines_json OR OLD.plain_text IS NOT NEW.plain_text
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'track_lyrics' AND entity_id = NEW.track_id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'track_lyrics', NEW.track_id, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_track_lyrics_delete AFTER DELETE ON track_lyrics
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'track_lyrics' AND entity_id = OLD.track_id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'track_lyrics', OLD.track_id, 'delete' FROM library_meta; END;
CREATE TRIGGER change_log_artist_images_insert AFTER INSERT ON artist_images
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'artist_image' AND entity_id = NEW.artist_key;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'artist_image', NEW.artist_key, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_artist_images_update AFTER UPDATE ON artist_images
            WHEN OLD.art_path IS NOT NEW.art_path
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'artist_image' AND entity_id = NEW.artist_key;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'artist_image', NEW.artist_key, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_artist_images_delete AFTER DELETE ON artist_images
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'artist_image' AND entity_id = OLD.artist_key;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'artist_image', OLD.artist_key, 'delete' FROM library_meta; END;
-- Sample rows for schema version 9. Plain INSERTs, valid for that schema only.
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
-- Art paths v10 resolves: an override, a custom playlist cover and one in app data. The files
-- don't exist under /library, so they get no link.
UPDATE tracks SET art_path = 'Artwork/albums/Artist X/Album 1/02 - Song B - front.jpg'
  WHERE id = '018d0000-0000-7000-8000-000000000002';
UPDATE tracks SET art_path = '/app-data/art/c.jpg'
  WHERE id = '018d0000-0000-7000-8000-000000000003';
UPDATE playlists SET image_mode = 'custom',
                     custom_image_path = 'Artwork/playlists/018d0000-0000-7000-8000-0000000000a2-Another.png'
  WHERE id = '018d0000-0000-7000-8000-0000000000a2';
INSERT INTO genre_settings (genre_key, background_kind, background_start)
  VALUES ('rock', 'color', '#112233');
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
-- The library's identity and a log as v9 leaves it, set last so the triggers that ran on the rows
-- above (they log nothing without a library_meta row) don't decide it. v10 drops the
-- artist_image entity's rows.
DELETE FROM change_log;
INSERT OR REPLACE INTO library_meta (id, library_id, rev)
  VALUES (1, '018d0000-0000-7000-8000-0000000000f0', 3);
INSERT INTO change_log (rev, entity, entity_id, op)
  VALUES (1, 'track', '018d0000-0000-7000-8000-000000000001', 'upsert'),
         (2, 'artist_image', 'artist x', 'upsert'),
         (3, 'playlist_track', '018d0000-0000-7000-8000-0000000000a1:018d0000-0000-7000-8000-000000000002', 'upsert');
