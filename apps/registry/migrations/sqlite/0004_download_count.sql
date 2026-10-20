-- Running count of successful downloads per item version. Recorded only; not exposed by the API yet.
ALTER TABLE item_versions ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;
