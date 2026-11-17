//! CD playback engine: a PCM source feeds the native audio output.
//!
//! Supports up to [`MAX_SESSIONS`] concurrent sessions so two tracks on the same
//! drive can overlap for gapless handoff (mirrors `file_playback::engine`).
//! Position / end / error updates reach the frontend as Tauri events.
//! Platforms supply a [`CdPcmSource`] and an optional session guard.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use super::source::CdPcmSource;
use super::{
    CdPlaybackDamaged, CdPlaybackEnded, CdPlaybackError, CdPlaybackGaplessStarted,
    CdPlaybackPosition, CdPlaybackStarted, CD_PLAYBACK_DAMAGED_EVENT, CD_PLAYBACK_ENDED_EVENT,
    CD_PLAYBACK_ERROR_EVENT, CD_PLAYBACK_GAPLESS_STARTED_EVENT, CD_PLAYBACK_POSITION_EVENT,
};
use crate::cd::platform::session::DriveSessionGuard;
use crate::native_audio::mixer::DeckShared;
use crate::native_audio::{AudioOutput, DeckHandle};

/// ~4 Hz position pushes — plenty for a 500ms UI poll.
const POSITION_EVENT_INTERVAL: Duration = Duration::from_millis(250);

/// 2048 frames per chunk (~46 ms at 44.1 kHz).
const CHUNK_FRAMES: usize = 2048;

/// Outgoing + incoming decks during CD gapless handoff.
const MAX_SESSIONS: usize = 2;

/// Seconds of source audio the output ring holds ahead of the device. Optical
/// drives stall 130–180 ms between chunks (longer under dual-reader gapless
/// seek), so the cushion is deeper than for files.
const RING_SECONDS: f64 = 4.0;
/// Hold the first start silent until this much audio is queued. Cold-start
/// spin-up delivers a cached first chunk in milliseconds, then stalls 1–3 s;
/// starting on that chunk underruns until the drive is up to speed. Gapless
/// handoffs skip this wait: their successor buffers while the first track plays.
const START_PREBUFFER_SECONDS: f64 = 2.0;
/// Decode-thread nap when the ring is full or the stream is done.
const IDLE_SLEEP: Duration = Duration::from_millis(5);

/// A single source read (or seek) blocking this long means the drive is stuck retrying a damaged
/// area. Past it the session is ended with [`DISC_TOO_SLOW_MESSAGE`] instead of freezing.
const STALL_LIMIT: Duration = if cfg!(test) {
    Duration::from_millis(300)
} else {
    Duration::from_secs(6)
};
/// How often the watchdog checks whether a read is stuck.
const WATCHDOG_INTERVAL: Duration = Duration::from_millis(100);
/// How long stopping a session waits for its thread. A thread stuck in a drive read can't be
/// interrupted, so after this it is detached and exits on its own once the read returns.
const JOIN_GRACE: Duration = Duration::from_millis(500);
/// Source reads at least this slow are logged, to diagnose damaged discs.
const SLOW_READ_LOG: Duration = Duration::from_millis(500);
/// Read time over which throughput is judged.
const HEALTH_WINDOW: Duration = Duration::from_secs(8);
/// Minimum audio decoded per second of read time over [`HEALTH_WINDOW`]. Below 1.0 the drive
/// can't keep up with playback; the ring cushion hides a little of that, but not half.
const MIN_REALTIME_RATIO: f64 = 0.5;

/// Shown (via the playback error event) when a damaged disc can't be read fast enough to play.
/// The frontend matches on it in `cdPlaybackFailure.ts`.
pub const DISC_TOO_SLOW_MESSAGE: &str = "Disc is too damaged to read in real time";

/// Judges whether the source keeps up with playback, from the time spent reading.
#[derive(Default)]
struct ReadHealth {
    wall: Duration,
    audio_seconds: f64,
}

