use crate::activity_log::{self, ActivityLogDraft, ActivityLogEntry};

#[tauri::command]
pub fn append_activity_log(draft: ActivityLogDraft) {
    activity_log::append_draft(draft);
}

#[tauri::command]
pub fn get_recent_activity_logs(
    limit: Option<usize>,
    domain_prefix: Option<String>,
) -> Vec<ActivityLogEntry> {
    activity_log::get_recent(
        limit.unwrap_or(500),
        domain_prefix.as_deref(),
    )
}

#[tauri::command]
pub fn clear_activity_logs() {
    activity_log::clear();
}
