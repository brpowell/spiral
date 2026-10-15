//! Output stage: owns the device stream and keeps it alive across sleep/wake
//! and device changes.
//!
//! One dedicated thread owns the stream (cpal streams are not `Send` on every
//! platform). The mixer and every deck ring live outside the stream, so a
//! rebuild keeps playback state; only the device binding is recreated.
//!
//! The stream is opened lazily when a deck should be audible and closed after
//! a short idle period, so a sleeping machine never holds a stale stream.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rtrb::{Producer, RingBuffer};

use super::mixer::{DeckShared, Mixer};

/// Domain used for every activity-log line this module writes.
pub const LOG_DOMAIN: &str = "audio.output";

const TICK: Duration = Duration::from_millis(100);
/// Close the stream this long after the last deck stops being audible.
const IDLE_CLOSE: Duration = Duration::from_secs(3);
/// A playing stream whose callback has not run for this long is rebuilt.
const WATCHDOG: Duration = Duration::from_millis(1500);
const RETRY_MIN: Duration = Duration::from_millis(250);
const RETRY_MAX: Duration = Duration::from_secs(2);

/// Format the device actually opened with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamInfo {
    pub sample_rate: u32,
    pub channels: usize,
    pub device: String,
}

/// An open device stream. Dropping it closes the device.
pub trait ActiveStream {
    fn start(&self) -> Result<(), String>;
}

pub type Render = Box<dyn FnMut(&mut [f32]) + Send>;
pub type ErrorSink = Box<dyn Fn(String) + Send + Sync>;

/// Creates device streams. Lives on the output thread, so it need not be `Sync`.
pub trait StreamFactory: Send + 'static {
    fn build(
        &mut self,
        render: Render,
        on_error: ErrorSink,
    ) -> Result<(Box<dyn ActiveStream>, StreamInfo), String>;
}

enum Ctl {
    /// A deck wants to be heard; build the stream now rather than at the next tick.
    Ensure,
    WillSleep,
    DidWake,
    StreamError {
        generation: u64,
        message: String,
    },
}

/// Handle to the output stage (cheap to clone).
#[derive(Clone)]
pub struct AudioOutput {
    mixer: Arc<Mutex<Mixer>>,
    ctl: Sender<Ctl>,
    #[cfg_attr(not(test), allow(dead_code))]
    heartbeat: Arc<AtomicU64>,
}

/// Producer side of one deck. Dropping it removes the deck from the mixer.
pub struct DeckHandle {
    id: u64,
    pub producer: Producer<f32>,
    pub shared: Arc<DeckShared>,
    pub channels: usize,
    pub src_rate: u32,
    output: AudioOutput,
}

impl DeckHandle {
    pub fn id(&self) -> u64 {
        self.id
    }

    /// Drop everything buffered so the producer can restart from a new position.
    pub fn flush(&self) {
        lock(&self.output.mixer).flush_deck(self.id);
    }

    #[cfg(test)]
    pub fn set_playing(&self, playing: bool) {
        self.shared
            .playing
            .store(playing, std::sync::atomic::Ordering::Relaxed);
        if playing {
            self.output.ensure_stream();
        }
    }

    /// Free slots in the ring, in samples.
    pub fn free_samples(&self) -> usize {
        self.producer.slots()
    }
}

impl Drop for DeckHandle {
    fn drop(&mut self) {
        lock(&self.output.mixer).remove_deck(self.id);
    }
}