impl ReadHealth {
    /// Record one read; returns `true` when a full window of reading averaged too slow.
    fn record(&mut self, wall: Duration, audio_seconds: f64) -> bool {
        self.wall += wall;
        self.audio_seconds += audio_seconds;
        if self.wall < HEALTH_WINDOW {
            return false;
        }
        let too_slow = self.audio_seconds < self.wall.as_secs_f64() * MIN_REALTIME_RATIO;
        *self = Self::default();
        too_slow
    }
}

static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

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
    drive_id: String,
    track_number: u32,
    stop_requested: Arc<AtomicBool>,
    cmd_tx: mpsc::Sender<PlaybackCommand>,
    thread: thread::JoinHandle<()>,
    started_at: Instant,
    /// Source sample rate and length, to turn the deck's frame counter into seconds on demand.
    rate: f64,
    duration_seconds: f64,
    /// Holds `DriveSessionPhase::Playing` for the life of the track (when provided).
    _session_guard: Option<DriveSessionGuard>,
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
    let deadline = Instant::now() + JOIN_GRACE;
    while !active.thread.is_finished() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    if active.thread.is_finished() {
        if let Err(err) = active.thread.join() {
            eprintln!("cd playback: thread join failed: {err:?}");
        }
    } else {
        eprintln!(
            "cd playback: session thread still blocked in a drive read; detaching it so stop \
             doesn't hang"
        );
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

/// Start playback of `source` for `drive_id` / `track_number`. Begins paused and
/// plays through the native audio output.
pub fn start(
    app: AppHandle,
    drive_id: &str,
    track_number: u32,
    source: impl CdPcmSource + 'static,
    session_guard: Option<DriveSessionGuard>,
) -> Result<CdPlaybackStarted, String> {
    start_inner(
        Some(app),
        drive_id,
        track_number,
        source,
        session_guard,
        crate::native_audio::global().clone(),
    )
}

fn start_inner(
    app: Option<AppHandle>,
    drive_id: &str,
    track_number: u32,
    source: impl CdPcmSource + 'static,
    session_guard: Option<DriveSessionGuard>,
    output: AudioOutput,
) -> Result<CdPlaybackStarted, String> {
    {
        let mut sessions = SESSIONS.lock().expect("cd playback state poisoned");
        make_room_for_new_session(&mut sessions)?;
    }

    let duration_seconds = source.duration_seconds();
    let sample_rate = source.sample_rate();
    let channels = source.channels();
    let read_failed = source.read_failed_flag();
    let damaged_sectors = source.damaged_sectors_counter();
    let session_id = NEXT_SESSION_ID.fetch_add(1, Ordering::SeqCst);

    let deck = output.create_deck(channels as usize, sample_rate, RING_SECONDS)?;
    deck.set_start_prebuffer_seconds(START_PREBUFFER_SECONDS);
    let control = DeckControl {
        deck_id: deck.id(),
        shared: Arc::clone(&deck.shared),
        output,
    };
    let stop_requested = Arc::new(AtomicBool::new(false));
    let reading = Arc::new(ReadingSince::new());
    let (cmd_tx, cmd_rx) = mpsc::channel::<PlaybackCommand>();
    let rate = deck.src_rate as f64;

    let thread = {
        let app = app.clone();
        let drive_id = drive_id.to_string();
        let stop_requested = Arc::clone(&stop_requested);
        let reading = Arc::clone(&reading);
        thread::Builder::new()
            .name(format!("cd-playback-{session_id}"))
            .spawn(move || {
                playback_thread(
                    app,
                    session_id,
                    drive_id,
                    track_number,
                    duration_seconds,
                    source,
                    read_failed,
                    damaged_sectors,
                    deck,
                    stop_requested,
                    reading,
                    cmd_rx,
                );
            })
            .map_err(|err| format!("Failed to start CD playback thread: {err}"))?
    };

    SESSIONS.lock().expect("cd playback state poisoned").insert(
        session_id,
        ActivePlayback {
            control,
            drive_id: drive_id.to_string(),
            track_number,
            stop_requested: Arc::clone(&stop_requested),
            cmd_tx,
            thread,
            started_at: Instant::now(),
            rate,
            duration_seconds,
            _session_guard: session_guard,
        },
    );

    spawn_stall_watchdog(
        app,
        session_id,
        drive_id.to_string(),
        track_number,
        stop_requested,
        reading,
    );

    Ok(CdPlaybackStarted {
        session_id,
        duration_seconds,
        sample_rate,
        channels,
    })
}

/// End a session from its own playback thread because the disc can't be read fast enough.
fn fail_session(app: Option<&AppHandle>, session_id: u64, drive_id: &str, track_number: u32) {
    SESSIONS
        .lock()
        .expect("cd playback state poisoned")
        .remove(&session_id);
    emit(
        app,
        CD_PLAYBACK_ERROR_EVENT,
        CdPlaybackError {
            session_id,
            drive_id: drive_id.to_string(),
            track_number,
            message: DISC_TOO_SLOW_MESSAGE.into(),
        },
    );
}

/// Lets the watchdog see when the playback thread is inside a (possibly blocking) source call.
struct ReadingSince {
    epoch: Instant,
    /// Milliseconds since `epoch` + 1 when the current source call began; 0 when idle.
    since_ms: AtomicU64,
    /// Set when the playback thread exits so the watchdog can too.
    done: AtomicBool,
}

impl ReadingSince {
    fn new() -> Self {
        Self {
            epoch: Instant::now(),
            since_ms: AtomicU64::new(0),
            done: AtomicBool::new(false),
        }
    }

    fn begin(&self) {
        let ms = self.epoch.elapsed().as_millis() as u64 + 1;
        self.since_ms.store(ms, Ordering::Release);
    }

    fn end(&self) {
        self.since_ms.store(0, Ordering::Release);
    }

    fn blocked_for(&self) -> Option<Duration> {
        let since = self.since_ms.load(Ordering::Acquire);
        if since == 0 {
            return None;
        }
        let now = self.epoch.elapsed().as_millis() as u64 + 1;
        Some(Duration::from_millis(now.saturating_sub(since)))
    }
}

/// Marks the playback thread finished on every exit path.
struct DoneOnDrop(Arc<ReadingSince>);

impl Drop for DoneOnDrop {
    fn drop(&mut self) {
        self.0.done.store(true, Ordering::Release);
    }
}

/// A drive stuck retrying a damaged area blocks the playback thread inside a read it can't
/// abandon. This watchdog notices, ends the session with an error the user can see, and detaches
/// the stuck thread instead of letting the whole app wait on the drive.
fn spawn_stall_watchdog(
    app: Option<AppHandle>,
    session_id: u64,
    drive_id: String,
    track_number: u32,
    stop_requested: Arc<AtomicBool>,
    reading: Arc<ReadingSince>,
) {
    let spawned = thread::Builder::new()
        .name(format!("cd-watchdog-{session_id}"))
        .spawn(move || {
            while !reading.done.load(Ordering::Acquire) && !stop_requested.load(Ordering::SeqCst) {
                thread::sleep(WATCHDOG_INTERVAL);
                let Some(blocked) = reading.blocked_for() else {
                    continue;
                };
                if blocked < STALL_LIMIT {
                    continue;
                }
                if stop_requested.swap(true, Ordering::SeqCst) {
                    return;
                }
                eprintln!(
                    "cd playback: track {track_number} read blocked for {:.1}s; ending session",
                    blocked.as_secs_f64()
                );
                let taken = SESSIONS
                    .lock()
                    .expect("cd playback state poisoned")
                    .remove(&session_id);
                if let Some(active) = taken {
                    shutdown_active(active);
                }
                emit(
                    app.as_ref(),
                    CD_PLAYBACK_ERROR_EVENT,
                    CdPlaybackError {
                        session_id,
                        drive_id,
                        track_number,
                        message: DISC_TOO_SLOW_MESSAGE.into(),
                    },
                );
                return;
            }
        });
    if let Err(err) = spawned {
        eprintln!("cd playback: watchdog failed to start: {err}");
    }
}

fn emit<T: serde::Serialize + Clone>(app: Option<&AppHandle>, event: &str, payload: T) {
    let Some(app) = app else {
        return;
    };
    if let Err(err) = app.emit(event, payload) {
        eprintln!("cd playback: {event} emit failed: {err}");
    }
}

/// Keeps the deck ring topped up and reports position, natural end and gapless
/// starts from what the mixer actually played. A mid-track read failure surfaces
/// as an error once the audio already buffered has played out.
#[allow(clippy::too_many_arguments)]
fn playback_thread(
    app: Option<AppHandle>,
    session_id: u64,
    drive_id: String,
    track_number: u32,
    duration_seconds: f64,
    mut source: impl CdPcmSource,
    read_failed: Arc<AtomicBool>,
    damaged_sectors: Option<Arc<AtomicU32>>,
    mut deck: DeckHandle,
    stop_requested: Arc<AtomicBool>,
    reading: Arc<ReadingSince>,
    cmd_rx: mpsc::Receiver<PlaybackCommand>,
) {
    let _done = DoneOnDrop(Arc::clone(&reading));
    let mut health = ReadHealth::default();
    let channels = deck.channels;
    let rate = deck.src_rate as f64;
    let chunk_samples = CHUNK_FRAMES * channels;
    let mut chunk: Vec<f32> = Vec::with_capacity(chunk_samples);
    let mut decoder_done = false;
    let mut last_position_emit = Instant::now();
    let mut damage_reported = false;

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
            reading.begin();
            if let Err(err) = source.seek_seconds(latest) {
                eprintln!("cd playback: seek failed: {err}");
            }
            reading.end();
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
            let read_started = Instant::now();
            let before = chunk.len();
            reading.begin();
            while chunk.len() < chunk_samples {
                match source.next_sample() {
                    Some(sample) => chunk.push(sample),
                    None => {
                        decoder_done = true;
                        break;
                    }
                }
            }
            reading.end();
            let took = read_started.elapsed();
            if took >= SLOW_READ_LOG {
                eprintln!(
                    "cd playback: track {track_number} slow read {:.2}s at {:.1}s",
                    took.as_secs_f64(),
                    source.position_seconds()
                );
            }
            let audio_seconds = (chunk.len() - before) as f64 / channels as f64 / rate;
            if audio_seconds > 0.0 && health.record(took, audio_seconds) {
                eprintln!("cd playback: track {track_number} reading below real time; stopping");
                fail_session(app.as_ref(), session_id, &drive_id, track_number);
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

        if !damage_reported {
            let damaged = damaged_sectors
                .as_ref()
                .map_or(0, |count| count.load(Ordering::Relaxed));
            if damaged > 0 {
                damage_reported = true;
                emit(
                    app.as_ref(),
                    CD_PLAYBACK_DAMAGED_EVENT,
                    CdPlaybackDamaged {
                        session_id,
                        drive_id: drive_id.clone(),
                        track_number,
                        damaged_sectors: damaged,
                    },
                );
            }
        }

        if deck.shared.gapless_started.swap(false, Ordering::AcqRel) {
            emit(
                app.as_ref(),
                CD_PLAYBACK_GAPLESS_STARTED_EVENT,
                CdPlaybackGaplessStarted {
                    session_id,
                    drive_id: drive_id.clone(),
                    track_number,
                },
            );
        }

        if deck.shared.finished.load(Ordering::Acquire) {
            break;
        }

        if last_position_emit.elapsed() >= POSITION_EVENT_INTERVAL {
            let position_seconds = (deck.shared.position_frames.load(Ordering::Relaxed) as f64
                / rate)
                .min(duration_seconds);
            emit(
                app.as_ref(),
                CD_PLAYBACK_POSITION_EVENT,
                CdPlaybackPosition {
                    session_id,
                    drive_id: drive_id.clone(),
                    track_number,
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
        let mut guard = SESSIONS.lock().expect("cd playback state poisoned");
        let _ = guard.remove(&session_id);
    }

    if read_failed.load(Ordering::SeqCst) {
        emit(
            app.as_ref(),
            CD_PLAYBACK_ERROR_EVENT,
            CdPlaybackError {
                session_id,
                drive_id,
                track_number,
                message: "Failed to read CD audio data".into(),
            },
        );
        return;
    }

    emit(
        app.as_ref(),
        CD_PLAYBACK_ENDED_EVENT,
        CdPlaybackEnded {
            session_id,
            drive_id,
            track_number,
        },
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

/// Set a session's output gain (volume × mute × mix, 0–1).
pub fn set_gain(session_id: u64, gain: f32) {
    with_session(session_id, |active| active.control.shared.set_gain(gain));
}

/// Set a session's stereo balance (-1 left … +1 right).
pub fn set_balance(session_id: u64, balance: f32) {
    with_session(session_id, |active| {
        active.control.shared.set_balance(balance)
    });
}

/// Fade a session's output gain linearly.
pub fn ramp_gain(session_id: u64, from: f32, to: f32, duration_ms: u32) {
    with_session(session_id, |active| {
        active.control.shared.ramp_gain(from, to, duration_ms)
    });
}

/// Start `to_session` on the exact sample `from_session` runs out.
pub fn link_gapless(from_session: u64, to_session: u64) -> Result<(), String> {
    let sessions = SESSIONS.lock().expect("cd playback state poisoned");
    let (Some(from), Some(to)) = (sessions.get(&from_session), sessions.get(&to_session)) else {
        return Err("Gapless link needs two live sessions".into());
    };
    from.control
        .output
        .link_gapless(from.control.deck_id, to.control.deck_id)
}

/// The session's current position, read straight from the mixer. Lets the webview resync after
/// it was throttled instead of waiting on (and trusting the timing of) the next position event.
pub fn position(session_id: u64) -> Option<CdPlaybackPosition> {
    with_session(session_id, |active| CdPlaybackPosition {
        session_id,
        drive_id: active.drive_id.clone(),
        track_number: active.track_number,
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

pub fn seek(session_id: u64, seconds: f64) -> Result<(), String> {
    with_session(session_id, |active| {
        active.cmd_tx.send(PlaybackCommand::Seek(seconds))
    })
    .ok_or_else(|| "No CD track is playing".to_string())?
    .map_err(|_| "CD playback command channel closed".into())
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

/// Stop every CD session (tests, and webview reload teardown).
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
    use crate::native_audio::output::fake::{FakeFactory, FakeState};
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
        /// Block once for this long when the read position reaches the given sample, like a
        /// drive stuck retrying a damaged sector.
        stall_at: Option<(u64, Duration)>,
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
                stall_at: None,
            }
        }

        fn stalling_at(mut self, sample: u64, duration: Duration) -> Self {
            self.stall_at = Some((sample, duration));
            self
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
            if let Some((at, duration)) = self.stall_at {
                if self.sample_index == at {
                    self.stall_at = None;
                    thread::sleep(duration);
                }
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

    fn fake_output() -> (AudioOutput, Arc<FakeState>) {
        let state = FakeState::new(48_000);
        (AudioOutput::new(FakeFactory(Arc::clone(&state))), state)
    }

    fn begin(output: &AudioOutput, drive: &str, track: u32, seconds: f64) -> CdPlaybackStarted {
        start_inner(
            None,
            drive,
            track,
            InterleavedFixture::new(seconds),
            None,
            output.clone(),
        )
        .expect("start")
    }

    fn position_frames(session_id: u64) -> u64 {
        with_session(session_id, |s| {
            s.control.shared.position_frames.load(Ordering::Relaxed)
        })
        .unwrap_or(0)
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
    fn session_plays_through_to_natural_end() {
        with_clean_sessions(|| {
            let (output, state) = fake_output();
            let started = begin(&output, "drive-a", 1, 0.5);
            resume(started.session_id);
            pump_until(&state, "natural end", || {
                with_session(started.session_id, |_| ()).is_none()
            });
        });
    }

    #[test]
    fn first_start_waits_for_the_cold_start_buffer() {
        with_clean_sessions(|| {
            let (output, state) = fake_output();
            let started = begin(&output, "drive-a", 1, 20.0);
            let id = started.session_id;
            resume(id);
            // The fixture decodes instantly, so the ring fills past the
            // prebuffer and audio starts without a hang.
            pump_until(&state, "audio", || position_frames(id) > 4000);
            let prebuffer = with_session(id, |s| {
                s.control
                    .shared
                    .start_prebuffer_samples
                    .load(Ordering::Relaxed)
            })
            .expect("session");
            assert_eq!(prebuffer, (START_PREBUFFER_SECONDS * 44_100.0) as usize * 2);
        });
    }

    #[test]
    fn pause_freezes_position_and_seek_repositions() {
        with_clean_sessions(|| {
            let (output, state) = fake_output();
            let started = begin(&output, "drive-a", 1, 20.0);
            let id = started.session_id;
            resume(id);
            pump_until(&state, "audio", || position_frames(id) > 4000);

            pause(id);
            for _ in 0..4 {
                state.pump(240);
            }
            let frozen = position_frames(id);
            for _ in 0..4 {
                state.pump(240);
            }
            assert_eq!(position_frames(id), frozen, "paused");

            seek(id, 10.0).expect("seek");
            pump_until(&state, "seek applied", || position_frames(id) >= 44100 * 10);
        });
    }

    #[test]
    fn gapless_link_starts_the_next_track_when_the_first_ends() {
        with_clean_sessions(|| {
            let (output, state) = fake_output();
            let first = begin(&output, "drive-a", 1, 0.5);
            let second = begin(&output, "drive-a", 2, 5.0);

            link_gapless(first.session_id, second.session_id).expect("link");
            resume(first.session_id);
            pump_until(&state, "first to end", || {
                with_session(first.session_id, |_| ()).is_none()
            });
            pump_until(&state, "second audio", || {
                position_frames(second.session_id) > 0
            });
        });
    }

    #[test]
    fn gain_balance_and_ramp_reach_the_deck() {
        with_clean_sessions(|| {
            let (output, _state) = fake_output();
            let native = begin(&output, "drive-a", 2, 1.0);
            set_gain(native.session_id, 0.25);
            set_balance(native.session_id, 0.5);
            let (gain, balance) = with_session(native.session_id, |s| {
                (s.control.shared.gain(), s.control.shared.balance())
            })
            .expect("session");
            assert_eq!((gain, balance), (0.25, 0.5));

            ramp_gain(native.session_id, 0.0, 1.0, 100);
            assert_eq!(
                with_session(native.session_id, |s| s.control.shared.gain()),
                Some(1.0)
            );
            // Unknown sessions are ignored; linking one is an error.
            set_gain(u64::MAX, 1.0);
            assert!(link_gapless(native.session_id, u64::MAX).is_err());
        });
    }

    #[test]
    fn read_health_flags_a_window_of_slow_reads() {
        let mut health = ReadHealth::default();
        // 1 s of reading yields 0.2 s of audio: a quarter of a window at a time.
        assert!(!health.record(Duration::from_secs(4), 0.8));
        assert!(health.record(Duration::from_secs(4), 0.8));
    }

    #[test]
    fn read_health_passes_fast_reads_and_resets_each_window() {
        let mut health = ReadHealth::default();
        assert!(!health.record(Duration::from_secs(4), 40.0));
        assert!(!health.record(Duration::from_secs(4), 40.0));
        // A slow patch after a healthy window starts from a clean slate.
        assert!(!health.record(Duration::from_secs(4), 0.5));
    }

    #[test]
    fn a_blocked_read_ends_the_session_and_stop_does_not_wait_for_it() {
        with_clean_sessions(|| {
            let (output, _state) = fake_output();
            // The drive hangs for 3 s partway in; the watchdog gives up after 300 ms.
            let fixture = InterleavedFixture::new(10.0).stalling_at(4_000, Duration::from_secs(3));
            let started = start_inner(None, "drive-a", 1, fixture, None, output).expect("start");

            let began = Instant::now();
            while with_session(started.session_id, |_| ()).is_some() {
                assert!(
                    began.elapsed() < Duration::from_secs(2),
                    "watchdog never ended the blocked session"
                );
                thread::sleep(Duration::from_millis(10));
            }
            assert!(began.elapsed() < Duration::from_secs(2));
        });
    }

    #[test]
    fn stopping_a_session_stuck_in_a_read_returns_promptly() {
        with_clean_sessions(|| {
            let (output, _state) = fake_output();
            // Stall longer than the watchdog limit is irrelevant here: stop right away.
            let fixture = InterleavedFixture::new(10.0).stalling_at(4_000, Duration::from_secs(3));
            let started = start_inner(None, "drive-a", 1, fixture, None, output).expect("start");
            thread::sleep(Duration::from_millis(60));

            let began = Instant::now();
            stop(started.session_id);
            assert!(
                began.elapsed() < Duration::from_secs(1),
                "stop waited on the blocked read: {:?}",
                began.elapsed()
            );
        });
    }

    #[test]
    fn a_read_failure_still_ends_the_session() {
        with_clean_sessions(|| {
            let (output, state) = fake_output();
            let fixture = InterleavedFixture::new(0.3);
            fixture.read_failed.store(true, Ordering::SeqCst);
            let started = start_inner(None, "drive-a", 1, fixture, None, output).expect("start");
            resume(started.session_id);
            pump_until(&state, "session end", || {
                with_session(started.session_id, |_| ()).is_none()
            });
        });
    }

    #[test]
    fn stopping_a_drive_releases_its_decks() {
        with_clean_sessions(|| {
            let (output, _state) = fake_output();
            begin(&output, "drive-a", 1, 5.0);
            begin(&output, "drive-a", 2, 5.0);
            stop_for_drive("drive-a");
            assert!(output.create_deck(2, 44_100, 0.1).is_ok());
            assert!(output.create_deck(2, 44_100, 0.1).is_ok());
        });
    }

    #[test]
    fn two_sessions_can_run_side_by_side() {
        with_clean_sessions(|| {
            let (output, _state) = fake_output();
            let a = begin(&output, "drive-a", 1, 1.0);
            let b = begin(&output, "drive-a", 2, 1.0);
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
    fn stop_for_drive_stops_all_sessions_on_that_drive() {
        with_clean_sessions(|| {
            let (output, _state) = fake_output();
            let a = begin(&output, "drive-a", 1, 1.0);
            let b = begin(&output, "drive-a", 2, 1.0);

            stop_for_drive("drive-a");
            assert!(with_session(a.session_id, |_| ()).is_none());
            assert!(with_session(b.session_id, |_| ()).is_none());

            let c = begin(&output, "drive-b", 1, 1.0);
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
            let (output, _state) = fake_output();
            let a = begin(&output, "drive-a", 1, 1.0);
            thread::sleep(Duration::from_millis(5));
            let b = begin(&output, "drive-a", 2, 1.0);

            // Both idle (paused). Starting C should evict oldest (A).
            let c = begin(&output, "drive-b", 1, 1.0);
            assert!(with_session(a.session_id, |_| ()).is_none());
            assert!(with_session(b.session_id, |_| ()).is_some());
            assert!(with_session(c.session_id, |_| ()).is_some());
        });
    }

    #[test]
    fn third_session_fails_when_both_playing() {
        with_clean_sessions(|| {
            let (output, _state) = fake_output();
            let a = begin(&output, "drive-a", 1, 1.0);
            let b = begin(&output, "drive-a", 2, 1.0);

            // Mark both playing without a device pulling audio.
            for id in [a.session_id, b.session_id] {
                with_session(id, |s| {
                    s.control.shared.playing.store(true, Ordering::Relaxed)
                });
            }

            let err = start_inner(
                None,
                "drive-b",
                1,
                InterleavedFixture::new(1.0),
                None,
                output,
            )
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
