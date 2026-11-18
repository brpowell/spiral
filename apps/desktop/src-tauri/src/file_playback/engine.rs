//! Library file playback: decodes a file and feeds the native audio output.
//!
//! Each session owns a decode thread that keeps a ring of PCM topped up for its
//! mixer deck, whether or not it is playing, so resume and seek are instant.
//! Up to [`MAX_SESSIONS`] sessions run at once so two tracks can overlap for
//! gapless handoff and crossfade. Position, natural end and gapless starts
//! reach the frontend as Tauri events.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::decoder::StreamingDecoder;
use crate::fs_probe::{self, Probed};
use crate::native_audio::mixer::DeckShared;
use crate::native_audio::{AudioOutput, DeckHandle};

pub const FILE_PLAYBACK_POSITION_EVENT: &str = "file-playback-position";
pub const FILE_PLAYBACK_ENDED_EVENT: &str = "file-playback-ended";
/// A session's file stopped answering mid-track (a dropped network share):
/// playback can't go on. Payload: [`FilePlaybackError`].
pub const FILE_PLAYBACK_ERROR_EVENT: &str = "file-playback-error";
/// A session began playing on its own (gapless splice from another session).
pub const FILE_PLAYBACK_GAPLESS_STARTED_EVENT: &str = "file-playback-gapless-started";

/// Outgoing + incoming decks during crossfade.
const MAX_SESSIONS: usize = 2;

