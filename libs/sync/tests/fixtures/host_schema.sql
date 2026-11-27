-- Generated from the desktop app's fresh schema (version 10). Do not edit;
-- regenerate with: cargo test --lib generate_host_schema_fixture -- --ignored (from apps/desktop/src-tauri)
PRAGMA user_version = 10;
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
CREATE TABLE artwork (
            hash TEXT PRIMARY KEY,
            mime TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            byte_size INTEGER NOT NULL
        );
CREATE TABLE artwork_file (
            rel_path TEXT PRIMARY KEY,
            hash TEXT NOT NULL REFERENCES artwork(hash) ON DELETE CASCADE,
            size INTEGER NOT NULL,
            mtime_ms INTEGER NOT NULL
        );
CREATE INDEX idx_artwork_file_hash ON artwork_file(hash);
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
CREATE TABLE "playlists" (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            date_created TEXT NOT NULL,
            last_used_at TEXT NOT NULL,
            image_mode TEXT NOT NULL DEFAULT 'generated',
            cover_background TEXT,
            cover_background_end TEXT,
            cover_icon TEXT,
            position TEXT NOT NULL
        );
CREATE TABLE track_artwork (
            track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            artwork_hash TEXT NOT NULL REFERENCES artwork(hash),
            PRIMARY KEY (track_id, kind)
        );
CREATE INDEX idx_track_artwork_hash ON track_artwork(artwork_hash);
CREATE TABLE artist_artwork (
            artist_key TEXT NOT NULL,
            kind TEXT NOT NULL,
            artwork_hash TEXT NOT NULL REFERENCES artwork(hash),
            PRIMARY KEY (artist_key, kind)
        );
CREATE INDEX idx_artist_artwork_hash ON artist_artwork(artwork_hash);
CREATE TABLE playlist_artwork (
            playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            artwork_hash TEXT NOT NULL REFERENCES artwork(hash),
            PRIMARY KEY (playlist_id, kind)
        );