fn lock(mixer: &Mutex<Mixer>) -> std::sync::MutexGuard<'_, Mixer> {
    mixer
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl AudioOutput {
    pub fn new(factory: impl StreamFactory) -> Self {
        let mixer = Arc::new(Mutex::new(Mixer::new()));
        let heartbeat = Arc::new(AtomicU64::new(0));
        let (ctl, rx) = mpsc::channel();
        let output = Self {
            mixer: Arc::clone(&mixer),
            ctl: ctl.clone(),
            heartbeat: Arc::clone(&heartbeat),
        };
        let thread_mixer = Arc::clone(&mixer);
        let spawned = thread::Builder::new()
            .name("native-audio-output".into())
            .spawn(move || {
                OutputThread {
                    factory: Box::new(factory),
                    mixer: thread_mixer,
                    heartbeat,
                    ctl,
                    rx,
                    stream: None,
                    generation: 0,
                    sleeping: false,
                    idle_since: None,
                    last_beat: 0,
                    beat_changed_at: Instant::now(),
                    retry_at: None,
                    retry_delay: RETRY_MIN,
                    build_failures: 0,
                }
                .run();
            });
        if let Err(err) = spawned {
            log_warn(format!("could not start output thread: {err}"));
        }
        output
    }

    /// Register a deck. `ring_seconds` of source audio can be buffered ahead.
    pub fn create_deck(
        &self,
        channels: usize,
        src_rate: u32,
        ring_seconds: f64,
    ) -> Result<DeckHandle, String> {
        let capacity = ((src_rate as f64 * ring_seconds) as usize).max(4096) * channels;
        let (producer, consumer) = RingBuffer::new(capacity);
        let shared = Arc::new(DeckShared::new());
        let id = lock(&self.mixer).add_deck(consumer, Arc::clone(&shared), channels, src_rate)?;
        Ok(DeckHandle {
            id,
            producer,
            shared,
            channels,
            src_rate,
            output: self.clone(),
        })
    }

    /// Splice deck `to` onto the end of deck `from` sample-accurately.
    pub fn link_gapless(&self, from: u64, to: u64) -> Result<(), String> {
        lock(&self.mixer).link_gapless(from, to)?;
        self.ensure_stream();
        Ok(())
    }

    pub fn set_equalizer(&self, settings: super::dsp::EqSettings) {
        lock(&self.mixer).set_equalizer(settings);
    }

    pub fn ensure_stream(&self) {
        let _ = self.ctl.send(Ctl::Ensure);
    }

    pub fn notify_will_sleep(&self) {
        let _ = self.ctl.send(Ctl::WillSleep);
    }

    pub fn notify_did_wake(&self) {
        let _ = self.ctl.send(Ctl::DidWake);
    }

    /// Output callbacks run so far (diagnostics and tests).
    #[cfg(test)]
    pub fn callback_count(&self) -> u64 {
        self.heartbeat.load(Ordering::Relaxed)
    }
}

fn log_info(message: String) {
    crate::activity_log::log(
        crate::activity_log::LogLevel::Info,
        LOG_DOMAIN,
        message,
        None,
    );
}

fn log_warn(message: String) {
    crate::activity_log::log(
        crate::activity_log::LogLevel::Warn,
        LOG_DOMAIN,
        message,
        None,
    );
}

struct OutputThread {
    factory: Box<dyn StreamFactory>,
    mixer: Arc<Mutex<Mixer>>,
    heartbeat: Arc<AtomicU64>,
    ctl: Sender<Ctl>,
    rx: mpsc::Receiver<Ctl>,
    stream: Option<Box<dyn ActiveStream>>,
    /// Bumped per build so a late error from a dead stream cannot kill its successor.
    generation: u64,
    sleeping: bool,
    idle_since: Option<Instant>,
    last_beat: u64,
    beat_changed_at: Instant,
    retry_at: Option<Instant>,
    retry_delay: Duration,
    build_failures: u32,
}

