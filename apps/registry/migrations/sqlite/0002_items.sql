-- Replace the v1 pack catalog with individual items. The pack tables and their rows are
-- dropped: the registry is items-only and nothing needs to stay compatible.

DROP TABLE IF EXISTS pack_versions;
DROP TABLE IF EXISTS takedown_log;

CREATE TABLE item_versions (
    publisher_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    version TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    min_app_version TEXT,
    -- Uncompressed on-disk size of the item root (not .spk archive length).
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    preview_storage_key TEXT,
    readme TEXT,
    changelog TEXT,
    published_at TEXT NOT NULL,
    yanked_at TEXT,
    PRIMARY KEY (publisher_id, item_type, item_id, version)
);

CREATE INDEX idx_item_versions_type_published
    ON item_versions (item_type, published_at);

CREATE INDEX idx_item_versions_publisher
    ON item_versions (publisher_id);

CREATE TABLE item_takedown_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purged_at TEXT NOT NULL,
    publisher_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    -- A specific semver, or '*' for an item-level purge.
    version TEXT NOT NULL,
    reason TEXT NOT NULL,
    notice_ref TEXT
);

CREATE INDEX idx_item_takedown_log_identity
    ON item_takedown_log (publisher_id, item_type, item_id, version);
