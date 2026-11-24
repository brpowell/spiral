use serde::{Deserialize, Serialize};
use std::fs;
use tauri::AppHandle;

use crate::settings;

/// The saved queue. Its ids are the frontend's track list ids: a library track's id, or a
/// `cd:<n>` row while a disc plays. They are only stored and handed back, never looked up here.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSession {
    #[serde(default)]
    pub play_context_ids: Vec<String>,
    #[serde(default)]
    pub manual_queue_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_track_id: Option<String>,
    #[serde(default)]
    pub position_seconds: f64,
    #[serde(default)]
    pub shuffle: bool,
    #[serde(default = "default_repeat_mode")]
    pub repeat_mode: String,
}

fn default_repeat_mode() -> String {
    "off".to_string()
}

pub fn session_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(settings::app_data_dir(app)?.join("playback-session.json"))
}

pub fn read_session(app: &AppHandle) -> Option<PlaybackSession> {
    let path = session_path(app).ok()?;
    if !path.exists() {
        return None;
    }
    parse_session(&fs::read_to_string(&path).ok()?)
}

/// A saved session, or `None` when it can't be read. One saved before track ids became UUIDs
/// holds numbers, so it reads as `None` and playback starts with an empty queue.
fn parse_session(contents: &str) -> Option<PlaybackSession> {
    serde_json::from_str(contents).ok()
}

pub fn write_session(app: &AppHandle, session: &PlaybackSession) -> Result<(), String> {
    let path = session_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create app data directory: {e}"))?;
    }
    let json = serde_json::to_string_pretty(session)
        .map_err(|e| format!("failed to serialize playback session: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("failed to write playback session: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_with_integer_track_ids_reads_as_none() {
        let old = r#"{"playContextIds":[1,2,3],"manualQueueIds":[],"currentTrackId":2,
            "positionSeconds":12.5,"shuffle":false,"repeatMode":"off"}"#;
        assert!(parse_session(old).is_none());
    }

    #[test]
    fn session_with_text_ids_round_trips() {
        let session = PlaybackSession {
            play_context_ids: vec!["0190a1b2-0000-7000-8000-000000000001".into(), "cd:3".into()],
            current_track_id: Some("cd:3".into()),
            position_seconds: 3.0,
            repeat_mode: "all".into(),
            ..Default::default()
        };
        let json = serde_json::to_string(&session).unwrap();
        let read = parse_session(&json).expect("parses");
        assert_eq!(read.play_context_ids, session.play_context_ids);
        assert_eq!(read.current_track_id, session.current_track_id);
    }
}
