-- Append-only record of admin API calls: who did what, to what, and when.
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL,
    -- Who acted. A free-form string (today always 'master-token'); named tokens can use
    -- their own labels later without a schema change. Never a token or any part of one.
    actor TEXT NOT NULL,
    -- upload, yank, unyank, purge_version, purge_item, or a read action (list_items, read_audit).
    action TEXT NOT NULL,
    -- success, denied (bad or missing token) or failed (authenticated, but the action errored).
    outcome TEXT NOT NULL,
    publisher_id TEXT,
    item_type TEXT,
    item_id TEXT,
    version TEXT,
    reason TEXT,
    client_ip TEXT
);

CREATE INDEX idx_audit_log_action ON audit_log (action, id);
CREATE INDEX idx_audit_log_target ON audit_log (publisher_id, item_type, item_id, id);
