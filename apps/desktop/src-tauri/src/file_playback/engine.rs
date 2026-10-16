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
use crate::native_audio::mixer::DeckShared;
use crate::native_audio::{AudioOutput, DeckHandle};

pub const FILE_PLAYBACK_POSITION_EVENT: &str = "file-playback-position";
pub const FILE_PLAYBACK_ENDED_EVENT: &str = "file-playback-ended";
/// A session began playing on its own (gapless splice from another session).
pub const FILE_PLAYBACK_GAPLESS_STARTED_EVENT: &str = "file-playback-gapless-started";

/// Outgoing + incoming decks during crossfade.
const MAX_SESSIONS: usize = 2;

/// Seconds of source audio the output ring holds ahead of the device. Rides out
/// main-thread stalls (window minimise, pack installs) without an underrun.
/// Keep in step with `FILE_READ_AHEAD_SECONDS` in `canCrossfade.ts`.
const RING_SECONDS: f64 = 2.0;
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
        .map(|(id, session)| (*id, session.is_playing(), session.started_at))
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

fn emit_event<T: Serialize + Clone>(app: Option<&AppHandle>, event: &str, payload: T) {
    let Some(app) = app else {
        return;
    };
    if let Err(err) = app.emit(event, payload) {
        eprintln!("file playback: {event} emit failed: {err}");
    }
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

    let deck = output.create_deck(channels as usize, sample_rate, RING_SECONDS)?;
    let control = DeckControl {
        deck_id: deck.id(),
        shared: Arc::clone(&deck.shared),
        output,
    };
    let stop_requested = Arc::new(AtomicBool::new(false));
    let (cmd_tx, cmd_rx) = mpsc::channel::<PlaybackCommand>();

    let thread = {
        let stop_requested = Arc::clone(&stop_requested);
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
            },
        );

    Ok(FilePlaybackStarted {
        session_id,
        duration_seconds,
        sample_rate,
        channels,
    })
}

/// Keeps the deck ring topped up and reports position, natural end and gapless
/// starts from what the mixer actually played.
fn playback_thread(
    app: Option<AppHandle>,
    session_id: u64,
    duration_seconds: f64,
    mut source: StreamingDecoder,
    mut deck: DeckHandle,
    stop_requested: Arc<AtomicBool>,
    cmd_rx: mpsc::Receiver<PlaybackCommand>,
) {
    let channels = deck.channels;
    let rate = deck.src_rate as f64;
    let chunk_samples = CHUNK_FRAMES * channels;
    let mut chunk: Vec<f32> = Vec::with_capacity(chunk_samples);
    let mut decoder_done = false;
    let mut last_position_emit = Instant::now();

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
