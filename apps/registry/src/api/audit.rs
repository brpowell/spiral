//! Audit trail for the admin API.
//!
//! Every admin request that changes state (and every request refused for a bad or missing token)
//! leaves an [`AuditEntry`]. The actor is a plain string ([`ACTOR_MASTER_TOKEN`] today) so named
//! tokens can be added later without a schema change. Neither the token nor any part of it is
//! ever recorded.
//!
//! Failure handling:
//! - Purges write their `success` entry in the same database transaction as the delete
//!   ([`crate::db::CatalogStore::delete_version`]): if the audit insert fails, nothing is purged
//!   and the request returns an error.
//! - Uploads, yanks and unyanks write their `success` entry right after the change. If that
//!   insert fails the change stands, the request still succeeds, and the full entry is logged at
//!   `error` level so it can be recovered from the logs.
//! - `denied` and `failed` entries describe something that did not happen, so they are best
//!   effort: a failed write is logged at `error` level with the entry and does not change the
//!   response.

use axum::http::Method;
use chrono::Utc;

use crate::db::CatalogStore;
use crate::models::{audit_action, audit_outcome, AuditEntry};

use super::auth::AdminAuth;

/// Longest stored value for a target segment or reason. Denied entries carry request-supplied
/// text, so this keeps an unauthenticated caller from bloating the table.
const MAX_FIELD_CHARS: usize = 2000;
const MAX_TARGET_CHARS: usize = 128;

fn truncate(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

/// An authenticated admin action in progress.
pub struct Attempt {
    entry: AuditEntry,
    recorded: bool,
}

impl Attempt {
    pub fn new(auth: &AdminAuth, action: &str) -> Self {
        Self {
            entry: AuditEntry {
                id: 0,
                at: Utc::now(),
                actor: auth.actor.clone(),
                action: action.to_string(),
                outcome: audit_outcome::SUCCESS.to_string(),
                publisher_id: None,
                item_type: None,
                item_id: None,
                version: None,
                reason: None,
                client_ip: auth.client_ip.clone(),
            },
            recorded: false,
        }
    }

    pub fn target(&mut self, publisher_id: &str, item_type: &str, item_id: &str) {
        self.entry.publisher_id = Some(truncate(publisher_id, MAX_TARGET_CHARS));
        self.entry.item_type = Some(truncate(item_type, MAX_TARGET_CHARS));
        self.entry.item_id = Some(truncate(item_id, MAX_TARGET_CHARS));
    }

    pub fn version(&mut self, version: &str) {
        self.entry.version = Some(truncate(version, MAX_TARGET_CHARS));
    }

    pub fn reason(&mut self, reason: &str) {
        let reason = reason.trim();
        if !reason.is_empty() {
            self.entry.reason = Some(truncate(reason, MAX_FIELD_CHARS));
        }
    }

    /// The `success` entry, to hand to a store method that writes it in the change's own
    /// transaction. Call [`Attempt::mark_recorded`] once the store reports the change was made.
    pub fn success_entry(&self) -> AuditEntry {
        AuditEntry {
            at: Utc::now(),
            outcome: audit_outcome::SUCCESS.to_string(),
            ..self.entry.clone()
        }
    }

    /// The success entry was written (by the store, in the change's transaction), so a later
    /// error in the same request must not add a `failed` entry for it.
    pub fn mark_recorded(&mut self) {
        self.recorded = true;
    }

    /// Record success after a change that is not in a transaction with the audit write.
    pub async fn log_success(&mut self, db: &dyn CatalogStore) {
        let entry = self.success_entry();
        self.recorded = true;
        write_best_effort(db, &entry).await;
    }

    /// Call once the handler is done: records a `failed` entry if the action errored before any
    /// success entry was written.
    pub async fn finish(mut self, db: &dyn CatalogStore, ok: bool) {
        if ok || self.recorded {
            return;
        }
        self.entry.at = Utc::now();
        self.entry.outcome = audit_outcome::FAILED.to_string();
        write_best_effort(db, &self.entry).await;
    }
}

/// Record a request refused for a bad or missing token. `path` and `method` come from the
/// request; the target is read from the path, so it is unverified text.
pub async fn record_denied(
    db: &dyn CatalogStore,
    admin_path: &str,
    method: &Method,
    path: &str,
    client_ip: Option<String>,
    actor: &str,
) {
    let (action, target) = classify(admin_path, method, path);
    let entry = AuditEntry {
        id: 0,
        at: Utc::now(),
        actor: actor.to_string(),
        action: action.to_string(),
        outcome: audit_outcome::DENIED.to_string(),
        publisher_id: target.0.map(|v| truncate(&v, MAX_TARGET_CHARS)),
        item_type: target.1.map(|v| truncate(&v, MAX_TARGET_CHARS)),
        item_id: target.2.map(|v| truncate(&v, MAX_TARGET_CHARS)),
        version: target.3.map(|v| truncate(&v, MAX_TARGET_CHARS)),
        reason: None,
        client_ip,
    };
    write_best_effort(db, &entry).await;
}

async fn write_best_effort(db: &dyn CatalogStore, entry: &AuditEntry) {
    if let Err(error) = db.insert_audit_entry(entry).await {
        tracing::error!(
            %error,
            audit_entry = ?entry,
            "failed to write audit log entry"
        );
    }
}

type Target = (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// Which admin action a request is, and what it targets, judged from method and path alone.
fn classify(admin_path: &str, method: &Method, path: &str) -> (&'static str, Target) {
    let none: Target = (None, None, None, None);
    let Some(rest) = path
        .strip_prefix(admin_path)
        .and_then(|r| r.strip_prefix("/api/"))
    else {
        return (audit_action::UNKNOWN, none);
    };
    let segments: Vec<&str> = rest.trim_end_matches('/').split('/').collect();
    let post = method == Method::POST;
    match segments.as_slice() {
        ["audit"] if method == Method::GET => (audit_action::READ_AUDIT, none),
        ["items"] if method == Method::GET => (audit_action::LIST_ITEMS, none),
        ["items"] if post => (audit_action::UPLOAD, none),
        ["items", p, t, i, "purge"] if post => (
            audit_action::PURGE_ITEM,
            (
                Some(p.to_string()),
                Some(t.to_string()),
                Some(i.to_string()),
                None,
            ),
        ),
        ["items", p, t, i, "versions", v, verb] if post => {
            let action = match *verb {
                "yank" => audit_action::YANK,
                "unyank" => audit_action::UNYANK,
                "purge" => audit_action::PURGE_VERSION,
                _ => return (audit_action::UNKNOWN, none),
            };
            (
                action,
                (
                    Some(p.to_string()),
                    Some(t.to_string()),
                    Some(i.to_string()),
                    Some(v.to_string()),
                ),
            )
        }
        _ => (audit_action::UNKNOWN, none),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_admin_routes() {
        let (action, target) = classify(
            "/admin",
            &Method::POST,
            "/admin/api/items/a/theme/b/versions/1.0.0/purge",
        );
        assert_eq!(action, "purge_version");
        assert_eq!(target.3.as_deref(), Some("1.0.0"));
        assert_eq!(
            classify("/admin", &Method::POST, "/admin/api/items").0,
            "upload"
        );
        assert_eq!(
            classify("/admin", &Method::GET, "/admin/api/audit").0,
            "read_audit"
        );
        assert_eq!(
            classify("/x", &Method::POST, "/x/api/items/a/skin/b/purge").0,
            "purge_item"
        );
        assert_eq!(
            classify("/admin", &Method::DELETE, "/admin/api/items").0,
            "unknown"
        );
    }
}
