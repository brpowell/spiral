CREATE TABLE IF NOT EXISTS pack_versions (
    author_id TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    version TEXT NOT NULL,
    min_app_version TEXT,
    contribution_types TEXT NOT NULL,
    -- Uncompressed on-disk size of the pack root (not .spk archive length).
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    preview_storage_key TEXT,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    readme TEXT,
    changelog TEXT,
    contributions TEXT NOT NULL DEFAULT '[]',
    published_at TEXT NOT NULL,
    yanked_at TEXT,
    PRIMARY KEY (author_id, pack_id, version)
);

CREATE INDEX IF NOT EXISTS idx_pack_versions_author
    ON pack_versions (author_id);

CREATE INDEX IF NOT EXISTS idx_pack_versions_published
    ON pack_versions (author_id, pack_id, published_at);

CREATE TABLE IF NOT EXISTS takedown_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purged_at TEXT NOT NULL,
    author_id TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    version TEXT NOT NULL,
    reason TEXT NOT NULL,
    notice_ref TEXT
);

CREATE INDEX IF NOT EXISTS idx_takedown_log_identity
    ON takedown_log (author_id, pack_id, version);
