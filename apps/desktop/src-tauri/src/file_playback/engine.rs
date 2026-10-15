//! File PCM playback engine: library audio → f32 stream to frontend.
//!
//! Supports up to [`MAX_SESSIONS`] concurrent decode sessions so two tracks can
//! overlap for crossfade.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter};

use super::decoder::StreamingDecoder;
use crate::native_audio::mixer::DeckShared;
use crate::native_audio::{AudioOutput, DeckHandle};

pub const FILE_PLAYBACK_POSITION_EVENT: &str = "file-playback-position";
pub const FILE_PLAYBACK_ENDED_EVENT: &str = "file-playback-ended";
pub const FILE_PLAYBACK_FLUSH_EVENT: &str = "file-playback-flush";

/// Raw interleaved little-endian f32 PCM chunks, delivered over a Tauri
/// channel. Events would inline every chunk into a unique `eval` script
/// (base64 inside JS source); the channel hands the webview an `ArrayBuffer`.
pub type PcmChannel = Channel<Response>;

/// Outgoing + incoming decks during crossfade.
const MAX_SESSIONS: usize = 2;

/// ~2s+ of 2048-frame chunks at 48kHz so the worklet read-ahead can fill.
/// macOS window minimize stalls main-thread PCM event delivery long enough to
/// drain a 0.5s cushion (audible underrun at minimize-complete); pack-install
/// IPC stalls were already ~460ms.
const MAX_CHUNKS_IN_FLIGHT: usize = 64;

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
pub struct FilePlaybackFlush {
    pub session_id: u64,
}

/// Seconds of source audio the native output ring holds ahead of the device.
const NATIVE_RING_SECONDS: f64 = 2.0;
/// Decode-thread nap when the native ring is full or the stream is done.
const NATIVE_IDLE_SLEEP: Duration = Duration::from_millis(5);

const POSITION_EVENT_INTERVAL: Duration = Duration::from_millis(250);
const ENGINE_START_TIMEOUT: Duration = Duration::from_secs(10);
const CHUNK_FRAMES: usize = 2048;

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

/// Control surface for a session that plays through the native output.
struct NativeControl {
    shared: Arc<DeckShared>,
    output: AudioOutput,
}

struct ActivePlayback {
    native: Option<NativeControl>,
    stop_requested: Arc<AtomicBool>,
    is_playing: Arc<AtomicBool>,
    cmd_tx: mpsc::Sender<PlaybackCommand>,
    in_flight: Arc<InFlightTracker>,
    thread: thread::JoinHandle<()>,
    started_at: Instant,
}

fn shutdown_active(active: ActivePlayback) {
    active.stop_requested.store(true, Ordering::SeqCst);
    active.is_playing.store(false, Ordering::SeqCst);
    active.in_flight.reset();
    if let Err(err) = active.thread.join() {
        eprintln!("file playback: thread join failed: {err:?}");
    }
}