impl OutputThread {
    fn run(mut self) {
        loop {
            match self.rx.recv_timeout(TICK) {
                Ok(Ctl::Ensure) | Err(RecvTimeoutError::Timeout) => {}
                Ok(Ctl::WillSleep) => {
                    self.sleeping = true;
                    if self.stream.take().is_some() {
                        log_info("system will sleep; closed stream".into());
                    } else {
                        log_info("system will sleep".into());
                    }
                }
                Ok(Ctl::DidWake) => {
                    self.sleeping = false;
                    // Whatever the device did while we slept, start from a clean bind.
                    let had_stream = self.stream.take().is_some();
                    self.retry_at = None;
                    self.retry_delay = RETRY_MIN;
                    log_info(format!(
                        "system did wake; {}",
                        if had_stream {
                            "dropped stale stream"
                        } else {
                            "no open stream"
                        }
                    ));
                }
                Ok(Ctl::StreamError {
                    generation,
                    message,
                }) => {
                    if generation == self.generation && self.stream.is_some() {
                        log_warn(format!("stream error: {message}; rebuilding"));
                        self.stream = None;
                        self.retry_at = None;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => return,
            }
            self.tick();
        }
    }

    fn tick(&mut self) {
        if self.sleeping {
            return;
        }
        let wants = lock(&self.mixer).wants_output();
        match (wants, self.stream.is_some()) {
            (true, false) => {
                self.idle_since = None;
                if self.retry_at.is_none_or(|at| Instant::now() >= at) {
                    self.try_build();
                }
            }
            (true, true) => {
                self.idle_since = None;
                self.check_watchdog();
            }
            (false, true) => {
                let since = *self.idle_since.get_or_insert_with(Instant::now);
                if since.elapsed() >= IDLE_CLOSE {
                    self.stream = None;
                    self.idle_since = None;
                    log_info("idle; closed stream".into());
                }
            }
            (false, false) => self.idle_since = None,
        }
    }

    fn check_watchdog(&mut self) {
        let beat = self.heartbeat.load(Ordering::Relaxed);
        if beat != self.last_beat {
            self.last_beat = beat;
            self.beat_changed_at = Instant::now();
        } else if self.beat_changed_at.elapsed() >= WATCHDOG {
            log_warn("output callback stalled; rebuilding stream".into());
            self.stream = None;
            self.retry_at = None;
        }
    }

    fn try_build(&mut self) {
        self.generation += 1;
        let generation = self.generation;
        let started = Instant::now();

        let render_mixer = Arc::clone(&self.mixer);
        let heartbeat = Arc::clone(&self.heartbeat);
        let render: Render = Box::new(move |data: &mut [f32]| {
            heartbeat.fetch_add(1, Ordering::Relaxed);
            match render_mixer.try_lock() {
                Ok(mut mixer) => mixer.render(data),
                Err(_) => data.fill(0.0),
            }
        });
        let ctl = self.ctl.clone();
        let ctl = Mutex::new(ctl);
        let on_error: ErrorSink = Box::new(move |message| {
            if let Ok(ctl) = ctl.lock() {
                let _ = ctl.send(Ctl::StreamError {
                    generation,
                    message,
                });
            }
        });

        match self.factory.build(render, on_error) {
            Ok((stream, info)) => {
                lock(&self.mixer).set_output_format(info.sample_rate, info.channels);
                if let Err(err) = stream.start() {
                    self.note_failure(format!("could not start stream: {err}"));
                    return;
                }
                self.stream = Some(stream);
                self.last_beat = self.heartbeat.load(Ordering::Relaxed);
                self.beat_changed_at = Instant::now();
                self.retry_at = None;
                self.retry_delay = RETRY_MIN;
                let failures = std::mem::take(&mut self.build_failures);
                log_info(format!(
                    "stream built device=\"{}\" rate={} channels={} in {} ms{}",
                    info.device,
                    info.sample_rate,
                    info.channels,
                    started.elapsed().as_millis(),
                    if failures > 0 {
                        format!(" after {failures} failed attempt(s)")
                    } else {
                        String::new()
                    }
                ));
            }
            Err(err) => self.note_failure(format!("could not build stream: {err}")),
        }
    }

    fn note_failure(&mut self, message: String) {
        self.build_failures += 1;
        // Log the first failure and then occasionally; a missing device would
        // otherwise fill the activity log every retry.
        if self.build_failures == 1 || self.build_failures.is_multiple_of(20) {
            log_warn(format!(
                "{message} (attempt {}; retrying in {} ms)",
                self.build_failures,
                self.retry_delay.as_millis()
            ));
        }
        self.retry_at = Some(Instant::now() + self.retry_delay);
        self.retry_delay = (self.retry_delay * 2).min(RETRY_MAX);
    }
}

#[cfg(test)]
pub(crate) mod fake {
    //! Scriptable stand-in for the device, shared with the engine tests.
    use super::*;

    #[derive(Default)]
    pub struct FakeState {
        pub render: Mutex<Option<Render>>,
        pub on_error: Mutex<Option<ErrorSink>>,
        pub builds: AtomicU64,
        pub live_streams: AtomicU64,
        /// Number of upcoming builds that should fail.
        pub fail_builds: AtomicU64,
        pub rate: AtomicU64,
    }

    impl FakeState {
        pub fn new(rate: u32) -> Arc<Self> {
            let state = Self::default();
            state.rate.store(rate as u64, Ordering::SeqCst);
            Arc::new(state)
        }

        /// Pump the active callback like the device would.
        pub fn pump(&self, frames: usize) -> Option<Vec<f32>> {
            let mut guard = self.render.lock().unwrap();
            let render = guard.as_mut()?;
            let mut out = vec![0.0; frames * 2];
            render(&mut out);
            Some(out)
        }

        pub fn raise_error(&self, message: &str) {
            if let Some(sink) = self.on_error.lock().unwrap().as_ref() {
                sink(message.to_string());
            }
        }
    }

    pub struct FakeFactory(pub Arc<FakeState>);

    struct FakeStream(Arc<FakeState>);

    impl ActiveStream for FakeStream {
        fn start(&self) -> Result<(), String> {
            Ok(())
        }
    }

    impl Drop for FakeStream {
        fn drop(&mut self) {
            self.0.live_streams.fetch_sub(1, Ordering::SeqCst);
            *self.0.render.lock().unwrap() = None;
        }
    }

    impl StreamFactory for FakeFactory {
        fn build(
            &mut self,
            render: Render,
            on_error: ErrorSink,
        ) -> Result<(Box<dyn ActiveStream>, StreamInfo), String> {
            let state = &self.0;
            state.builds.fetch_add(1, Ordering::SeqCst);
            if state.fail_builds.load(Ordering::SeqCst) > 0 {
                state.fail_builds.fetch_sub(1, Ordering::SeqCst);
                return Err("no device".into());
            }
            state.live_streams.fetch_add(1, Ordering::SeqCst);
            *state.render.lock().unwrap() = Some(render);
            *state.on_error.lock().unwrap() = Some(on_error);
            Ok((
                Box::new(FakeStream(Arc::clone(state))),
                StreamInfo {
                    sample_rate: state.rate.load(Ordering::SeqCst) as u32,
                    channels: 2,
                    device: "fake".into(),
                },
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::{FakeFactory, FakeState};
    use super::*;

    fn wait_for(what: &str, mut cond: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if cond() {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("timed out waiting for {what}");
    }

    fn setup() -> (AudioOutput, Arc<FakeState>, DeckHandle) {
        let state = FakeState::new(48_000);
        let output = AudioOutput::new(FakeFactory(Arc::clone(&state)));
        let mut deck = output.create_deck(2, 48_000, 1.0).expect("deck");
        for _ in 0..20_000 {
            deck.producer.push(0.25).expect("room");
        }
        (output, state, deck)
    }

    #[test]
    fn stream_opens_lazily_on_play() {
        let (_output, state, deck) = setup();
        assert_eq!(state.builds.load(Ordering::SeqCst), 0, "lazy");
        deck.set_playing(true);
        wait_for("stream", || state.live_streams.load(Ordering::SeqCst) == 1);
        let out = state.pump(2000).expect("callback");
        assert!(out[out.len() - 1] > 0.2);
    }

    #[test]
    fn device_error_rebuilds_and_keeps_position() {
        let (_output, state, deck) = setup();
        deck.set_playing(true);
        wait_for("stream", || state.live_streams.load(Ordering::SeqCst) == 1);
        state.pump(4800);
        let before = deck.shared.position_frames.load(Ordering::Relaxed);
        assert!(before > 4000);

        state.raise_error("DeviceNotAvailable");
        wait_for("rebuild", || state.builds.load(Ordering::SeqCst) == 2);
        wait_for("new stream", || {
            state.live_streams.load(Ordering::SeqCst) == 1 && state.render.lock().unwrap().is_some()
        });
        state.pump(4800);
        let after = deck.shared.position_frames.load(Ordering::Relaxed);
        assert!(
            after > before + 4000,
            "playback continued: {before} -> {after}"
        );
    }

    #[test]
    fn failed_builds_back_off_then_recover() {
        let state = FakeState::new(48_000);
        state.fail_builds.store(2, Ordering::SeqCst);
        let output = AudioOutput::new(FakeFactory(Arc::clone(&state)));
        let mut deck = output.create_deck(2, 48_000, 1.0).expect("deck");
        for _ in 0..4000 {
            deck.producer.push(0.25).expect("room");
        }
        deck.set_playing(true);
        wait_for("recovery", || {
            state.live_streams.load(Ordering::SeqCst) == 1
        });
        assert_eq!(state.builds.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn wake_drops_the_stale_stream_and_rebinds() {
        let (output, state, deck) = setup();
        deck.set_playing(true);
        wait_for("stream", || state.live_streams.load(Ordering::SeqCst) == 1);

        output.notify_will_sleep();
        wait_for("closed for sleep", || {
            state.live_streams.load(Ordering::SeqCst) == 0
        });
        thread::sleep(Duration::from_millis(250));
        assert_eq!(
            state.builds.load(Ordering::SeqCst),
            1,
            "no rebuild while asleep"
        );

        output.notify_did_wake();
        wait_for("rebuilt after wake", || {
            state.builds.load(Ordering::SeqCst) == 2
                && state.live_streams.load(Ordering::SeqCst) == 1
        });
    }

    #[test]
    fn sample_rate_change_is_picked_up_on_rebuild() {
        let (_output, state, deck) = setup();
        deck.set_playing(true);
        wait_for("stream", || state.live_streams.load(Ordering::SeqCst) == 1);
        state.pump(4800);
        let before = deck.shared.position_frames.load(Ordering::Relaxed);

        state.rate.store(96_000, Ordering::SeqCst);
        state.raise_error("DeviceChanged");
        wait_for("rebuild", || state.builds.load(Ordering::SeqCst) == 2);
        wait_for("new stream", || state.render.lock().unwrap().is_some());
        state.pump(9600);
        let after = deck.shared.position_frames.load(Ordering::Relaxed);
        // 9600 frames at 96 kHz out is ~4800 source frames at 48 kHz.
        assert!(
            (after - before) < 5500,
            "source consumption follows the new device rate: {}",
            after - before
        );
    }

    #[test]
    fn stale_error_from_a_replaced_stream_is_ignored() {
        let (_output, state, deck) = setup();
        deck.set_playing(true);
        wait_for("stream", || state.live_streams.load(Ordering::SeqCst) == 1);
        state.raise_error("first");
        wait_for("rebuild", || state.builds.load(Ordering::SeqCst) == 2);
        wait_for("new stream", || state.render.lock().unwrap().is_some());

        // The old stream's sink is gone from the fake; only the new one remains.
        thread::sleep(Duration::from_millis(250));
        assert_eq!(state.builds.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn dropping_a_deck_frees_the_slot() {
        let state = FakeState::new(48_000);
        let output = AudioOutput::new(FakeFactory(state));
        let a = output.create_deck(2, 48_000, 0.5).expect("a");
        let _b = output.create_deck(2, 48_000, 0.5).expect("b");
        assert!(output.create_deck(2, 48_000, 0.5).is_err());
        drop(a);
        assert!(output.create_deck(2, 48_000, 0.5).is_ok());
    }
}
