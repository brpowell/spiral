//! Shared CD playback engine: PCM source → f32 chunks → frontend Web Audio.
//!
//! Supports up to [`MAX_SESSIONS`] concurrent sessions so two tracks on the same
//! drive can overlap for gapless handoff (mirrors `file_playback::engine`).
//! Position / end / error updates reach the frontend as Tauri events.
//! Platforms supply a [`CdPcmSource`] and an optional session guard.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use tauri::{AppHandle, Emitter};

use super::source::CdPcmSource;
use super::{
    CdPlaybackEnded, CdPlaybackError, CdPlaybackFlush, CdPlaybackGaplessStarted, CdPlaybackPcm,
    CdPlaybackPosition, CdPlaybackStarted, CD_PLAYBACK_ENDED_EVENT, CD_PLAYBACK_ERROR_EVENT,
    CD_PLAYBACK_FLUSH_EVENT, CD_PLAYBACK_GAPLESS_STARTED_EVENT, CD_PLAYBACK_PCM_EVENT,
    CD_PLAYBACK_POSITION_EVENT,
};
use crate::cd::platform::session::DriveSessionGuard;
use crate::native_audio::mixer::DeckShared;
use crate::native_audio::{AudioOutput, DeckHandle};

/// Seconds of source audio the native output ring holds ahead of the device.
/// Sized for an optical drive's seek stalls, like the webview read-ahead.
const NATIVE_RING_SECONDS: f64 = 4.0;
/// Decode-thread nap when the native ring is full or the stream is done.
const NATIVE_IDLE_SLEEP: Duration = Duration::from_millis(5);

/// ~4 Hz position pushes — plenty for a 500ms UI poll.
const POSITION_EVENT_INTERVAL: Duration = Duration::from_millis(250);
const ENGINE_START_TIMEOUT: Duration = Duration::from_secs(10);

/// 2048 frames per chunk (~46 ms at 44.1 kHz).
const CHUNK_FRAMES: usize = 2048;
/// Max chunks Rust may emit before the frontend acks (back-pressure).
/// Sized so a CD cold-start can queue ~2s without stalling on acks while gated.
const MAX_CHUNKS_IN_FLIGHT: usize = 48;

/// Outgoing + incoming decks during CD gapless handoff.
const MAX_SESSIONS: usize = 2;

static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

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

/// Control surface for a session that plays through the native output.
struct NativeControl {
    deck_id: u64,
    shared: Arc<DeckShared>,
    output: AudioOutput,
}

