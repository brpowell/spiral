-- Keys for listing the catalog in SQL: `version_order` sorts like semver (see
-- `db::version_order_key`), and the lowercased name and description back search and name
-- sorting. The registry computes all three on insert and backfills older rows at startup.
ALTER TABLE item_versions ADD COLUMN version_order TEXT;
ALTER TABLE item_versions ADD COLUMN name_lower TEXT;
ALTER TABLE item_versions ADD COLUMN description_lower TEXT;

CREATE INDEX idx_item_versions_version_order
    ON item_versions (publisher_id, item_type, item_id, version_order COLLATE "C");
