use crate::session::{self, PlaybackSession};
use tauri::AppHandle;

#[tauri::command]
pub fn get_playback_session(app: AppHandle) -> Result<Option<PlaybackSession>, String> {
    Ok(session::read_session(&app))
}

#[tauri::command]
pub fn save_playback_session(app: AppHandle, session: PlaybackSession) -> Result<(), String> {
    session::write_session(&app, &session)
}
