-- Item catalog. Mirrors migrations/sqlite (0001 baseline + 0002 items): same tables and
-- columns, with native types. A test keeps the two backends' schemas in step.

CREATE TABLE item_versions (
    publisher_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    version TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    min_app_version TEXT,
    -- Uncompressed on-disk size of the item root (not .spk archive length).
    size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    preview_storage_key TEXT,
    readme TEXT,
    changelog TEXT,
    published_at TIMESTAMPTZ NOT NULL,
    yanked_at TIMESTAMPTZ,
    PRIMARY KEY (publisher_id, item_type, item_id, version)
);

CREATE INDEX idx_item_versions_type_published
    ON item_versions (item_type, published_at);

CREATE INDEX idx_item_versions_publisher
    ON item_versions (publisher_id);

CREATE TABLE item_takedown_log (
    id BIGSERIAL PRIMARY KEY,
    purged_at TIMESTAMPTZ NOT NULL,
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