struct ActivePlayback {
    native: Option<NativeControl>,
    drive_id: String,
    stop_requested: Arc<AtomicBool>,
    is_playing: Arc<AtomicBool>,
    cmd_tx: mpsc::Sender<PlaybackCommand>,
    in_flight: Arc<InFlightTracker>,
    thread: thread::JoinHandle<()>,
    started_at: Instant,
    /// Holds `DriveSessionPhase::Playing` for the life of the track (when provided).
    _session_guard: Option<DriveSessionGuard>,
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

static SESSIONS: LazyLock<Mutex<HashMap<u64, ActivePlayback>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn with_session<R>(session_id: u64, f: impl FnOnce(&ActivePlayback) -> R) -> Option<R> {
    let guard = SESSIONS.lock().expect("cd playback state poisoned");
    guard.get(&session_id).map(f)
}

/// Evict the oldest idle (not playing) session when at capacity.
/// Returns an error if both slots are occupied by playing sessions.
fn make_room_for_new_session(sessions: &mut HashMap<u64, ActivePlayback>) -> Result<(), String> {
    if sessions.len() < MAX_SESSIONS {
        return Ok(());
    }

    let snapshot: Vec<(u64, bool, Instant)> = sessions
        .iter()
        .map(|(id, session)| {
            (
                *id,
                session.is_playing.load(Ordering::SeqCst),
                session.started_at,
            )
        })
        .collect();

    match pick_eviction_victim(&snapshot, MAX_SESSIONS) {
        EvictionDecision::HasRoom => Ok(()),
        EvictionDecision::Evict(id) => {
            if let Some(active) = sessions.remove(&id) {
                shutdown_active(active);
            }
            Ok(())
        }
        EvictionDecision::Full => Err("Maximum concurrent CD playback sessions reached".into()),
    }
}

#[derive(Debug, PartialEq, Eq)]
enum EvictionDecision {
    HasRoom,
    Evict(u64),
    Full,
}

/// Pure eviction policy for dual-session capacity.
fn pick_eviction_victim(
    sessions: &[(u64, bool, Instant)],
    max_sessions: usize,
) -> EvictionDecision {
    if sessions.len() < max_sessions {
        return EvictionDecision::HasRoom;
    }
    sessions
        .iter()
        .filter(|(_, playing, _)| !*playing)
        .min_by_key(|(_, _, started_at)| *started_at)
        .map(|(id, _, _)| EvictionDecision::Evict(*id))
        .unwrap_or(EvictionDecision::Full)
}

fn emit_flush(app: Option<&AppHandle>, session_id: u64, drive_id: &str, track_number: u32) {
    let Some(app) = app else {
        return;
    };
    let payload = CdPlaybackFlush {
        session_id,
        drive_id: drive_id.to_string(),
        track_number,
    };
    if let Err(err) = app.emit(CD_PLAYBACK_FLUSH_EVENT, payload) {
        eprintln!("cd playback: flush emit failed: {err}");
    }
}

/// Start playback of `source` for `drive_id` / `track_number`. Begins paused.
///
/// With `native` set, audio is mixed in Rust and played through the OS audio
/// API instead of being streamed to the webview.
pub fn start(
    app: AppHandle,
    drive_id: &str,
    track_number: u32,
    source: impl CdPcmSource + 'static,
    session_guard: Option<DriveSessionGuard>,
    native: bool,
) -> Result<CdPlaybackStarted, String> {
    let output = native.then(|| crate::native_audio::global().clone());
    start_inner(
        Some(app),
        drive_id,
        track_number,
        source,
        session_guard,
        output,
    )
}

fn start_inner(
    app: Option<AppHandle>,
    drive_id: &str,
    track_number: u32,
    source: impl CdPcmSource + 'static,
    session_guard: Option<DriveSessionGuard>,
    native: Option<AudioOutput>,
) -> Result<CdPlaybackStarted, String> {
    {
        let mut sessions = SESSIONS.lock().expect("cd playback state poisoned");
        make_room_for_new_session(&mut sessions)?;
    }

    let duration_seconds = source.duration_seconds();
    let sample_rate = source.sample_rate();
    let channels = source.channels();
    let read_failed = source.read_failed_flag();
    let session_id = NEXT_SESSION_ID.fetch_add(1, Ordering::SeqCst);
    let stop_requested = Arc::new(AtomicBool::new(false));
    let is_playing = Arc::new(AtomicBool::new(false));
    let in_flight = Arc::new(InFlightTracker::new());
    let (cmd_tx, cmd_rx) = mpsc::channel::<PlaybackCommand>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

    let native_deck = match native.as_ref() {
        Some(output) => {
            Some(output.create_deck(channels as usize, sample_rate, NATIVE_RING_SECONDS)?)
        }
        None => None,
    };
    let native_control = native_deck
        .as_ref()
        .zip(native.as_ref())
        .map(|(deck, output)| NativeControl {
            deck_id: deck.id(),
            shared: Arc::clone(&deck.shared),
            output: output.clone(),
        });

    let thread = {
        let app = app.clone();
        let drive_id = drive_id.to_string();
        let stop_requested = Arc::clone(&stop_requested);
        let is_playing = Arc::clone(&is_playing);
        let in_flight = Arc::clone(&in_flight);
        thread::Builder::new()
            .name(format!("cd-playback-{session_id}"))
            .spawn(move || {
                if let Some(deck) = native_deck {
                    native_playback_thread(
                        app,
                        session_id,
                        drive_id,
                        track_number,
                        duration_seconds,
                        source,
                        read_failed,
                        deck,
                        stop_requested,
                        is_playing,
                        cmd_rx,
                        ready_tx,
                    );
                    return;
                }
                playback_thread(
                    app,
                    session_id,
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

    if let Err(err) = ready_rx
        .recv_timeout(ENGINE_START_TIMEOUT)
        .map_err(|_| "CD playback engine did not start".to_string())
        .and_then(|inner| inner)
    {
        stop_requested.store(true, Ordering::SeqCst);
        in_flight.reset();
        let _ = thread.join();
        return Err(err);
    }

    SESSIONS.lock().expect("cd playback state poisoned").insert(
        session_id,
        ActivePlayback {
            native: native_control,
            drive_id: drive_id.to_string(),
            stop_requested,
            is_playing,
            cmd_tx,
            in_flight,
            thread,
            started_at: Instant::now(),
            _session_guard: session_guard,
        },
    );

    Ok(CdPlaybackStarted {
        session_id,
        duration_seconds,
        sample_rate,
        channels,
    })
}

#[allow(clippy::too_many_arguments)]
fn playback_thread(
    app: Option<AppHandle>,
    session_id: u64,
    drive_id: String,
    track_number: u32,
    duration_seconds: f64,
    sample_rate: u32,
    channels: u16,
    mut source: impl CdPcmSource,
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
                frames_sent = (source.position_seconds() * sample_rate as f64).round() as u64;
            }
            emit_flush(app.as_ref(), session_id, &drive_id, track_number);
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

                if let Some(app) = app.as_ref() {
                    let pcm_bytes: Vec<u8> = chunk
                        .iter()
                        .flat_map(|sample| sample.to_le_bytes())
                        .collect();
                    let payload = CdPlaybackPcm {
                        session_id,
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
                } else {
                    // Without an AppHandle (tests), skip back-pressure — nothing will ack.
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
            let position_seconds = (frames_sent as f64 / sample_rate as f64).min(duration_seconds);
            if let Some(app) = app.as_ref() {
                let payload = CdPlaybackPosition {
                    session_id,
                    drive_id: drive_id.clone(),
                    track_number,
                    position_seconds,
                    duration_seconds,
                    is_playing: is_playing.load(Ordering::SeqCst),
                };
                if let Err(err) = app.emit(CD_PLAYBACK_POSITION_EVENT, payload) {
                    eprintln!("cd playback: position emit failed: {err}");
                }
            }
            last_position_emit = Instant::now();
        }
    }

    if stop_requested.load(Ordering::SeqCst) {
        return;
    }

    // Natural end: remove this session without joining (we are the thread).
    {
        let mut guard = SESSIONS.lock().expect("cd playback state poisoned");
        let _ = guard.remove(&session_id);
    }

    if read_failed.load(Ordering::SeqCst) {
        if let Some(app) = app.as_ref() {
            let payload = CdPlaybackError {
                session_id,
                drive_id,
                track_number,
                message: "Failed to read CD audio data".into(),
            };
            if let Err(err) = app.emit(CD_PLAYBACK_ERROR_EVENT, payload) {
                eprintln!("cd playback: error emit failed: {err}");
            }
        }
        return;
    }

    if let Some(app) = app.as_ref() {
        let payload = CdPlaybackEnded {
            session_id,
            drive_id,
            track_number,
        };
        if let Err(err) = app.emit(CD_PLAYBACK_ENDED_EVENT, payload) {
            eprintln!("cd playback: ended emit failed: {err}");
        }
    }
}

/// Decode thread for a session that plays through the native output (see the
/// file engine's counterpart). Position and the natural end come from what the
/// mixer actually played; a mid-track read failure surfaces as an error once the
/// audio already buffered has played out.
#[allow(clippy::too_many_arguments)]
fn native_playback_thread(
    app: Option<AppHandle>,
    session_id: u64,
    drive_id: String,
    track_number: u32,
    duration_seconds: f64,
    mut source: impl CdPcmSource,
    read_failed: Arc<AtomicBool>,
    mut deck: DeckHandle,
    stop_requested: Arc<AtomicBool>,
    is_playing: Arc<AtomicBool>,
    cmd_rx: mpsc::Receiver<PlaybackCommand>,
    ready_tx: mpsc::Sender<Result<(), String>>,
) {
    let channels = deck.channels;
    let rate = deck.src_rate as f64;
    let chunk_samples = CHUNK_FRAMES * channels;
    let mut chunk: Vec<f32> = Vec::with_capacity(chunk_samples);
    let mut decoder_done = false;
    let mut last_position_emit = Instant::now();

    let _ = ready_tx.send(Ok(()));

    loop {
        if stop_requested.load(Ordering::SeqCst) {
            return;
        }

        if let Ok(PlaybackCommand::Seek(first)) = cmd_rx.try_recv() {
            let mut latest = first;
            while let Ok(PlaybackCommand::Seek(next)) = cmd_rx.try_recv() {
                latest = next;
            }
            chunk.clear();
            if let Err(err) = source.seek_seconds(latest) {
                eprintln!("cd playback: seek failed: {err}");
            }
            // Clear `eos` before flushing so the callback cannot mistake the
            // emptied ring for the end of the track.
            deck.shared.eos.store(false, Ordering::Release);
            deck.flush();
            deck.shared
                .position_frames
                .store((source.position_seconds() * rate) as u64, Ordering::Relaxed);
            decoder_done = false;
        }

        let mut did_work = false;
        if !decoder_done {
            while chunk.len() < chunk_samples {
                match source.next_sample() {
                    Some(sample) => chunk.push(sample),
                    None => {
                        decoder_done = true;
                        break;
                    }
                }
            }
        }
        if !chunk.is_empty() && deck.free_samples() >= chunk.len() {
            for sample in chunk.drain(..) {
                let _ = deck.producer.push(sample);
            }
            did_work = true;
        }
        if decoder_done && chunk.is_empty() && !deck.shared.eos.load(Ordering::Relaxed) {
            deck.shared.eos.store(true, Ordering::Release);
        }

        if deck.shared.gapless_started.swap(false, Ordering::AcqRel) {
            is_playing.store(true, Ordering::SeqCst);
            if let Some(app) = app.as_ref() {
                let payload = CdPlaybackGaplessStarted {
                    session_id,
                    drive_id: drive_id.clone(),
                    track_number,
                };
                if let Err(err) = app.emit(CD_PLAYBACK_GAPLESS_STARTED_EVENT, payload) {
                    eprintln!("cd playback: gapless-started emit failed: {err}");
                }
            }
        }

        if deck.shared.finished.load(Ordering::Acquire) {
            break;
        }

        if last_position_emit.elapsed() >= POSITION_EVENT_INTERVAL {
            let position_seconds = (deck.shared.position_frames.load(Ordering::Relaxed) as f64
                / rate)
                .min(duration_seconds);
            if let Some(app) = app.as_ref() {
                let payload = CdPlaybackPosition {
                    session_id,
                    drive_id: drive_id.clone(),
                    track_number,
                    position_seconds,
                    duration_seconds,
                    is_playing: is_playing.load(Ordering::SeqCst),
                };
                if let Err(err) = app.emit(CD_PLAYBACK_POSITION_EVENT, payload) {
                    eprintln!("cd playback: position emit failed: {err}");
                }
            }
            last_position_emit = Instant::now();
        }

        if !did_work {
            thread::sleep(NATIVE_IDLE_SLEEP);
        }
    }

    if stop_requested.load(Ordering::SeqCst) {
        return;
    }

    {
        let mut guard = SESSIONS.lock().expect("cd playback state poisoned");
        let _ = guard.remove(&session_id);
    }

    let Some(app) = app.as_ref() else {
        return;
    };
    if read_failed.load(Ordering::SeqCst) {
        let payload = CdPlaybackError {
            session_id,
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
        session_id,
        drive_id,
        track_number,
    };
    if let Err(err) = app.emit(CD_PLAYBACK_ENDED_EVENT, payload) {
        eprintln!("cd playback: ended emit failed: {err}");
    }
}

pub fn pause(session_id: u64) {
    with_session(session_id, |active| {
        active.is_playing.store(false, Ordering::SeqCst);
        if let Some(native) = &active.native {
            native.shared.playing.store(false, Ordering::Relaxed);
        }
    });
}

pub fn resume(session_id: u64) {
    with_session(session_id, |active| {
        active.is_playing.store(true, Ordering::SeqCst);
        if let Some(native) = &active.native {
            native.shared.playing.store(true, Ordering::Relaxed);
            native.output.ensure_stream();
        }
    });
}

/// Set a native session's output gain (volume × mute × mix, 0–1).
pub fn set_gain(session_id: u64, gain: f32) {
    with_session(session_id, |active| {
        if let Some(native) = &active.native {
            native.shared.set_gain(gain);
        }
    });
}

/// Set a native session's stereo balance (-1 left … +1 right).
pub fn set_balance(session_id: u64, balance: f32) {
    with_session(session_id, |active| {
        if let Some(native) = &active.native {
            native.shared.set_balance(balance);
        }
    });
}

/// Fade a native session's output gain linearly.
pub fn ramp_gain(session_id: u64, from: f32, to: f32, duration_ms: u32) {
    with_session(session_id, |active| {
        if let Some(native) = &active.native {
            native.shared.ramp_gain(from, to, duration_ms);
        }
    });
}

/// Start `to_session` on the exact sample `from_session` runs out. Both must be
/// native CD sessions.
pub fn link_gapless(from_session: u64, to_session: u64) -> Result<(), String> {
    let sessions = SESSIONS.lock().expect("cd playback state poisoned");
    let (Some(from), Some(to)) = (sessions.get(&from_session), sessions.get(&to_session)) else {
        return Err("Gapless link needs two live sessions".into());
    };
    let (Some(from_native), Some(to_native)) = (&from.native, &to.native) else {
        return Err("Gapless link needs native sessions".into());
    };
    from_native
        .output
        .link_gapless(from_native.deck_id, to_native.deck_id)
}

pub fn seek(session_id: u64, seconds: f64) -> Result<(), String> {
    with_session(session_id, |active| {
        active.cmd_tx.send(PlaybackCommand::Seek(seconds))
    })
    .ok_or_else(|| "No CD track is playing".to_string())?
    .map_err(|_| "CD playback command channel closed".into())
}

pub fn ack_pcm_chunks(session_id: u64, count: u32) {
    with_session(session_id, |active| active.in_flight.ack(count));
}

pub fn stop(session_id: u64) {
    let taken = SESSIONS
        .lock()
        .expect("cd playback state poisoned")
        .remove(&session_id);
    if let Some(active) = taken {
        shutdown_active(active);
    }
}

/// Stop every CD session (tests / full teardown).
#[cfg(test)]
pub fn stop_all() {
    let sessions: Vec<ActivePlayback> = SESSIONS
        .lock()
        .expect("cd playback state poisoned")
        .drain()
        .map(|(_, active)| active)
        .collect();
    for active in sessions {
        shutdown_active(active);
    }
}

/// Stop playback only for sessions using the given drive (eject path).
pub fn stop_for_drive(drive_id: &str) {
    let taken: Vec<ActivePlayback> = {
        let mut guard = SESSIONS.lock().expect("cd playback state poisoned");
        let ids: Vec<u64> = guard
            .iter()
            .filter(|(_, active)| active.drive_id == drive_id)
            .map(|(id, _)| *id)
            .collect();
        ids.into_iter().filter_map(|id| guard.remove(&id)).collect()
    };
    for active in taken {
        shutdown_active(active);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// Engine sessions are process-global; serialize tests that mutate them.
    static TEST_LOCK: StdMutex<()> = StdMutex::new(());

    struct InterleavedFixture {
        channels: u16,
        sample_rate: u32,
        total_frames: u64,
        /// Absolute interleaved sample index.
        sample_index: u64,
        read_failed: Arc<AtomicBool>,
    }

    impl InterleavedFixture {
        fn new(duration_seconds: f64) -> Self {
            let sample_rate = 44100;
            let total_frames = (duration_seconds * sample_rate as f64).round().max(1.0) as u64;
            Self {
                channels: 2,
                sample_rate,
                total_frames,
                sample_index: 0,
                read_failed: Arc::new(AtomicBool::new(false)),
            }
        }

        fn total_samples(&self) -> u64 {
            self.total_frames * self.channels as u64
        }
    }

    impl CdPcmSource for InterleavedFixture {
        fn channels(&self) -> u16 {
            self.channels
        }

        fn sample_rate(&self) -> u32 {
            self.sample_rate
        }

        fn duration_seconds(&self) -> f64 {
            self.total_frames as f64 / self.sample_rate as f64
        }

        fn position_seconds(&self) -> f64 {
            (self.sample_index / self.channels as u64) as f64 / self.sample_rate as f64
        }

        fn read_failed_flag(&self) -> Arc<AtomicBool> {
            Arc::clone(&self.read_failed)
        }

        fn seek_seconds(&mut self, seconds: f64) -> Result<(), String> {
            let frame = (seconds * self.sample_rate as f64).round() as u64;
            self.sample_index = frame.min(self.total_frames) * self.channels as u64;
            Ok(())
        }

        fn next_sample(&mut self) -> Option<f32> {
            if self.sample_index >= self.total_samples() {
                return None;
            }
            self.sample_index += 1;
            Some(0.0)
        }
    }

    fn with_clean_sessions<R>(f: impl FnOnce() -> R) -> R {
        let _guard = TEST_LOCK.lock().expect("test lock poisoned");
        stop_all();
        let result = f();
        stop_all();
        result
    }

    fn fake_output() -> (
        AudioOutput,
        std::sync::Arc<crate::native_audio::output::fake::FakeState>,
    ) {
        use crate::native_audio::output::fake::{FakeFactory, FakeState};
        let state = FakeState::new(48_000);
        (
            AudioOutput::new(FakeFactory(std::sync::Arc::clone(&state))),
            state,
        )
    }

    fn native_position_frames(session_id: u64) -> u64 {
        with_session(session_id, |s| {
            s.native
                .as_ref()
                .expect("native session")
                .shared
                .position_frames
                .load(Ordering::Relaxed)
        })
        .unwrap_or(0)
    }

    fn pump_until(
        state: &crate::native_audio::output::fake::FakeState,
        what: &str,
        mut done: impl FnMut() -> bool,
    ) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            state.pump(240);
            if done() {
                return;
            }
            thread::sleep(Duration::from_millis(2));
        }
        panic!("timed out waiting for {what}");
    }

    #[test]
    fn native_cd_session_plays_through_to_natural_end() {
        with_clean_sessions(|| {
            let (output, state) = fake_output();
            let started = start_inner(
                None,
                "drive-a",
                1,
                InterleavedFixture::new(0.5),
                None,
                Some(output),
            )
            .expect("start");
            resume(started.session_id);
            pump_until(&state, "natural end", || {
                with_session(started.session_id, |_| ()).is_none()
            });
        });
    }

    #[test]
    fn native_cd_pause_freezes_position_and_seek_repositions() {
        with_clean_sessions(|| {
            let (output, state) = fake_output();
            let started = start_inner(
                None,
                "drive-a",
                1,
                InterleavedFixture::new(20.0),
                None,
                Some(output),
            )
            .expect("start");
            let id = started.session_id;
            resume(id);
            pump_until(&state, "audio", || native_position_frames(id) > 4000);

            pause(id);
            for _ in 0..4 {
                state.pump(240);
            }
            let frozen = native_position_frames(id);
            for _ in 0..4 {
                state.pump(240);
            }
            assert_eq!(native_position_frames(id), frozen, "paused");

            seek(id, 10.0).expect("seek");
            pump_until(&state, "seek applied", || {
                native_position_frames(id) >= 44100 * 10
            });
        });
    }

    #[test]
    fn native_cd_gapless_link_starts_the_next_track_when_the_first_ends() {
        with_clean_sessions(|| {
            let (output, state) = fake_output();
            let first = start_inner(
                None,
                "drive-a",
                1,
                InterleavedFixture::new(0.5),
                None,
                Some(output.clone()),
            )
            .expect("first");
            let second = start_inner(
                None,
                "drive-a",
                2,
                InterleavedFixture::new(5.0),
                None,
                Some(output),
            )
            .expect("second");

            link_gapless(first.session_id, second.session_id).expect("link");
            resume(first.session_id);
            pump_until(&state, "first to end", || {
                with_session(first.session_id, |_| ()).is_none()
            });
            pump_until(&state, "second audio", || {
                native_position_frames(second.session_id) > 0
            });
        });
    }

    #[test]
    fn native_cd_gain_and_balance_only_affect_native_sessions() {
        with_clean_sessions(|| {
            let legacy = start_inner(None, "drive-a", 1, InterleavedFixture::new(1.0), None, None)
                .expect("legacy");
            // No panic and no effect for a webview session.
            set_gain(legacy.session_id, 0.5);
            set_balance(legacy.session_id, -1.0);
            ramp_gain(legacy.session_id, 0.0, 1.0, 100);
            assert!(link_gapless(legacy.session_id, legacy.session_id).is_err());

            let (output, _state) = fake_output();
            let native = start_inner(
                None,
                "drive-a",
                2,
                InterleavedFixture::new(1.0),
                None,
                Some(output),
            )
            .expect("native");
            set_gain(native.session_id, 0.25);
            set_balance(native.session_id, 0.5);
            let (gain, balance) = with_session(native.session_id, |s| {
                let shared = &s.native.as_ref().expect("native").shared;
                (shared.gain(), shared.balance())
            })
            .expect("session");
            assert_eq!(gain, 0.25);
            assert_eq!(balance, 0.5);
        });
    }

    #[test]
    fn stopping_a_drive_releases_its_native_decks() {
        with_clean_sessions(|| {
            let (output, _state) = fake_output();
            for track in 1..=2 {
                start_inner(
                    None,
                    "drive-a",
                    track,
                    InterleavedFixture::new(5.0),
                    None,
                    Some(output.clone()),
                )
                .expect("start");
            }
            stop_for_drive("drive-a");
            // Both deck slots are free again.
            assert!(output.create_deck(2, 44_100, 0.1).is_ok());
            assert!(output.create_deck(2, 44_100, 0.1).is_ok());
        });
    }

    #[test]
    fn two_sessions_can_run_side_by_side() {
        with_clean_sessions(|| {
            let a = start_inner(None, "drive-a", 1, InterleavedFixture::new(1.0), None, None)
                .expect("start A");
            let b = start_inner(None, "drive-a", 2, InterleavedFixture::new(1.0), None, None)
                .expect("start B");
            assert_ne!(a.session_id, b.session_id);

            assert!(with_session(a.session_id, |_| ()).is_some());
            assert!(with_session(b.session_id, |_| ()).is_some());

            stop(a.session_id);
            assert!(
                with_session(a.session_id, |_| ()).is_none(),
                "session A should be gone"
            );
            assert!(
                with_session(b.session_id, |_| ()).is_some(),
                "session B should remain after A stops"
            );
            seek(b.session_id, 0.0).expect("seek B after A stopped");
        });
    }

    #[test]
    fn stop_one_session_does_not_stop_the_other() {
        with_clean_sessions(|| {
            let a = start_inner(None, "drive-a", 1, InterleavedFixture::new(1.0), None, None)
                .expect("start A");
            let b = start_inner(None, "drive-a", 2, InterleavedFixture::new(1.0), None, None)
                .expect("start B");

            pause(a.session_id);
            pause(b.session_id);
            seek(a.session_id, 0.0).expect("seek A");
            ack_pcm_chunks(a.session_id, 1);

            assert!(with_session(b.session_id, |_| ()).is_some());
            stop(a.session_id);
            assert!(with_session(b.session_id, |_| ()).is_some());
            seek(b.session_id, 0.0).expect("seek B after A stopped");
        });
    }

    #[test]
    fn stop_for_drive_stops_all_sessions_on_that_drive() {
        with_clean_sessions(|| {
            let a = start_inner(None, "drive-a", 1, InterleavedFixture::new(1.0), None, None)
                .expect("start A");
            let b = start_inner(None, "drive-a", 2, InterleavedFixture::new(1.0), None, None)
                .expect("start B");

            stop_for_drive("drive-a");
            assert!(with_session(a.session_id, |_| ()).is_none());
            assert!(with_session(b.session_id, |_| ()).is_none());

            let c = start_inner(None, "drive-b", 1, InterleavedFixture::new(1.0), None, None)
                .expect("start C");
            stop_for_drive("drive-a");
            assert!(
                with_session(c.session_id, |_| ()).is_some(),
                "other drive session should remain"
            );
        });
    }

    #[test]
    fn third_session_evicts_oldest_idle() {
        with_clean_sessions(|| {
            let a = start_inner(None, "drive-a", 1, InterleavedFixture::new(1.0), None, None)
                .expect("start A");
            thread::sleep(Duration::from_millis(5));
            let b = start_inner(None, "drive-a", 2, InterleavedFixture::new(1.0), None, None)
                .expect("start B");

            let c = start_inner(None, "drive-a", 3, InterleavedFixture::new(1.0), None, None)
                .expect("start C");
            assert!(with_session(a.session_id, |_| ()).is_none());
            assert!(with_session(b.session_id, |_| ()).is_some());
            assert!(with_session(c.session_id, |_| ()).is_some());
        });
    }

    #[test]
    fn third_session_fails_when_both_playing() {
        with_clean_sessions(|| {
            let a = start_inner(None, "drive-a", 1, InterleavedFixture::new(1.0), None, None)
                .expect("start A");
            let b = start_inner(None, "drive-a", 2, InterleavedFixture::new(1.0), None, None)
                .expect("start B");

            with_session(a.session_id, |s| s.is_playing.store(true, Ordering::SeqCst));
            with_session(b.session_id, |s| s.is_playing.store(true, Ordering::SeqCst));

            let err = start_inner(None, "drive-a", 3, InterleavedFixture::new(1.0), None, None)
                .expect_err("third should fail");
            assert!(
                err.contains("Maximum concurrent"),
                "unexpected error: {err}"
            );
        });
    }

    #[test]
    fn pick_eviction_victim_prefers_oldest_idle() {
        let t0 = Instant::now();
        let t1 = t0 + Duration::from_millis(10);
        let sessions = [(1u64, false, t0), (2u64, false, t1)];
        assert_eq!(
            pick_eviction_victim(&sessions, 2),
            EvictionDecision::Evict(1)
        );

        let both_playing = [(1u64, true, t0), (2u64, true, t1)];
        assert_eq!(
            pick_eviction_victim(&both_playing, 2),
            EvictionDecision::Full
        );

        assert_eq!(
            pick_eviction_victim(&[(1u64, true, t0)], 2),
            EvictionDecision::HasRoom
        );
    }
}
