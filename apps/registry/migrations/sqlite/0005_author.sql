-- Freeform author credit from the item manifest; empty for versions published before this column.
ALTER TABLE item_versions ADD COLUMN author TEXT NOT NULL DEFAULT '';