CREATE INDEX idx_playlist_artwork_hash ON playlist_artwork(artwork_hash);
CREATE TRIGGER change_log_tracks_insert AFTER INSERT ON tracks
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'track' AND entity_id = NEW.id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'track', NEW.id, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_tracks_update AFTER UPDATE ON tracks
            WHEN OLD.title IS NOT NEW.title OR OLD.artist IS NOT NEW.artist OR OLD.album IS NOT NEW.album OR OLD.album_artist IS NOT NEW.album_artist OR OLD.track_number IS NOT NEW.track_number OR OLD.total_tracks IS NOT NEW.total_tracks OR OLD.disc_number IS NOT NEW.disc_number OR OLD.total_discs IS NOT NEW.total_discs OR OLD.year IS NOT NEW.year OR OLD.genre IS NOT NEW.genre OR OLD.duration_seconds IS NOT NEW.duration_seconds OR OLD.sample_rate IS NOT NEW.sample_rate OR OLD.bitrate IS NOT NEW.bitrate OR OLD.codec IS NOT NEW.codec OR OLD.rating IS NOT NEW.rating OR OLD.recording_mbid IS NOT NEW.recording_mbid OR OLD.release_mbid IS NOT NEW.release_mbid OR OLD.artist_mbids IS NOT NEW.artist_mbids OR OLD.album_artist_mbids IS NOT NEW.album_artist_mbids OR OLD.file_size IS NOT NEW.file_size OR OLD.file_mtime_ms IS NOT NEW.file_mtime_ms
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
            WHEN OLD.title IS NOT NEW.title OR OLD.description IS NOT NEW.description OR OLD.position IS NOT NEW.position OR OLD.image_mode IS NOT NEW.image_mode OR OLD.cover_background IS NOT NEW.cover_background OR OLD.cover_background_end IS NOT NEW.cover_background_end OR OLD.cover_icon IS NOT NEW.cover_icon
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'playlist' AND entity_id = NEW.id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'playlist', NEW.id, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_playlists_delete AFTER DELETE ON playlists
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'playlist' AND entity_id = OLD.id;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'playlist', OLD.id, 'delete' FROM library_meta; END;
CREATE TRIGGER change_log_track_artwork_insert AFTER INSERT ON track_artwork
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'track_artwork' AND entity_id = NEW.track_id || ':' || NEW.kind;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'track_artwork', NEW.track_id || ':' || NEW.kind, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_track_artwork_update AFTER UPDATE ON track_artwork
            WHEN OLD.artwork_hash IS NOT NEW.artwork_hash
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'track_artwork' AND entity_id = NEW.track_id || ':' || NEW.kind;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'track_artwork', NEW.track_id || ':' || NEW.kind, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_track_artwork_delete AFTER DELETE ON track_artwork
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'track_artwork' AND entity_id = OLD.track_id || ':' || OLD.kind;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'track_artwork', OLD.track_id || ':' || OLD.kind, 'delete' FROM library_meta; END;
CREATE TRIGGER change_log_artist_artwork_insert AFTER INSERT ON artist_artwork
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'artist_artwork' AND entity_id = NEW.artist_key || ':' || NEW.kind;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'artist_artwork', NEW.artist_key || ':' || NEW.kind, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_artist_artwork_update AFTER UPDATE ON artist_artwork
            WHEN OLD.artwork_hash IS NOT NEW.artwork_hash
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'artist_artwork' AND entity_id = NEW.artist_key || ':' || NEW.kind;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'artist_artwork', NEW.artist_key || ':' || NEW.kind, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_artist_artwork_delete AFTER DELETE ON artist_artwork
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'artist_artwork' AND entity_id = OLD.artist_key || ':' || OLD.kind;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'artist_artwork', OLD.artist_key || ':' || OLD.kind, 'delete' FROM library_meta; END;
CREATE TRIGGER change_log_playlist_artwork_insert AFTER INSERT ON playlist_artwork
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'playlist_artwork' AND entity_id = NEW.playlist_id || ':' || NEW.kind;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'playlist_artwork', NEW.playlist_id || ':' || NEW.kind, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_playlist_artwork_update AFTER UPDATE ON playlist_artwork
            WHEN OLD.artwork_hash IS NOT NEW.artwork_hash
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'playlist_artwork' AND entity_id = NEW.playlist_id || ':' || NEW.kind;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'playlist_artwork', NEW.playlist_id || ':' || NEW.kind, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_playlist_artwork_delete AFTER DELETE ON playlist_artwork
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'playlist_artwork' AND entity_id = OLD.playlist_id || ':' || OLD.kind;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'playlist_artwork', OLD.playlist_id || ':' || OLD.kind, 'delete' FROM library_meta; END;
CREATE TRIGGER change_log_genre_settings_insert AFTER INSERT ON genre_settings
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'genre_setting' AND entity_id = NEW.genre_key;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'genre_setting', NEW.genre_key, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_genre_settings_update AFTER UPDATE ON genre_settings
            WHEN OLD.background_kind IS NOT NEW.background_kind OR OLD.background_start IS NOT NEW.background_start OR OLD.background_end IS NOT NEW.background_end
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'genre_setting' AND entity_id = NEW.genre_key;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'genre_setting', NEW.genre_key, 'upsert' FROM library_meta; END;
CREATE TRIGGER change_log_genre_settings_delete AFTER DELETE ON genre_settings
            BEGIN UPDATE library_meta SET rev = rev + 1;
                DELETE FROM change_log WHERE entity = 'genre_setting' AND entity_id = OLD.genre_key;
                INSERT INTO change_log (rev, entity, entity_id, op)
                    SELECT rev, 'genre_setting', OLD.genre_key, 'delete' FROM library_meta; END;
-- The change log triggers read and bump this row's rev.
INSERT INTO library_meta (id, library_id, rev) VALUES (1, '018d0000-0000-7000-8000-00000000f1f0', 0);