/// Seconds of source audio the output ring holds ahead of the device. Rides out
/// main-thread stalls (window minimise, pack installs) without an underrun.
/// Keep in step with `FILE_READ_AHEAD_SECONDS` in `canCrossfade.ts`.
const RING_SECONDS: f64 = 2.0;
/// How long opening a file may take. A file on a network share that dropped
/// doesn't fail to open, it blocks, and nothing else can wait on that.
const OPEN_TIMEOUT: Duration = Duration::from_secs(10);
/// How long stopping a session waits for its decode thread. A thread stuck
/// reading a dead share can't see the stop request; it is left to finish (and
/// then exit) on its own rather than blocking whoever stopped it.
const STOP_WAIT: Duration = Duration::from_secs(2);
/// A decode thread that hasn't come round its loop for this long is stuck on a
/// read. The ring only holds [`RING_SECONDS`], so the audio has stopped by then.
const STALL_AFTER: Duration = Duration::from_secs(5);
/// How often the watchdog looks for stuck decode threads.
const WATCHDOG_TICK: Duration = Duration::from_millis(500);
/// Decode-thread nap when the ring is full or the stream is done.
const IDLE_SLEEP: Duration = Duration::from_millis(5);
const POSITION_EVENT_INTERVAL: Duration = Duration::from_millis(250);
const CHUNK_FRAMES: usize = 2048;

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
pub struct FilePlaybackError {
    pub session_id: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlaybackEnded {
    pub session_id: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlaybackGaplessStarted {
    pub session_id: u64,
}

enum PlaybackCommand {
    Seek(f64),
}

/// Control surface for a session's mixer deck.
struct DeckControl {
    deck_id: u64,
    shared: Arc<DeckShared>,
    output: AudioOutput,
}

struct ActivePlayback {
    control: DeckControl,
    stop_requested: Arc<AtomicBool>,
    cmd_tx: mpsc::Sender<PlaybackCommand>,
    thread: thread::JoinHandle<()>,
    started_at: Instant,
    /// When the decode thread last came round its loop (see [`now_ms`]).
    heartbeat: Arc<AtomicU64>,
    app: Option<AppHandle>,
    path: String,
    /// Source sample rate and length, to turn the deck's frame counter into seconds on demand.
    rate: f64,
    duration_seconds: f64,
}

impl ActivePlayback {
    fn is_playing(&self) -> bool {
        self.control.shared.playing.load(Ordering::Relaxed)
    }
}

fn shutdown_active(active: ActivePlayback) {
    active.stop_requested.store(true, Ordering::SeqCst);
    active
        .control
        .shared
        .playing
        .store(false, Ordering::Relaxed);
    if !join_within(active.thread, STOP_WAIT) {
        eprintln!("file playback: decode thread is stuck on a read; leaving it to finish");
    }
}

/// Join `thread`, giving up (and leaving it running) after `wait`. Whether it
/// finished.
fn join_within(thread: thread::JoinHandle<()>, wait: Duration) -> bool {
    let deadline = Instant::now() + wait;
    while !thread.is_finished() {
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(2));
    }
    if let Err(err) = thread.join() {
        eprintln!("file playback: thread join failed: {err:?}");
    }
    true
}

static SESSIONS: LazyLock<Mutex<HashMap<u64, ActivePlayback>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn with_session<R>(session_id: u64, f: impl FnOnce(&ActivePlayback) -> R) -> Option<R> {
    let guard = SESSIONS.lock().expect("file playback state poisoned");
    guard.get(&session_id).map(f)
}

/// Evict the oldest idle (not playing) session when at capacity, returning it
/// for the caller to shut down once it has let go of [`SESSIONS`] (shutting
/// down can wait on a stuck decode thread). An error if both slots are
/// occupied by playing sessions.
fn make_room_for_new_session(
    sessions: &mut HashMap<u64, ActivePlayback>,
) -> Result<Option<ActivePlayback>, String> {
    if sessions.len() < MAX_SESSIONS {
        return Ok(None);
    }

    let snapshot: Vec<(u64, bool, Instant)> = sessions
        .iter()
        .map(|(id, session)| (*id, session.is_playing(), session.started_at))
        .collect();

    match pick_eviction_victim(&snapshot, MAX_SESSIONS) {
        EvictionDecision::HasRoom => Ok(None),
        EvictionDecision::Evict(id) => Ok(sessions.remove(&id)),
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

fn emit_event<T: Serialize + Clone>(app: Option<&AppHandle>, event: &str, payload: T) {
    let Some(app) = app else {
        return;
    };
    if let Err(err) = app.emit(event, payload) {
        eprintln!("file playback: {event} emit failed: {err}");
    }
}

/// The error for a file whose folder doesn't answer (a dropped network share).
fn not_responding(path: &str) -> String {
    format!(
        "{}: {path} is not responding; check the connection to its folder",
        crate::sources::SOURCE_UNAVAILABLE
    )
}

/// Start a paused session that plays through the native audio output.
pub fn start(app: AppHandle, path: &str) -> Result<FilePlaybackStarted, String> {
    start_inner(Some(app), path, crate::native_audio::global().clone())
}

fn start_inner(
    app: Option<AppHandle>,
    path: &str,
    output: AudioOutput,
) -> Result<FilePlaybackStarted, String> {
    let file_path = PathBuf::from(path);
    match fs_probe::probe_file(&file_path) {
        Probed::Yes => {}
        Probed::No => return Err(format!("File not found: {path}")),
        Probed::Stalled => return Err(not_responding(path)),
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

    let evicted = {
        let mut sessions = SESSIONS.lock().expect("file playback state poisoned");
        make_room_for_new_session(&mut sessions)?
    };
    if let Some(active) = evicted {
        shutdown_active(active);
    }
    start_watchdog();

    let open_path = file_path.clone();
    let source = fs_probe::run_within(OPEN_TIMEOUT, move || StreamingDecoder::open(&open_path))
        .ok_or_else(|| not_responding(path))?
        .map_err(|err| {
            // Opening timed out or the share is down: say it the one way.
            if err.starts_with(crate::sources::SOURCE_UNAVAILABLE) {
                not_responding(path)
            } else {
                err
            }
        })?;
    let duration_seconds = source.duration_seconds();
    let sample_rate = source.sample_rate();
    let channels = source.channels();
    let session_id = NEXT_SESSION_ID.fetch_add(1, Ordering::SeqCst);

    let deck = output.create_deck(channels as usize, sample_rate, RING_SECONDS)?;
    let control = DeckControl {
        deck_id: deck.id(),
        shared: Arc::clone(&deck.shared),
        output,
    };
    let stop_requested = Arc::new(AtomicBool::new(false));
    let (cmd_tx, cmd_rx) = mpsc::channel::<PlaybackCommand>();
    let rate = deck.src_rate as f64;
    let heartbeat = Arc::new(AtomicU64::new(now_ms()));

    let thread = {
        let stop_requested = Arc::clone(&stop_requested);
        let heartbeat = Arc::clone(&heartbeat);
        let app = app.clone();
        let thread_path = path.to_string();
        thread::Builder::new()
            .name(format!("file-playback-{session_id}"))
            .spawn(move || {
                playback_thread(
                    app,
                    session_id,
                    duration_seconds,
                    source,
                    deck,
                    stop_requested,
                    cmd_rx,
                    heartbeat,
                    thread_path,
                );
            })
            .map_err(|err| format!("Failed to start file playback thread: {err}"))?
    };

    SESSIONS
        .lock()
        .expect("file playback state poisoned")
        .insert(
            session_id,
            ActivePlayback {
                control,
                stop_requested,
                cmd_tx,
                thread,
                started_at: Instant::now(),
                heartbeat,
                app,
                path: path.to_string(),
                rate,
                duration_seconds,
            },
        );

    Ok(FilePlaybackStarted {
        session_id,
        duration_seconds,
        sample_rate,
        channels,
    })
}

/// Milliseconds on a clock shared by the decode threads and the watchdog.
fn now_ms() -> u64 {
    static START: LazyLock<Instant> = LazyLock::new(Instant::now);
    START.elapsed().as_millis() as u64
}

/// Sessions whose decode thread hasn't come round its loop for
/// [`STALL_AFTER`] as of `now`: what to tell the frontend.
///
/// Each is ended here, not left for the frontend to stop: it lets go of a
/// session once it's told it failed. Its deck goes quiet and its thread is
/// asked to stop; the thread can't see that until its read returns, which may
/// be when the share is back, and must not play on then.
fn take_stalled(
    sessions: &mut HashMap<u64, ActivePlayback>,
    now: u64,
) -> Vec<(Option<AppHandle>, FilePlaybackError)> {
    let stalled: Vec<u64> = sessions
        .iter()
        .filter(|(_, active)| {
            now.saturating_sub(active.heartbeat.load(Ordering::Relaxed))
                >= STALL_AFTER.as_millis() as u64
        })
        .map(|(&id, _)| id)
        .collect();
    stalled
        .into_iter()
        .filter_map(|session_id| {
            let active = sessions.remove(&session_id)?;
            active.stop_requested.store(true, Ordering::SeqCst);
            active
                .control
                .shared
                .playing
                .store(false, Ordering::Relaxed);
            // Dropping the handle leaves the thread to exit on its own.
            Some((
                active.app,
                FilePlaybackError {
                    session_id,
                    message: not_responding(&active.path),
                },
            ))
        })
        .collect()
}

/// Watch for decode threads stuck on a read (a file on a network share that
/// dropped). Such a thread can't report anything itself, and without this the
/// track just goes quiet with nothing to say why.
fn start_watchdog() {
    // Tests drive `take_stalled` themselves.
    if cfg!(test) {
        return;
    }
    static STARTED: std::sync::Once = std::sync::Once::new();
    STARTED.call_once(|| {
        let spawned = thread::Builder::new()
            .name("file-playback-watchdog".into())
            .spawn(|| {
                let mut last_tick = now_ms();
                loop {
                    thread::sleep(WATCHDOG_TICK);
                    let now = now_ms();
                    // After the computer slept, every heartbeat is old: let
                    // the decode threads come round once before judging.
                    let slept =
                        now.saturating_sub(last_tick) > 4 * WATCHDOG_TICK.as_millis() as u64;
                    last_tick = now;
                    if slept {
                        continue;
                    }
                    let stalled = {
                        let mut sessions = SESSIONS.lock().expect("file playback state poisoned");
                        take_stalled(&mut sessions, now)
                    };
                    for (app, error) in stalled {
                        eprintln!("file playback: {}", error.message);
                        emit_event(app.as_ref(), FILE_PLAYBACK_ERROR_EVENT, error);
                    }
                }
            });
        if let Err(err) = spawned {
            eprintln!("file playback: can't start the watchdog: {err}");
        }
    });
}

/// Keeps the deck ring topped up and reports position, natural end and gapless
/// starts from what the mixer actually played. Beats `heartbeat` each time
/// round, so the watchdog can tell when a read has it stuck.
#[allow(clippy::too_many_arguments)]
fn playback_thread(
    app: Option<AppHandle>,
    session_id: u64,
    duration_seconds: f64,
    mut source: StreamingDecoder,
    mut deck: DeckHandle,
    stop_requested: Arc<AtomicBool>,
    cmd_rx: mpsc::Receiver<PlaybackCommand>,
    heartbeat: Arc<AtomicU64>,
    path: String,
) {
    let channels = deck.channels;
    let rate = deck.src_rate as f64;
    let chunk_samples = CHUNK_FRAMES * channels;
    let mut chunk: Vec<f32> = Vec::with_capacity(chunk_samples);
    let mut decoder_done = false;
    let mut last_position_emit = Instant::now();

    loop {
        heartbeat.store(now_ms(), Ordering::Relaxed);
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
            // Reading failed partway (e.g. the share dropped): that's not the
            // end of the track, so don't let it play out as one.
            if let Some(err) = source.take_read_error() {
                // Already ended (the watchdog gave up on it): nothing to add.
                if stop_requested.load(Ordering::SeqCst) {
                    return;
                }
                // The frontend lets go of a session that failed, so end it
                // here, as at a natural end.
                SESSIONS
                    .lock()
                    .expect("file playback state poisoned")
                    .remove(&session_id);
                let message = if err.starts_with(crate::sources::SOURCE_UNAVAILABLE) {
                    not_responding(&path)
                } else {
                    format!("Failed to read {path}: {err}")
                };
                eprintln!("file playback: {message}");
                emit_event(
                    app.as_ref(),
                    FILE_PLAYBACK_ERROR_EVENT,
                    FilePlaybackError {
                        session_id,
                        message,
                    },
                );
                return;
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
            emit_event(
                app.as_ref(),
                FILE_PLAYBACK_GAPLESS_STARTED_EVENT,
                FilePlaybackGaplessStarted { session_id },
            );
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
                    is_playing: deck.shared.playing.load(Ordering::Relaxed),
                },
            );
            last_position_emit = Instant::now();
        }

        if !did_work {
            thread::sleep(IDLE_SLEEP);
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

/// The session's current position, read straight from the mixer. Lets the webview resync after
/// it was throttled instead of waiting on (and trusting the timing of) the next position event.
pub fn position(session_id: u64) -> Option<FilePlaybackPosition> {
    with_session(session_id, |active| FilePlaybackPosition {
        session_id,
        position_seconds: (active
            .control
            .shared
            .position_frames
            .load(Ordering::Relaxed) as f64
            / active.rate)
            .min(active.duration_seconds),
        duration_seconds: active.duration_seconds,
        is_playing: active.is_playing(),
    })
}

pub fn pause(session_id: u64) {
    with_session(session_id, |active| {
        active
            .control
            .shared
            .playing
            .store(false, Ordering::Relaxed);
    });
}

pub fn resume(session_id: u64) {
    with_session(session_id, |active| {
        active.control.shared.playing.store(true, Ordering::Relaxed);
        active.control.output.ensure_stream();
    });
}

pub fn seek(session_id: u64, seconds: f64) -> Result<(), String> {
    with_session(session_id, |active| {
        active.cmd_tx.send(PlaybackCommand::Seek(seconds))
    })
    .ok_or_else(|| "No file is playing".to_string())?
    .map_err(|_| "File playback command channel closed".into())
}

/// Set a session's output gain (volume × mute × crossfade mix, 0–1).
pub fn set_gain(session_id: u64, gain: f32) {
    with_session(session_id, |active| active.control.shared.set_gain(gain));
}

/// Set a session's stereo balance (-1 left … +1 right).
pub fn set_balance(session_id: u64, balance: f32) {
    with_session(session_id, |active| {
        active.control.shared.set_balance(balance)
    });
}

/// Fade a session's output gain linearly (crossfades).
pub fn ramp_gain(session_id: u64, from: f32, to: f32, duration_ms: u32) {
    with_session(session_id, |active| {
        active.control.shared.ramp_gain(from, to, duration_ms)
    });
}

/// Arrange for `to_session` to start on the exact sample `from_session` runs out.
pub fn link_gapless(from_session: u64, to_session: u64) -> Result<(), String> {
    let sessions = SESSIONS.lock().expect("file playback state poisoned");
    let (Some(from), Some(to)) = (sessions.get(&from_session), sessions.get(&to_session)) else {
        return Err("Gapless link needs two live sessions".into());
    };
    from.control
        .output
        .link_gapless(from.control.deck_id, to.control.deck_id)
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

/// Stop every file session (tests, and webview reload teardown).
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
    use crate::native_audio::output::fake::{FakeFactory, FakeState};
    use crate::test_fixtures::{flac, ogg};
    use std::sync::Mutex as StdMutex;

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

    fn fake_output() -> (AudioOutput, Arc<FakeState>) {
        let state = FakeState::new(48_000);
        (AudioOutput::new(FakeFactory(Arc::clone(&state))), state)
    }

    fn position_frames(session_id: u64) -> u64 {
        with_session(session_id, |s| {
            s.control.shared.position_frames.load(Ordering::Relaxed)
        })
        .unwrap_or(0)
    }

    fn is_playing(session_id: u64) -> bool {
        with_session(session_id, |s| s.is_playing()).unwrap_or(false)
    }

    fn pump_until(state: &FakeState, what: &str, mut done: impl FnMut() -> bool) {
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
    fn starting_a_file_on_a_stalled_share_fails_fast_with_a_clear_error() {
        with_clean_sessions(|| {
            let path = std::env::temp_dir().join(format!(
                "spiral-stalled-share-{}/track.flac",
                std::process::id()
            ));
            let _stall = fs_probe::stall_file(&path);
            let (output, _state) = fake_output();

            let started = Instant::now();
            let err = start_inner(None, path.to_str().unwrap(), output).unwrap_err();
            assert!(err.starts_with(crate::sources::SOURCE_UNAVAILABLE), "{err}");
            assert!(err.contains("not responding"), "{err}");
            assert!(started.elapsed() < Duration::from_millis(500));
            assert!(SESSIONS.lock().unwrap().is_empty());
        });
    }

    #[test]
    fn a_missing_file_is_still_reported_as_not_found() {
        with_clean_sessions(|| {
            let (output, _state) = fake_output();
            let err = start_inner(None, "/definitely/not/here/track.flac", output).unwrap_err();
            assert!(err.starts_with("File not found"), "{err}");
        });
    }

    /// A decode thread stuck on a read stops beating; the watchdog reports
    /// its session once, as not responding, and leaves live ones alone.
    #[test]
    fn a_session_whose_decode_thread_stops_coming_round_is_reported_once() {
        with_clean_sessions(|| {
            let (ogg_path, flac_path) = fixture_paths();
            let (output, _state) = fake_output();
            let stuck = start_inner(None, &ogg_path, output.clone()).unwrap();
            let live = start_inner(None, &flac_path, output).unwrap();

            // Stand in for a read that never returns: the thread stops
            // beating. Wait for it to stop, then for the live one to beat
            // again, so the live one's last beat is the newer.
            SESSIONS.lock().unwrap()[&stuck.session_id]
                .stop_requested
                .store(true, Ordering::SeqCst);
            let deadline = Instant::now() + Duration::from_secs(5);
            while !SESSIONS.lock().unwrap()[&stuck.session_id]
                .thread
                .is_finished()
            {
                assert!(Instant::now() < deadline, "decode thread never stopped");
                thread::sleep(Duration::from_millis(5));
            }
            let at = SESSIONS.lock().unwrap()[&stuck.session_id]
                .heartbeat
                .load(Ordering::Relaxed);
            let beats_after = |id: u64| {
                SESSIONS.lock().unwrap()[&id]
                    .heartbeat
                    .load(Ordering::Relaxed)
                    > at
            };
            while !beats_after(live.session_id) {
                assert!(Instant::now() < deadline, "live session never beat");
                thread::sleep(Duration::from_millis(5));
            }
            // Just past the stuck one's limit, within the live one's.
            let later = at + STALL_AFTER.as_millis() as u64 + 1;

            let reported = take_stalled(&mut SESSIONS.lock().unwrap(), later);
            assert_eq!(reported.len(), 1);
            let error = &reported[0].1;
            assert_eq!(error.session_id, stuck.session_id);
            assert!(error
                .message
                .starts_with(crate::sources::SOURCE_UNAVAILABLE));
            assert!(error.message.contains(&ogg_path), "{}", error.message);

            // Ended there and then: gone from the sessions, its deck quiet,
            // so a read that returns later (the share is back) can't play on.
            {
                let sessions = SESSIONS.lock().unwrap();
                assert!(!sessions.contains_key(&stuck.session_id));
                assert!(sessions.contains_key(&live.session_id));
            }
            assert!(position(stuck.session_id).is_none());

            // Once only.
            assert!(take_stalled(&mut SESSIONS.lock().unwrap(), later + 10_000)
                .iter()
                .all(|(_, e)| e.session_id != stuck.session_id));
        });
    }

    #[test]
    fn join_within_waits_for_a_finishing_thread_but_not_a_stuck_one() {
        let quick = thread::spawn(|| thread::sleep(Duration::from_millis(30)));
        assert!(join_within(quick, Duration::from_secs(5)));

        let (release, blocked) = mpsc::channel::<()>();
        let stuck = thread::spawn(move || {
            let _ = blocked.recv();
        });
        let started = Instant::now();
        assert!(!join_within(stuck, Duration::from_millis(100)));
        assert!(started.elapsed() < Duration::from_secs(2));
        drop(release); // let the thread end
    }

    #[test]
    fn two_sessions_can_run_side_by_side() {
        with_clean_sessions(|| {
            let (ogg_path, flac_path) = fixture_paths();
            let (output, _state) = fake_output();
            let a = start_inner(None, &ogg_path, output.clone()).expect("start ogg");
            let b = start_inner(None, &flac_path, output).expect("start flac");
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
    fn stopping_a_session_frees_its_deck() {
        with_clean_sessions(|| {
            let (ogg_path, flac_path) = fixture_paths();
            let (output, _state) = fake_output();
            let a = start_inner(None, &ogg_path, output.clone()).expect("a");
            let _b = start_inner(None, &flac_path, output.clone()).expect("b");
            assert!(
                output.create_deck(2, 44_100, 0.1).is_err(),
                "both decks in use"
            );
            stop(a.session_id);
            assert!(output.create_deck(2, 44_100, 0.1).is_ok(), "deck released");
        });
    }

    #[test]
    fn third_session_evicts_oldest_idle() {
        with_clean_sessions(|| {
            let (ogg_path, flac_path) = fixture_paths();
            let (output, _state) = fake_output();
            let a = start_inner(None, &ogg_path, output.clone()).expect("start A");
            thread::sleep(Duration::from_millis(5));
            let b = start_inner(None, &flac_path, output.clone()).expect("start B");

            // Both idle (paused). Starting C should evict oldest (A).
            let c = start_inner(None, &ogg_path, output).expect("start C");
            assert!(with_session(a.session_id, |_| ()).is_none());
            assert!(with_session(b.session_id, |_| ()).is_some());
            assert!(with_session(c.session_id, |_| ()).is_some());
        });
    }

    #[test]
    fn third_session_fails_when_both_playing() {
        with_clean_sessions(|| {
            let (ogg_path, flac_path) = fixture_paths();
            let (output, _state) = fake_output();
            let a = start_inner(None, &ogg_path, output.clone()).expect("start A");
            let b = start_inner(None, &flac_path, output.clone()).expect("start B");

            // Mark both playing without a device pulling audio, so the short
            // fixtures do not end underneath the test.
            with_session(a.session_id, |s| {
                s.control.shared.playing.store(true, Ordering::Relaxed)
            });
            with_session(b.session_id, |s| {
                s.control.shared.playing.store(true, Ordering::Relaxed)
            });

            let err = start_inner(None, &ogg_path, output).expect_err("third should fail");
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

    #[test]
    fn rejects_missing_files_and_unsupported_extensions() {
        with_clean_sessions(|| {
            let (output, _state) = fake_output();
            let err = start_inner(None, "/definitely/not/here.flac", output.clone())
                .expect_err("missing file");
            assert!(err.contains("File not found"), "{err}");

            let dir = std::env::temp_dir().join("spiral-engine-ext-test");
            std::fs::create_dir_all(&dir).expect("temp dir");
            let path = dir.join("track.xyz");
            std::fs::write(&path, b"nope").expect("write");
            let err = start_inner(None, path.to_str().unwrap(), output).expect_err("bad ext");
            assert!(err.contains(".xyz"), "{err}");
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    #[test]
    fn session_plays_through_to_natural_end() {
        with_clean_sessions(|| {
            let (ogg_path, _) = fixture_paths();
            let (output, state) = fake_output();
            let started = start_inner(None, &ogg_path, output).expect("start");
            resume(started.session_id);

            pump_until(&state, "natural end", || {
                with_session(started.session_id, |_| ()).is_none()
            });
        });
    }

    #[test]
    fn pause_freezes_position_and_resume_continues() {
        with_clean_sessions(|| {
            let (_, flac_path) = fixture_paths();
            let (output, state) = fake_output();
            let started = start_inner(None, &flac_path, output).expect("start");
            let id = started.session_id;
            resume(id);
            pump_until(&state, "audio", || position_frames(id) > 0);

            pause(id);
            assert!(!is_playing(id));
            // Let the fade-out finish, then the position must hold still.
            for _ in 0..4 {
                state.pump(240);
            }
            let frozen = position_frames(id);
            for _ in 0..4 {
                state.pump(240);
            }
            assert_eq!(position_frames(id), frozen);

            resume(id);
            pump_until(&state, "resumed audio", || position_frames(id) > frozen);
        });
    }

    #[test]
    fn seek_flushes_and_repositions() {
        with_clean_sessions(|| {
            let (_, flac_path) = fixture_paths();
            let (output, state) = fake_output();
            let started = start_inner(None, &flac_path, output).expect("start");
            let id = started.session_id;
            resume(id);
            pump_until(&state, "audio", || position_frames(id) > 2000);
            pause(id);
            for _ in 0..4 {
                state.pump(240);
            }

            seek(id, 0.0).expect("seek");
            let deadline = Instant::now() + Duration::from_secs(5);
            while position_frames(id) > 100 && Instant::now() < deadline {
                state.pump(240);
                thread::sleep(Duration::from_millis(5));
            }
            assert!(
                position_frames(id) <= 100,
                "position reset by seek: {}",
                position_frames(id)
            );
        });
    }

    #[test]
    fn seek_on_a_missing_session_is_an_error() {
        assert!(seek(u64::MAX, 1.0).is_err());
    }

    #[test]
    fn gapless_link_starts_the_second_session_when_the_first_ends() {
        with_clean_sessions(|| {
            let (ogg_path, flac_path) = fixture_paths();
            let (output, state) = fake_output();
            let first = start_inner(None, &ogg_path, output.clone()).expect("first");
            let second = start_inner(None, &flac_path, output).expect("second");

            link_gapless(first.session_id, second.session_id).expect("link");
            resume(first.session_id);

            pump_until(&state, "first to end", || {
                with_session(first.session_id, |_| ()).is_none()
            });
            assert!(
                is_playing(second.session_id),
                "second started by the splice"
            );
            pump_until(&state, "second audio", || {
                position_frames(second.session_id) > 0
            });
        });
    }

    #[test]
    fn gapless_link_requires_two_live_sessions() {
        with_clean_sessions(|| {
            let (ogg_path, _) = fixture_paths();
            let (output, _state) = fake_output();
            let only = start_inner(None, &ogg_path, output).expect("only");
            assert!(link_gapless(only.session_id, 9999).is_err());
            assert!(link_gapless(9999, only.session_id).is_err());
        });
    }

    #[test]
    fn gain_balance_and_ramp_reach_the_deck() {
        with_clean_sessions(|| {
            let (_, flac_path) = fixture_paths();
            let (output, _state) = fake_output();
            let started = start_inner(None, &flac_path, output).expect("start");
            let id = started.session_id;
            set_gain(id, 0.25);
            set_balance(id, -0.5);
            let (gain, balance) = with_session(id, |s| {
                (s.control.shared.gain(), s.control.shared.balance())
            })
            .expect("session");
            assert_eq!((gain, balance), (0.25, -0.5));

            ramp_gain(id, 0.0, 1.0, 500);
            assert_eq!(with_session(id, |s| s.control.shared.gain()), Some(1.0));
            // Unknown sessions are ignored.
            set_gain(u64::MAX, 1.0);
        });
    }

    #[test]
    fn muted_session_renders_silence() {
        with_clean_sessions(|| {
            let (_, flac_path) = fixture_paths();
            let (output, state) = fake_output();
            let started = start_inner(None, &flac_path, output).expect("start");
            let id = started.session_id;
            set_gain(id, 0.0);
            resume(id);
            pump_until(&state, "audio", || position_frames(id) > 2000);
            let silent = state.pump(480).expect("callback");
            assert!(
                silent.iter().all(|s| s.abs() < 1e-3),
                "muted output is silent"
            );
        });
    }
}
