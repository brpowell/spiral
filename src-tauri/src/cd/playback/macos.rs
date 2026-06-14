//! CD playback engine for macOS: cddafs AIFF file → PCM stream to frontend.
#![cfg(target_os = "macos")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use tauri::{AppHandle, Emitter};

use super::aiff::AiffSource;
use super::{
    CdPlaybackEnded, CdPlaybackError, CdPlaybackFlush, CdPlaybackPcm, CdPlaybackPosition,
    CdPlaybackStarted, CD_PLAYBACK_ENDED_EVENT, CD_PLAYBACK_ERROR_EVENT,
    CD_PLAYBACK_FLUSH_EVENT, CD_PLAYBACK_PCM_EVENT, CD_PLAYBACK_POSITION_EVENT,
};
use crate::cd::aiff_path::find_track_aiff_path;
use crate::cd::platform::session::{
    begin_phase, DriveSessionGuard, DriveSessionPhase,
};

/// ~4 Hz position pushes — plenty for a 500ms UI poll.
const POSITION_EVENT_INTERVAL: Duration = Duration::from_millis(250);
const ENGINE_START_TIMEOUT: Duration = Duration::from_secs(10);

/// 2048 frames per chunk (~46 ms at 44.1 kHz).
const CHUNK_FRAMES: usize = 2048;
/// Max chunks Rust may emit before the frontend acks (back-pressure).
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
        *self.count.lock().expect("cd pcm in-flight poisoned") = 0;
        self.cvar.notify_all();
    }

    fn wait_for_capacity(&self) {
        let mut guard = self.count.lock().expect("cd pcm in-flight poisoned");
        while *guard >= MAX_CHUNKS_IN_FLIGHT {
            guard = self
                .cvar
                .wait(guard)
                .expect("cd pcm in-flight condvar poisoned");
        }
    }

    fn chunk_sent(&self) {
        let mut guard = self.count.lock().expect("cd pcm in-flight poisoned");
        *guard += 1;
    }

    fn ack(&self, count: u32) {
        let mut guard = self.count.lock().expect("cd pcm in-flight poisoned");
        *guard = guard.saturating_sub(count as usize);
        self.cvar.notify_all();
    }
}

struct ActivePlayback {
    drive_id: String,
    stop_requested: Arc<AtomicBool>,
    is_playing: Arc<AtomicBool>,
    cmd_tx: mpsc::Sender<PlaybackCommand>,
    in_flight: Arc<InFlightTracker>,
    thread: thread::JoinHandle<()>,
    /// Holds `DriveSessionPhase::Playing` for the life of the track.
    _session_guard: DriveSessionGuard,
}

fn shutdown_active(active: ActivePlayback) {
    active.stop_requested.store(true, Ordering::SeqCst);
    active.is_playing.store(false, Ordering::SeqCst);
    // Unblock the reader if it is waiting on PCM back-pressure.
    active.in_flight.reset();
    if let Err(err) = active.thread.join() {
        eprintln!("cd playback: thread join failed: {err:?}");
    }
}

static ACTIVE: Mutex<Option<ActivePlayback>> = Mutex::new(None);

fn with_active<R>(f: impl FnOnce(&ActivePlayback) -> R) -> Option<R> {
    let guard = ACTIVE.lock().expect("cd playback state poisoned");
    guard.as_ref().map(f)
}

fn emit_flush(app: &AppHandle, drive_id: &str, track_number: u32) {
    let payload = CdPlaybackFlush {
        drive_id: drive_id.to_string(),
        track_number,
    };
    if let Err(err) = app.emit(CD_PLAYBACK_FLUSH_EVENT, payload) {
        eprintln!("cd playback: flush emit failed: {err}");
    }
}

pub fn start(
    app: AppHandle,
    drive_id: &str,
    track_number: u32,
) -> Result<CdPlaybackStarted, String> {
    stop();
    // Hold Playing before path resolution so the brief gap between tracks does
    // not return Idle and let background disc reads block auto-advance.
    let session_guard = begin_phase(drive_id, DriveSessionPhase::Playing);

    let track_path = find_track_aiff_path(drive_id, track_number)?;
    let source = AiffSource::open(&track_path)?;
    let duration_seconds = source.duration_seconds();
    let sample_rate = source.sample_rate();
    let channels = source.channels();
    let read_failed = source.read_failed_flag();
    let stop_requested = Arc::new(AtomicBool::new(false));
    let is_playing = Arc::new(AtomicBool::new(false));
    let in_flight = Arc::new(InFlightTracker::new());
    let (cmd_tx, cmd_rx) = mpsc::channel::<PlaybackCommand>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

    let thread = {
        let app = app.clone();
        let drive_id = drive_id.to_string();
        let stop_requested = Arc::clone(&stop_requested);
        let is_playing = Arc::clone(&is_playing);
        let in_flight = Arc::clone(&in_flight);
        thread::Builder::new()
            .name("cd-playback".into())
            .spawn(move || {
                playback_thread(
                    app,
                    drive_id,
                    track_number,
                    duration_seconds,
                    sample_rate,
                    channels,
                    source,
                    read_failed,
                    stop_requested,
                    is_playing,
                    in_flight,
                    cmd_rx,
                    ready_tx,
                );
            })
            .map_err(|err| format!("Failed to start CD playback thread: {err}"))?
    };

    ready_rx
        .recv_timeout(ENGINE_START_TIMEOUT)
        .map_err(|_| "CD playback engine did not start".to_string())??;

    *ACTIVE.lock().expect("cd playback state poisoned") = Some(ActivePlayback {
        drive_id: drive_id.to_string(),
        stop_requested,
        is_playing,
        cmd_tx,
        in_flight,
        thread,
        _session_guard: session_guard,
    });

    Ok(CdPlaybackStarted {
        duration_seconds,
        sample_rate,
        channels,
    })
}

