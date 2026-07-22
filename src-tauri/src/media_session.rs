use serde::Deserialize;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(desktop)]
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSessionUpdate {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub art_path: Option<String>,
    pub duration_seconds: f64,
    pub position_seconds: f64,
    pub playback_state: String,
}

#[cfg(desktop)]
#[derive(Default)]
struct LastPublished {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    art_path: Option<String>,
    duration_tenths: i64,
    playback_state: String,
    position_sec: u64,
}

#[cfg(desktop)]
impl LastPublished {
    fn metadata_changed(&self, update: &MediaSessionUpdate) -> bool {
        self.title != update.title
            || self.artist != update.artist
            || self.album != update.album
            || self.art_path != update.art_path
            || self.duration_tenths != duration_key(update.duration_seconds)
    }

    fn playback_changed(&self, update: &MediaSessionUpdate) -> bool {
        self.playback_state != update.playback_state
            || self.position_sec != position_key(update.position_seconds)
    }

    fn apply_metadata(&mut self, update: &MediaSessionUpdate) {
        self.title = update.title.clone();
        self.artist = update.artist.clone();
        self.album = update.album.clone();
        self.art_path = update.art_path.clone();
        self.duration_tenths = duration_key(update.duration_seconds);
    }

    fn apply_playback(&mut self, update: &MediaSessionUpdate) {
        self.playback_state = update.playback_state.clone();
        self.position_sec = position_key(update.position_seconds);
    }
}

#[cfg(desktop)]
fn duration_key(seconds: f64) -> i64 {
    (seconds.max(0.0) * 10.0).round() as i64
}

#[cfg(desktop)]
fn position_key(seconds: f64) -> u64 {
    seconds.max(0.0).floor() as u64
}

#[cfg(desktop)]
pub struct MediaSessionState {
    controls: Mutex<Option<MediaControls>>,
    last_published: Mutex<LastPublished>,
}

#[cfg(desktop)]
fn create_controls(app: &AppHandle) -> Result<MediaControls, String> {
    #[cfg(target_os = "windows")]
    let hwnd = app
        .get_webview_window("main")
        .and_then(|window| window.hwnd().ok())
        .map(|hwnd| hwnd.0);

    #[cfg(not(target_os = "windows"))]
    let hwnd = None;

    let config = PlatformConfig {
        dbus_name: "com.spiralpowered.music",
        display_name: "Spiral",
        hwnd,
    };

    let mut controls = MediaControls::new(config).map_err(|err| err.to_string())?;
    let app_handle = app.clone();

    controls
        .attach(move |event| emit_media_control_event(&app_handle, event))
        .map_err(|err| err.to_string())?;

    Ok(controls)
}

#[cfg(desktop)]
fn emit_media_control_event(app: &AppHandle, event: MediaControlEvent) {
    match event {
        MediaControlEvent::Play => {
            let _ = app.emit("media-play", ());
        }
        MediaControlEvent::Pause | MediaControlEvent::Stop => {
            let _ = app.emit("media-pause", ());
        }
        MediaControlEvent::Toggle => {
            let _ = app.emit("media-play-pause", ());
        }
        MediaControlEvent::Next => {
            let _ = app.emit("media-next", ());
        }
        MediaControlEvent::Previous => {
            let _ = app.emit("media-prev", ());
        }
        MediaControlEvent::Seek(direction) => {
            let delta = match direction {
                SeekDirection::Forward => 3.0_f64,
                SeekDirection::Backward => -3.0_f64,
            };
            let _ = app.emit("media-seek-delta", delta);
        }
        MediaControlEvent::SeekBy(direction, duration) => {
            let seconds = duration.as_secs_f64();
            let delta = match direction {
                SeekDirection::Forward => seconds,
                SeekDirection::Backward => -seconds,
            };
            let _ = app.emit("media-seek-delta", delta);
        }
        MediaControlEvent::SetPosition(position) => {
            let _ = app.emit("media-seek", position.0.as_secs_f64());
        }
        _ => {}
    }
}

#[cfg(desktop)]
fn ensure_controls(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<MediaSessionState>();
    let mut guard = state.controls.lock().map_err(|err| err.to_string())?;
    if guard.is_none() {
        *guard = Some(create_controls(app)?);
    }
    Ok(())
}

pub fn init(app: &AppHandle) {
    #[cfg(desktop)]
    {
        app.manage(MediaSessionState {
            controls: Mutex::new(None),
            last_published: Mutex::new(LastPublished::default()),
        });

        if let Err(err) = ensure_controls(app) {
            eprintln!("failed to init media session: {err}");
        }
    }

    let _ = app;
}

#[tauri::command]
pub fn update_media_session(app: AppHandle, update: MediaSessionUpdate) -> Result<(), String> {
    #[cfg(desktop)]
    {
        ensure_controls(&app)?;
        let state = app.state::<MediaSessionState>();
        let mut controls_guard = state.controls.lock().map_err(|err| err.to_string())?;
        let controls = controls_guard
            .as_mut()
            .ok_or("media session unavailable")?;

        let mut last_guard = state
            .last_published
            .lock()
            .map_err(|err| err.to_string())?;
        let last = &*last_guard;

        let metadata_changed = last.metadata_changed(&update);
        let playback_changed = last.playback_changed(&update);

        if !metadata_changed && !playback_changed {
            return Ok(());
        }

        if metadata_changed {
            let cover_url_owned = update
                .art_path
                .as_ref()
                .filter(|path| Path::new(path.as_str()).is_file())
                .map(|path| format!("file://{}", path));

            let metadata = MediaMetadata {
                title: update.title.as_deref(),
                artist: update.artist.as_deref(),
                album: update.album.as_deref(),
                cover_url: cover_url_owned.as_deref(),
                duration: Some(Duration::from_secs_f64(update.duration_seconds.max(0.0))),
            };

            controls
                .set_metadata(metadata)
                .map_err(|err| err.to_string())?;
            last_guard.apply_metadata(&update);
        }

        if playback_changed {
            let progress = Some(MediaPosition(Duration::from_secs_f64(
                update.position_seconds.max(0.0),
            )));

            let playback = match update.playback_state.as_str() {
                "playing" => MediaPlayback::Playing { progress },
                "paused" => MediaPlayback::Paused { progress },
                _ => MediaPlayback::Stopped,
            };

            controls
                .set_playback(playback)
                .map_err(|err| err.to_string())?;
            last_guard.apply_playback(&update);
        }
    }

    let _ = update;
    Ok(())
}