static SESSIONS: LazyLock<Mutex<HashMap<u64, ActivePlayback>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn with_session<R>(session_id: u64, f: impl FnOnce(&ActivePlayback) -> R) -> Option<R> {
    let guard = SESSIONS.lock().expect("file playback state poisoned");
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
        EvictionDecision::Full => Err("Maximum concurrent file playback sessions reached".into()),
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

fn emit_flush(app: Option<&AppHandle>, session_id: u64) {
    let Some(app) = app else {
        return;
    };
    let payload = FilePlaybackFlush { session_id };
    if let Err(err) = app.emit(FILE_PLAYBACK_FLUSH_EVENT, payload) {
        eprintln!("file playback: flush emit failed: {err}");
    }
}

fn emit_event<T: Serialize + Clone>(app: Option<&AppHandle>, event: &str, payload: T) {
    let Some(app) = app else {
        return;
    };
    if let Err(err) = app.emit(event, payload) {
        eprintln!("file playback: {event} emit failed: {err}");
    }
}

/// Start a paused session. With `native` set, audio is mixed in Rust and played
/// through the OS audio API; otherwise PCM is streamed to the webview over `pcm`.
pub fn start(
    app: AppHandle,
    path: &str,
    pcm: Option<PcmChannel>,
    native: bool,
) -> Result<FilePlaybackStarted, String> {
    let output = native.then(|| crate::native_audio::global().clone());
    start_inner(Some(app), path, pcm, output)
}

fn start_inner(
    app: Option<AppHandle>,
    path: &str,
    pcm: Option<PcmChannel>,
    native: Option<AudioOutput>,
) -> Result<FilePlaybackStarted, String> {
    let file_path = PathBuf::from(path);
    if !file_path.is_file() {
        return Err(format!("File not found: {path}"));
    }

    let ext = file_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if !matches!(
        ext.as_str(),
        "ogg" | "opus" | "m4a" | "mp4" | "aac" | "mp3" | "flac" | "wav"
    ) {
        return Err(format!(
            "Native PCM playback is not supported for .{ext} files"
        ));
    }

    {
        let mut sessions = SESSIONS.lock().expect("file playback state poisoned");
        make_room_for_new_session(&mut sessions)?;
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
            shared: Arc::clone(&deck.shared),
            output: output.clone(),
        });

    let thread = {
        let app = app.clone();
        let stop_requested = Arc::clone(&stop_requested);
        let is_playing = Arc::clone(&is_playing);
        let in_flight = Arc::clone(&in_flight);
        thread::Builder::new()
            .name(format!("file-playback-{session_id}"))
            .spawn(move || {
                if let Some(deck) = native_deck {
                    native_playback_thread(
                        app,
                        session_id,
                        duration_seconds,
                        source,
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
                    pcm,
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

    if let Err(err) = ready_rx
        .recv_timeout(ENGINE_START_TIMEOUT)
        .map_err(|_| "File playback engine did not start".to_string())
        .and_then(|inner| inner)
    {
        stop_requested.store(true, Ordering::SeqCst);
        in_flight.reset();
        let _ = thread.join();
        return Err(err);
    }

    SESSIONS
        .lock()
        .expect("file playback state poisoned")
        .insert(
            session_id,
            ActivePlayback {
                native: native_control,
                stop_requested,
                is_playing,
                cmd_tx,
                in_flight,
                thread,
                started_at: Instant::now(),
            },
        );

    Ok(FilePlaybackStarted {
        session_id,
        duration_seconds,
        sample_rate,
        channels,
    })
}

#[allow(clippy::too_many_arguments)]
fn playback_thread(
    app: Option<AppHandle>,
    pcm: Option<PcmChannel>,
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
            // Coalesce rapid scrubs to the latest target.
            let mut latest = seconds;
            while let Ok(PlaybackCommand::Seek(next)) = cmd_rx.try_recv() {
                latest = next;
            }
            if let Err(err) = source.seek_seconds(latest) {
                eprintln!("file playback: seek failed: {err}");
            }
            emit_flush(app.as_ref(), session_id);
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

                if let Some(pcm) = pcm.as_ref() {
                    let pcm_bytes: Vec<u8> = chunk
                        .iter()
                        .flat_map(|sample| sample.to_le_bytes())
                        .collect();
                    if let Err(err) = pcm.send(Response::new(pcm_bytes)) {
                        eprintln!("file playback: pcm send failed: {err}");
                    } else {
                        in_flight.chunk_sent();
                    }
                }
                // Without a channel (tests), skip back-pressure — nothing will ack.
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
            emit_event(app.as_ref(), FILE_PLAYBACK_POSITION_EVENT, payload);
            last_position_emit = Instant::now();
        }
    }

    if stop_requested.load(Ordering::SeqCst) {
        return;
    }

    // Natural end: remove this session without joining (we are the thread).
    {
        let mut guard = SESSIONS.lock().expect("file playback state poisoned");
        let _ = guard.remove(&session_id);
    }

    emit_event(
        app.as_ref(),
        FILE_PLAYBACK_ENDED_EVENT,
        FilePlaybackEnded { session_id },
    );
}

/// Decode thread for a session that plays through the native output: keeps the
/// deck ring topped up (whether or not playing, so resume and seek are instant)
/// and reports position and natural end from what the mixer actually played.
#[allow(clippy::too_many_arguments)]
fn native_playback_thread(
    app: Option<AppHandle>,
    session_id: u64,
    duration_seconds: f64,
    mut source: StreamingDecoder,
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
            // Coalesce rapid scrubs to the latest target.
            let mut latest = first;
            while let Ok(PlaybackCommand::Seek(next)) = cmd_rx.try_recv() {
                latest = next;
            }
            chunk.clear();
            if let Err(err) = source.seek_seconds(latest) {
                eprintln!("file playback: seek failed: {err}");
            }
            // Clear `eos` first: with it still set, a callback landing between
            // the flush and the next push would see an empty ring and call the
            // stream finished.
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

        if deck.shared.finished.load(Ordering::Acquire) {
            break;
        }

        if last_position_emit.elapsed() >= POSITION_EVENT_INTERVAL {
            let position_seconds = (deck.shared.position_frames.load(Ordering::Relaxed) as f64
                / rate)
                .min(duration_seconds);
            emit_event(
                app.as_ref(),
                FILE_PLAYBACK_POSITION_EVENT,
                FilePlaybackPosition {
                    session_id,
                    position_seconds,
                    duration_seconds,
                    is_playing: is_playing.load(Ordering::SeqCst),
                },
            );
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
        let mut guard = SESSIONS.lock().expect("file playback state poisoned");
        let _ = guard.remove(&session_id);
    }
    emit_event(
        app.as_ref(),
        FILE_PLAYBACK_ENDED_EVENT,
        FilePlaybackEnded { session_id },
    );
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

/// Set a native session's output gain (volume × mute, 0–1). No-op for sessions
/// that play through the webview.
pub fn set_gain(session_id: u64, gain: f32) {
    with_session(session_id, |active| {
        if let Some(native) = &active.native {
            native.shared.set_gain(gain);
        }
    });
}

pub fn seek(session_id: u64, seconds: f64) -> Result<(), String> {
    with_session(session_id, |active| {
        // Unblock `wait_for_capacity` so the playback thread can drain this
        // Seek. With a deep read-ahead the worklet stops acking while full, so
        // seeks otherwise sit in the channel for hundreds of ms–seconds.
        active.in_flight.reset();
        active.cmd_tx.send(PlaybackCommand::Seek(seconds))
    })
    .ok_or_else(|| "No file is playing".to_string())?
    .map_err(|_| "File playback command channel closed".into())
}

pub fn ack_pcm_chunks(session_id: u64, count: u32) {
    with_session(session_id, |active| active.in_flight.ack(count));
}

pub fn stop(session_id: u64) {
    let taken = SESSIONS
        .lock()
        .expect("file playback state poisoned")
        .remove(&session_id);
    if let Some(active) = taken {
        shutdown_active(active);
    }
}

#[cfg(test)]
pub fn stop_all() {
    let sessions: Vec<ActivePlayback> = SESSIONS
        .lock()
        .expect("file playback state poisoned")
        .drain()
        .map(|(_, active)| active)
        .collect();
    for active in sessions {
        shutdown_active(active);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures::{flac, ogg};
    use std::sync::Mutex as StdMutex;
    use std::thread;
    use std::time::Duration;

    /// Engine sessions are process-global; serialize tests that mutate them.
    static TEST_LOCK: StdMutex<()> = StdMutex::new(());

    fn fixture_paths() -> (String, String) {
        (
            ogg::minimal_fixture_path()
                .to_str()
                .expect("ogg fixture path")
                .to_string(),
            flac::minimal_fixture_path()
                .to_str()
                .expect("flac fixture path")
                .to_string(),
        )
    }

    fn with_clean_sessions<R>(f: impl FnOnce() -> R) -> R {
        let _guard = TEST_LOCK.lock().expect("test lock poisoned");
        stop_all();
        let result = f();
        stop_all();
        result
    }

    #[test]
    fn two_sessions_can_run_side_by_side() {
        with_clean_sessions(|| {
            let (ogg_path, flac_path) = fixture_paths();
            let a = start_inner(None, &ogg_path, None, None).expect("start ogg");
            let b = start_inner(None, &flac_path, None, None).expect("start flac");
            assert_ne!(a.session_id, b.session_id);

            assert!(with_session(a.session_id, |_| ()).is_some());
            assert!(with_session(b.session_id, |_| ()).is_some());

            // Decode both fixtures on separate threads while sessions stay registered.
            // Keep engine sessions paused: without an AppHandle there is no
            // back-pressure, so resume would natural-end tiny fixtures instantly.
            let ogg_path_clone = ogg_path.clone();
            let flac_path_clone = flac_path.clone();
            let handle_a = thread::spawn(move || {
                let mut decoder =
                    StreamingDecoder::open(std::path::Path::new(&ogg_path_clone)).expect("ogg");
                let mut n = 0usize;
                while decoder.next_sample().is_some() {
                    n += 1;
                }
                n
            });
            let handle_b = thread::spawn(move || {
                let mut decoder =
                    StreamingDecoder::open(std::path::Path::new(&flac_path_clone)).expect("flac");
                let mut n = 0usize;
                while decoder.next_sample().is_some() {
                    n += 1;
                }
                n
            });
            assert!(handle_a.join().expect("ogg join") > 0);
            assert!(handle_b.join().expect("flac join") > 0);

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
            let (ogg_path, flac_path) = fixture_paths();
            let a = start_inner(None, &ogg_path, None, None).expect("start ogg");
            let b = start_inner(None, &flac_path, None, None).expect("start flac");

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
    fn third_session_evicts_oldest_idle() {
        with_clean_sessions(|| {
            let (ogg_path, flac_path) = fixture_paths();
            let a = start_inner(None, &ogg_path, None, None).expect("start A");
            thread::sleep(Duration::from_millis(5));
            let b = start_inner(None, &flac_path, None, None).expect("start B");

            // Both idle (paused). Starting C should evict oldest (A).
            let c = start_inner(None, &ogg_path, None, None).expect("start C");
            assert!(with_session(a.session_id, |_| ()).is_none());
            assert!(with_session(b.session_id, |_| ()).is_some());
            assert!(with_session(c.session_id, |_| ()).is_some());
        });
    }

    #[test]
    fn third_session_fails_when_both_playing() {
        with_clean_sessions(|| {
            let (ogg_path, flac_path) = fixture_paths();
            let a = start_inner(None, &ogg_path, None, None).expect("start A");
            let b = start_inner(None, &flac_path, None, None).expect("start B");

            // Mark both playing without resuming decode (short fixtures would
            // natural-end immediately). Eviction only inspects the flag.
            with_session(a.session_id, |s| s.is_playing.store(true, Ordering::SeqCst));
            with_session(b.session_id, |s| s.is_playing.store(true, Ordering::SeqCst));

            let err = start_inner(None, &ogg_path, None, None).expect_err("third should fail");
            assert!(
                err.contains("Maximum concurrent"),
                "unexpected error: {err}"
            );
        });
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
    fn native_session_plays_through_to_natural_end() {
        with_clean_sessions(|| {
            let (ogg_path, _) = fixture_paths();
            let (output, state) = fake_output();
            let started = start_inner(None, &ogg_path, None, Some(output)).expect("start");
            resume(started.session_id);

            pump_until(&state, "natural end", || {
                with_session(started.session_id, |_| ()).is_none()
            });
        });
    }

    #[test]
    fn native_pause_freezes_position_and_resume_continues() {
        with_clean_sessions(|| {
            let (_, flac_path) = fixture_paths();
            let (output, state) = fake_output();
            let started = start_inner(None, &flac_path, None, Some(output)).expect("start");
            let id = started.session_id;
            resume(id);
            pump_until(&state, "audio", || native_position_frames(id) > 0);

            pause(id);
            // Let the fade-out finish, then the position must hold still.
            for _ in 0..4 {
                state.pump(240);
            }
            let frozen = native_position_frames(id);
            for _ in 0..4 {
                state.pump(240);
            }
            assert_eq!(native_position_frames(id), frozen);

            resume(id);
            pump_until(&state, "resumed audio", || {
                native_position_frames(id) > frozen
            });
        });
    }

    #[test]
    fn native_seek_flushes_and_repositions() {
        with_clean_sessions(|| {
            let (_, flac_path) = fixture_paths();
            let (output, state) = fake_output();
            let started = start_inner(None, &flac_path, None, Some(output)).expect("start");
            let id = started.session_id;
            resume(id);
            pump_until(&state, "audio", || native_position_frames(id) > 2000);
            pause(id);
            for _ in 0..4 {
                state.pump(240);
            }

            seek(id, 0.0).expect("seek");
            let deadline = Instant::now() + Duration::from_secs(5);
            while native_position_frames(id) > 100 && Instant::now() < deadline {
                state.pump(240);
                thread::sleep(Duration::from_millis(5));
            }
            assert!(
                native_position_frames(id) <= 100,
                "position reset by seek: {}",
                native_position_frames(id)
            );
        });
    }

    #[test]
    fn native_gain_is_applied_to_output() {
        with_clean_sessions(|| {
            let (_, flac_path) = fixture_paths();
            let (output, state) = fake_output();
            let started = start_inner(None, &flac_path, None, Some(output)).expect("start");
            let id = started.session_id;
            set_gain(id, 0.0);
            resume(id);
            pump_until(&state, "audio", || native_position_frames(id) > 2000);
            // Gain smoothing settles well within a few thousand frames.
            let silent = state.pump(480).expect("callback");
            assert!(
                silent.iter().all(|s| s.abs() < 1e-3),
                "muted output is silent"
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
