-- Baseline: the pack catalog schema as it stood before migrations were introduced.
-- Columns use the publisher_id name introduced by the authorId rename. The pack tables are
-- replaced by item tables in the next migration, so no upgrade path from author_id is kept.

CREATE TABLE IF NOT EXISTS pack_versions (
    publisher_id TEXT NOT NULL,
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
    PRIMARY KEY (publisher_id, pack_id, version)
);

CREATE INDEX IF NOT EXISTS idx_pack_versions_author
    ON pack_versions (publisher_id);

CREATE INDEX IF NOT EXISTS idx_pack_versions_published
    ON pack_versions (publisher_id, pack_id, published_at);

CREATE TABLE IF NOT EXISTS takedown_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purged_at TEXT NOT NULL,
    publisher_id TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    version TEXT NOT NULL,
    reason TEXT NOT NULL,
    notice_ref TEXT
);

CREATE INDEX IF NOT EXISTS idx_takedown_log_identity
    ON takedown_log (publisher_id, pack_id, version);