#[allow(clippy::too_many_arguments)]
fn playback_thread(
    app: AppHandle,
    drive_id: String,
    track_number: u32,
    duration_seconds: f64,
    sample_rate: u32,
    channels: u16,
    mut source: AiffSource,
    read_failed: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
    is_playing: Arc<AtomicBool>,
    in_flight: Arc<InFlightTracker>,
    cmd_rx: mpsc::Receiver<PlaybackCommand>,
    ready_tx: mpsc::Sender<Result<(), String>>,
) {
    let channels_usize = channels as usize;
    let chunk_samples = CHUNK_FRAMES * channels_usize;
    let mut chunk = Vec::with_capacity(chunk_samples);
    let mut frames_sent = 0u64;
    let mut last_position_emit = Instant::now();

    let _ = ready_tx.send(Ok(()));

    loop {
        if stop_requested.load(Ordering::SeqCst) {
            return;
        }

        while let Ok(PlaybackCommand::Seek(seconds)) = cmd_rx.try_recv() {
            chunk.clear();
            frames_sent = 0;
            in_flight.reset();
            if let Err(err) = source.seek_seconds(seconds) {
                eprintln!("cd playback: seek failed: {err}");
            } else {
                frames_sent =
                    (source.position_seconds() * sample_rate as f64).round() as u64;
            }
            emit_flush(&app, &drive_id, track_number);
        }

        if is_playing.load(Ordering::SeqCst) {
            while chunk.len() < chunk_samples {
                match source.next() {
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
                let payload = CdPlaybackPcm {
                    drive_id: drive_id.clone(),
                    track_number,
                    channels,
                    pcm_b64: BASE64.encode(pcm_bytes),
                };
                if let Err(err) = app.emit(CD_PLAYBACK_PCM_EVENT, payload) {
                    eprintln!("cd playback: pcm emit failed: {err}");
                } else {
                    in_flight.chunk_sent();
                    frames_sent += (chunk.len() / channels_usize) as u64;
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
            let position_seconds =
                (frames_sent as f64 / sample_rate as f64).min(duration_seconds);
            let payload = CdPlaybackPosition {
                drive_id: drive_id.clone(),
                track_number,
                position_seconds,
                duration_seconds,
                is_playing: is_playing.load(Ordering::SeqCst),
            };
            if let Err(err) = app.emit(CD_PLAYBACK_POSITION_EVENT, payload) {
                eprintln!("cd playback: position emit failed: {err}");
            }
            last_position_emit = Instant::now();
        }
    }

    if stop_requested.load(Ordering::SeqCst) {
        return;
    }

    {
        let mut guard = ACTIVE.lock().expect("cd playback state poisoned");
        if guard
            .as_ref()
            .is_some_and(|active| Arc::ptr_eq(&active.stop_requested, &stop_requested))
        {
            *guard = None;
        }
    }

    if read_failed.load(Ordering::SeqCst) {
        let payload = CdPlaybackError {
            drive_id,
            track_number,
            message: "Failed to read CD audio data".into(),
        };
        if let Err(err) = app.emit(CD_PLAYBACK_ERROR_EVENT, payload) {
            eprintln!("cd playback: error emit failed: {err}");
        }
        return;
    }

    let payload = CdPlaybackEnded {
        drive_id,
        track_number,
    };
    if let Err(err) = app.emit(CD_PLAYBACK_ENDED_EVENT, payload) {
        eprintln!("cd playback: ended emit failed: {err}");
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
        .ok_or_else(|| "No CD track is playing".to_string())?
        .map_err(|_| "CD playback command channel closed".into())
}

pub fn ack_pcm_chunks(count: u32) {
    with_active(|active| active.in_flight.ack(count));
}

pub fn stop() {
    let taken = ACTIVE.lock().expect("cd playback state poisoned").take();
    if let Some(active) = taken {
        shutdown_active(active);
        // Session guard drops here → phase back to Idle.
    }
}

/// Stop playback only if it is using the given drive (eject path).
pub fn stop_for_drive(drive_id: &str) {
    let taken = {
        let mut guard = ACTIVE.lock().expect("cd playback state poisoned");
        if guard
            .as_ref()
            .is_some_and(|active| active.drive_id == drive_id)
        {
            guard.take()
        } else {
            None
        }
    };
    if let Some(active) = taken {
        shutdown_active(active);
    }
}
