use crate::file_playback::{self, FilePlaybackStarted};
use tauri::AppHandle;

/// Start a paused session; audio is decoded and mixed in Rust and played
/// through the OS audio API.
#[tauri::command]
pub fn start_file_playback(app: AppHandle, path: String) -> Result<FilePlaybackStarted, String> {
    file_playback::start(app, &path)
}

#[tauri::command]
pub fn pause_file_playback(session_id: u64) {
    file_playback::pause(session_id)
}

#[tauri::command]
pub fn resume_file_playback(session_id: u64) {
    file_playback::resume(session_id)
}

#[tauri::command]
pub fn seek_file_playback(session_id: u64, position_seconds: f64) -> Result<(), String> {
    file_playback::seek(session_id, position_seconds)
}

#[tauri::command]
pub fn stop_file_playback(session_id: u64) {
    file_playback::stop(session_id)
}

/// Output gain (0–1) for a native session; volume and mute are folded together
/// by the caller.
#[tauri::command]
pub fn set_file_playback_gain(session_id: u64, gain: f32) {
    file_playback::set_gain(session_id, gain)
}

/// Start `to_session` on the exact sample `from_session` runs out (native only).
#[tauri::command]
pub fn link_gapless_playback(from_session: u64, to_session: u64) -> Result<(), String> {
    file_playback::link_gapless(from_session, to_session)
}

/// Stereo balance (-1 left … +1 right) for a native session.
#[tauri::command]
pub fn set_file_playback_balance(session_id: u64, balance: f32) {
    file_playback::set_balance(session_id, balance)
}

/// Graphic EQ for the native output: ten band gains and a preamp, in dB.
#[tauri::command]
pub fn set_native_equalizer(
    enabled: bool,
    bands_db: Vec<f32>,
    preamp_db: f32,
) -> Result<(), String> {
    use crate::native_audio::dsp::{EqSettings, EQ_BAND_COUNT};
    if bands_db.len() != EQ_BAND_COUNT {
        return Err(format!(
            "expected {EQ_BAND_COUNT} EQ bands, got {}",
            bands_db.len()
        ));
    }
    let mut bands = [0.0f32; EQ_BAND_COUNT];
    bands.copy_from_slice(&bands_db);
    crate::native_audio::global().set_equalizer(EqSettings {
        enabled,
        bands_db: bands,
        preamp_db,
    });
    Ok(())
}

/// Stream visualizer frames from the native output: `FRAME_BYTES` bytes per
/// message (128 frequency bytes, then 256 time-domain bytes), only when the
/// picture changes. Replaces any earlier subscriber.
#[tauri::command]
pub fn start_native_analyser(frames: tauri::ipc::Channel<tauri::ipc::Response>) {
    crate::native_audio::global().start_analyser(move |frame| {
        frames
            .send(tauri::ipc::Response::new(frame.to_vec()))
            .is_ok()
    });
}

#[tauri::command]
pub fn stop_native_analyser() {
    crate::native_audio::global().stop_analyser();
}

/// Linear gain fade for a native session, used by crossfades. `duration_ms`
/// of zero behaves like `set_file_playback_gain`.
#[tauri::command]
pub fn ramp_file_playback_gain(session_id: u64, from_gain: f32, to_gain: f32, duration_ms: u32) {
    file_playback::ramp_gain(session_id, from_gain, to_gain, duration_ms)
}

/// Decode and keep a short WAV clip under the id the frontend chose. The WAV
/// bytes are the raw request body; the id travels in the `x-sfx-id` header.
#[tauri::command]
pub fn load_sfx(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("load_sfx expects the WAV bytes as the request body".into());
    };
    let id = request
        .headers()
        .get("x-sfx-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or("load_sfx needs a numeric x-sfx-id header")?;
    crate::native_audio::sfx::store_clip(id, bytes)
}

/// Play a clip stored with `load_sfx`. Errors if it was never loaded.
#[tauri::command]
pub fn play_sfx(id: u64) -> Result<(), String> {
    let clip = crate::native_audio::sfx::clip(id).ok_or("Sound was not loaded")?;
    crate::native_audio::global().play_sfx(id, clip);
    Ok(())
}
