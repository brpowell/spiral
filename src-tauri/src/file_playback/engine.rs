//! File PCM playback engine: OGG/Opus → f32 stream to frontend.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::decoder::StreamingDecoder;

pub const FILE_PLAYBACK_POSITION_EVENT: &str = "file-playback-position";
pub const FILE_PLAYBACK_ENDED_EVENT: &str = "file-playback-ended";
pub const FILE_PLAYBACK_PCM_EVENT: &str = "file-playback-pcm";
pub const FILE_PLAYBACK_FLUSH_EVENT: &str = "file-playback-flush";

static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

/// Reply to `start_file_playback` — playback begins paused.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlaybackStarted {
    pub session_id: u64,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlaybackPosition {
    pub session_id: u64,
    pub position_seconds: f64,
    pub duration_seconds: f64,
    pub is_playing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlaybackEnded {
    pub session_id: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlaybackPcm {
    pub session_id: u64,
    pub channels: u16,
    pub pcm_b64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlaybackFlush {
    pub session_id: u64,
}

const POSITION_EVENT_INTERVAL: Duration = Duration::from_millis(250);
const ENGINE_START_TIMEOUT: Duration = Duration::from_secs(10);
const CHUNK_FRAMES: usize = 2048;
const MAX_CHUNKS_IN_FLIGHT: usize = 10;

enum PlaybackCommand {
    Seek(f64),
}

struct InFlightTracker {
    count: Mutex<usize>,
    cvar: Condvar,
}

impl InFlightTracker {
    fn new() -> Self {
        Self {
            count: Mutex::new(0),
            cvar: Condvar::new(),
        }
    }

    fn reset(&self) {
        *self.count.lock().expect("file pcm in-flight poisoned") = 0;
        self.cvar.notify_all();
    }

    fn wait_for_capacity(&self) {
        let mut guard = self.count.lock().expect("file pcm in-flight poisoned");
        while *guard >= MAX_CHUNKS_IN_FLIGHT {
            guard = self
                .cvar
                .wait(guard)
                .expect("file pcm in-flight condvar poisoned");
        }
    }

    fn chunk_sent(&self) {
        let mut guard = self.count.lock().expect("file pcm in-flight poisoned");
        *guard += 1;
    }

    fn ack(&self, count: u32) {
        let mut guard = self.count.lock().expect("file pcm in-flight poisoned");
        *guard = guard.saturating_sub(count as usize);
        self.cvar.notify_all();
    }
}

struct ActivePlayback {
    session_id: u64,
    stop_requested: Arc<AtomicBool>,
    is_playing: Arc<AtomicBool>,
    cmd_tx: mpsc::Sender<PlaybackCommand>,
    in_flight: Arc<InFlightTracker>,
    thread: thread::JoinHandle<()>,
}

fn shutdown_active(active: ActivePlayback) {
    active.stop_requested.store(true, Ordering::SeqCst);
    active.is_playing.store(false, Ordering::SeqCst);
    active.in_flight.reset();
    if let Err(err) = active.thread.join() {
        eprintln!("file playback: thread join failed: {err:?}");
    }
}

static ACTIVE: Mutex<Option<ActivePlayback>> = Mutex::new(None);

fn with_active<R>(f: impl FnOnce(&ActivePlayback) -> R) -> Option<R> {
    let guard = ACTIVE.lock().expect("file playback state poisoned");
    guard.as_ref().map(f)
}

fn emit_flush(app: &AppHandle, session_id: u64) {
    let payload = FilePlaybackFlush { session_id };
    if let Err(err) = app.emit(FILE_PLAYBACK_FLUSH_EVENT, payload) {
        eprintln!("file playback: flush emit failed: {err}");
    }
}

pub fn start(app: AppHandle, path: &str) -> Result<FilePlaybackStarted, String> {
    stop();

    let file_path = PathBuf::from(path);
    if !file_path.is_file() {
        return Err(format!("File not found: {path}"));
    }

    let ext = file_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if ext != "ogg" && ext != "opus" && ext != "m4a" && ext != "mp4" {
        return Err(format!("Native PCM playback is not supported for .{ext} files"));
    }

    let source = StreamingDecoder::open(&file_path)?;
    let duration_seconds = source.duration_seconds();
    let sample_rate = source.sample_rate();
    let channels = source.channels();
    let session_id = NEXT_SESSION_ID.fetch_add(1, Ordering::SeqCst);

    let stop_requested = Arc::new(AtomicBool::new(false));
    let is_playing = Arc::new(AtomicBool::new(false));
    let in_flight = Arc::new(InFlightTracker::new());
    let (cmd_tx, cmd_rx) = mpsc::channel::<PlaybackCommand>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

    let thread = {
        let app = app.clone();
        let stop_requested = Arc::clone(&stop_requested);
        let is_playing = Arc::clone(&is_playing);
        let in_flight = Arc::clone(&in_flight);
        thread::Builder::new()
            .name("file-playback".into())
            .spawn(move || {
                playback_thread(
                    app,
                    session_id,
                    duration_seconds,
                    sample_rate,
                    channels,
                    source,
                    stop_requested,
                    is_playing,
                    in_flight,
                    cmd_rx,
                    ready_tx,
                );
            })
            .map_err(|err| format!("Failed to start file playback thread: {err}"))?
    };

    ready_rx
        .recv_timeout(ENGINE_START_TIMEOUT)
        .map_err(|_| "File playback engine did not start".to_string())??;

    *ACTIVE.lock().expect("file playback state poisoned") = Some(ActivePlayback {
        session_id,
        stop_requested,
        is_playing,
        cmd_tx,
        in_flight,
        thread,
    });

    Ok(FilePlaybackStarted {
        session_id,
        duration_seconds,
        sample_rate,
        channels,
    })
}

#[allow(clippy::too_many_arguments)]
fn playback_thread(
    app: AppHandle,
    session_id: u64,
    duration_seconds: f64,
    sample_rate: u32,
    channels: u16,
    mut source: StreamingDecoder,
    stop_requested: Arc<AtomicBool>,
    is_playing: Arc<AtomicBool>,
    in_flight: Arc<InFlightTracker>,
    cmd_rx: mpsc::Receiver<PlaybackCommand>,
    ready_tx: mpsc::Sender<Result<(), String>>,
) {
    let _ = (sample_rate, duration_seconds);
    let channels_usize = channels as usize;
    let chunk_samples = CHUNK_FRAMES * channels_usize;
    let mut chunk = Vec::with_capacity(chunk_samples);
    let mut last_position_emit = Instant::now();

    let _ = ready_tx.send(Ok(()));

    loop {
        if stop_requested.load(Ordering::SeqCst) {
            return;
        }

        while let Ok(PlaybackCommand::Seek(seconds)) = cmd_rx.try_recv() {
            chunk.clear();
            in_flight.reset();
            if let Err(err) = source.seek_seconds(seconds) {
                eprintln!("file playback: seek failed: {err}");
            }
            emit_flush(&app, session_id);
        }

        if is_playing.load(Ordering::SeqCst) {
            while chunk.len() < chunk_samples {
                match source.next_sample() {
                    Some(sample) => chunk.push(sample),
                    None => break,
                }
            }

            if !chunk.is_empty() {
                in_flight.wait_for_capacity();

                if stop_requested.load(Ordering::SeqCst) {
                    return;
                }

                let pcm_bytes: Vec<u8> = chunk
                    .iter()
                    .flat_map(|sample| sample.to_le_bytes())
                    .collect();
                let payload = FilePlaybackPcm {
                    session_id,
                    channels,
                    pcm_b64: BASE64.encode(pcm_bytes),
                };
                if let Err(err) = app.emit(FILE_PLAYBACK_PCM_EVENT, payload) {
                    eprintln!("file playback: pcm emit failed: {err}");
                } else {
                    in_flight.chunk_sent();
                }
                chunk.clear();
            } else {
                break;
            }
        } else if last_position_emit.elapsed() >= POSITION_EVENT_INTERVAL {
            // Idle loop while paused — fall through to position emit below.
        } else {
            thread::sleep(Duration::from_millis(10));
        }

        if last_position_emit.elapsed() >= POSITION_EVENT_INTERVAL {
            let position_seconds = source.position_seconds().min(duration_seconds);
            let payload = FilePlaybackPosition {
                session_id,
                position_seconds,
                duration_seconds,
                is_playing: is_playing.load(Ordering::SeqCst),
            };
            if let Err(err) = app.emit(FILE_PLAYBACK_POSITION_EVENT, payload) {
                eprintln!("file playback: position emit failed: {err}");
            }
            last_position_emit = Instant::now();
        }
    }

    if stop_requested.load(Ordering::SeqCst) {
        return;
    }

    {
        let mut guard = ACTIVE.lock().expect("file playback state poisoned");
        if guard
            .as_ref()
            .is_some_and(|active| active.session_id == session_id)
        {
            *guard = None;
        }
    }

    let payload = FilePlaybackEnded { session_id };
    if let Err(err) = app.emit(FILE_PLAYBACK_ENDED_EVENT, payload) {
        eprintln!("file playback: ended emit failed: {err}");
    }
}

pub fn pause() {
    with_active(|active| active.is_playing.store(false, Ordering::SeqCst));
}

pub fn resume() {
    with_active(|active| active.is_playing.store(true, Ordering::SeqCst));
}

pub fn seek(seconds: f64) -> Result<(), String> {
    with_active(|active| active.cmd_tx.send(PlaybackCommand::Seek(seconds)))
        .ok_or_else(|| "No file is playing".to_string())?
        .map_err(|_| "File playback command channel closed".into())
}

pub fn ack_pcm_chunks(count: u32) {
    with_active(|active| active.in_flight.ack(count));
}

pub fn stop() {
    let taken = ACTIVE.lock().expect("file playback state poisoned").take();
    if let Some(active) = taken {
        shutdown_active(active);
    }
}
