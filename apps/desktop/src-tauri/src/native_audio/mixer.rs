//! Real-time mixer: pulls decoded PCM from per-deck rings and renders device frames.
//!
//! Pure and device-agnostic so it can be driven by a fake clock in tests. The
//! render path never allocates or blocks; control threads reach it through a
//! `Mutex<Mixer>` that the audio callback only `try_lock`s.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use rtrb::Consumer;

/// Highest source channel count a deck can carry.
pub const MAX_CHANNELS: usize = 8;
/// Maximum simultaneous decks (outgoing + incoming).
pub const MAX_DECKS: usize = 2;
/// Length of the play/pause fade that removes clicks.
const FADE_SECONDS: f32 = 0.008;
/// Time constant for volume changes.
const GAIN_SMOOTH_SECONDS: f32 = 0.010;

/// State shared between a deck's producer thread, the mixer and observers.
pub struct DeckShared {
    /// Output should be audible (target; the mixer fades toward it).
    pub playing: AtomicBool,
    /// Producer has pushed the final sample of the stream.
    pub eos: AtomicBool,
    /// Ring drained after `eos`; nothing left to play.
    pub finished: AtomicBool,
    /// Set when a gapless splice started this deck inside the audio callback;
    /// the deck's owner clears it when it reports the start.
    pub gapless_started: AtomicBool,
    /// Source frames consumed since the start of the file (seek-adjusted).
    pub position_frames: AtomicU64,
    /// Output callbacks that found the ring empty while playing.
    pub underruns: AtomicU64,
    /// Linear gain as f32 bits (volume × mute).
    gain_bits: AtomicU32,
}

impl DeckShared {
    pub fn new() -> Self {
        Self {
            playing: AtomicBool::new(false),
            eos: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            gapless_started: AtomicBool::new(false),
            position_frames: AtomicU64::new(0),
            underruns: AtomicU64::new(0),
            gain_bits: AtomicU32::new(1.0f32.to_bits()),
        }
    }

    pub fn set_gain(&self, gain: f32) {
        self.gain_bits
            .store(gain.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
    }

    pub fn gain(&self) -> f32 {
        f32::from_bits(self.gain_bits.load(Ordering::Relaxed))
    }
}

impl Default for DeckShared {
    fn default() -> Self {
        Self::new()
    }
}

struct Deck {
    id: u64,
    consumer: Consumer<f32>,
    shared: Arc<DeckShared>,
    channels: usize,
    src_rate: u32,
    /// Interpolation endpoints (source frames).
    prev: [f32; MAX_CHANNELS],
    next: [f32; MAX_CHANNELS],
    /// Fractional position between `prev` (0.0) and `next` (1.0).
    pos: f64,
    primed: bool,
    /// Deck that starts on the exact frame this one runs out (gapless splice).
    successor: Option<u64>,
    /// 0..=1 fade applied for play/pause transitions.
    fade: f32,
    smoothed_gain: f32,
}

impl Deck {
    fn pop_frame(&mut self, out: &mut [f32; MAX_CHANNELS]) -> bool {
        if self.consumer.slots() < self.channels {
            return false;
        }
        for sample in out.iter_mut().take(self.channels) {
            // `slots()` guarantees these pops succeed (single consumer).
            *sample = self.consumer.pop().unwrap_or(0.0);
        }
        true
    }

    fn reset_interpolation(&mut self) {
        self.prev = [0.0; MAX_CHANNELS];
        self.next = [0.0; MAX_CHANNELS];
        self.pos = 0.0;
        self.primed = false;
    }

    fn drain_ring(&mut self) {
        while self.consumer.pop().is_ok() {}
    }
}

pub struct Mixer {
    decks: Vec<Deck>,
    next_id: u64,
    out_rate: u32,
    out_channels: usize,
}

impl Mixer {
    pub fn new() -> Self {
        Self {
            decks: Vec::with_capacity(MAX_DECKS),
            next_id: 1,
            out_rate: 48_000,
            out_channels: 2,
        }
    }

    pub fn set_output_format(&mut self, rate: u32, channels: usize) {
        self.out_rate = rate.max(1);
        self.out_channels = channels.max(1);
    }

    pub fn add_deck(
        &mut self,
        consumer: Consumer<f32>,
        shared: Arc<DeckShared>,
        channels: usize,
        src_rate: u32,
    ) -> Result<u64, String> {
        if self.decks.len() >= MAX_DECKS {
            return Err("native audio: both decks are in use".into());
        }
        if channels == 0 || channels > MAX_CHANNELS {
            return Err(format!(
                "native audio: unsupported channel count {channels}"
            ));
        }
        let id = self.next_id;
        self.next_id += 1;
        let gain = shared.gain();
        self.decks.push(Deck {
            id,
            consumer,
            shared,
            channels,
            src_rate: src_rate.max(1),
            prev: [0.0; MAX_CHANNELS],
            next: [0.0; MAX_CHANNELS],
            pos: 0.0,
            primed: false,
            successor: None,
            fade: 0.0,
            smoothed_gain: gain,
        });
        Ok(id)
    }

    /// Start `to` on the very frame `from` runs out, with no fade and no gap.
    /// `to` stays silent until then even though its ring may already be full.
    pub fn link_gapless(&mut self, from: u64, to: u64) -> Result<(), String> {
        if !self.decks.iter().any(|deck| deck.id == to) {
            return Err("native audio: gapless target deck is gone".into());
        }
        let Some(source) = self.decks.iter_mut().find(|deck| deck.id == from) else {
            return Err("native audio: gapless source deck is gone".into());
        };
        if !source.shared.finished.load(Ordering::Relaxed) {
            source.successor = Some(to);
            return Ok(());
        }
        // The source already ran out before the link arrived; there is no frame
        // to align to, so start the successor now rather than never.
        if let Some(target) = self.decks.iter_mut().find(|deck| deck.id == to) {
            target.fade = 1.0;
            target.shared.playing.store(true, Ordering::Relaxed);
            target.shared.gapless_started.store(true, Ordering::Release);
        }
        Ok(())
    }

    pub fn remove_deck(&mut self, id: u64) {
        self.decks.retain(|deck| deck.id != id);
    }

    /// True when any deck should be audible (the device stream is needed).
    pub fn wants_output(&self) -> bool {
        self.decks
            .iter()
            .any(|deck| deck.shared.playing.load(Ordering::Relaxed) || deck.fade > 0.0)
    }

    /// Drop everything buffered for `id` and restart interpolation. The caller
    /// (the deck's only producer) sets `position_frames` afterwards.
    pub fn flush_deck(&mut self, id: u64) {
        if let Some(deck) = self.decks.iter_mut().find(|deck| deck.id == id) {
            deck.drain_ring();
            deck.reset_interpolation();
            deck.shared.finished.store(false, Ordering::Release);
        }
    }

    /// Fill `out` (interleaved, `out_channels` wide) with the mix of all decks.
    pub fn render(&mut self, out: &mut [f32]) {
        out.fill(0.0);
        let out_channels = self.out_channels;
        let frames = out.len() / out_channels;
        if frames == 0 {
            return;
        }
        let out_rate = self.out_rate as f32;
        let mut rendered = [false; MAX_DECKS];
        for index in 0..self.decks.len() {
            if rendered[index] {
                continue;
            }
            rendered[index] = true;
            let mut finished_at = render_deck(
                &mut self.decks[index],
                out,
                frames,
                out_channels,
                out_rate,
                0,
            );
            // Follow the splice chain: each deck that runs out hands the rest of
            // the block to its successor, starting on that same frame.
            let mut current = index;
            while let Some(frame) = finished_at {
                let Some(successor_id) = self.decks[current].successor.take() else {
                    break;
                };
                let Some(next) = self.decks.iter().position(|deck| deck.id == successor_id) else {
                    break;
                };
                if rendered[next] || self.decks[next].shared.finished.load(Ordering::Relaxed) {
                    break;
                }
                rendered[next] = true;
                let successor = &mut self.decks[next];
                successor.fade = 1.0;
                successor.shared.playing.store(true, Ordering::Relaxed);
                successor
                    .shared
                    .gapless_started
                    .store(true, Ordering::Release);
                finished_at = render_deck(successor, out, frames, out_channels, out_rate, frame);
                current = next;
            }
        }
        for sample in out.iter_mut() {
            *sample = sample.clamp(-1.0, 1.0);
        }
    }
}

impl Default for Mixer {
    fn default() -> Self {
        Self::new()
    }
}

fn render_deck(
    deck: &mut Deck,
    out: &mut [f32],
    frames: usize,
    out_channels: usize,
    out_rate: f32,
    start_frame: usize,
) -> Option<usize> {
    let shared = Arc::clone(&deck.shared);
    let want_playing = shared.playing.load(Ordering::Relaxed);
    if !want_playing && deck.fade <= 0.0 {
        return None;
    }
    if shared.finished.load(Ordering::Relaxed) {
        return None;
    }
    let mut finished_at = None;

    let step = deck.src_rate as f64 / out_rate as f64;
    let fade_step = 1.0 / (FADE_SECONDS * out_rate);
    let gain_target = shared.gain();
    let gain_coeff = 1.0 - (-1.0 / (GAIN_SMOOTH_SECONDS * out_rate)).exp();
    let channels = deck.channels;
    let mut consumed: u64 = 0;
    let mut underran = false;

    for frame in start_frame..frames {
        // Fade toward the play/pause target.
        if want_playing {
            deck.fade = (deck.fade + fade_step).min(1.0);
        } else {
            deck.fade = (deck.fade - fade_step).max(0.0);
        }
        deck.smoothed_gain += (gain_target - deck.smoothed_gain) * gain_coeff;

        if !deck.primed {
            let eos = shared.eos.load(Ordering::Acquire);
            let mut first = [0.0; MAX_CHANNELS];
            let mut second = [0.0; MAX_CHANNELS];
            if deck.pop_frame(&mut first) {
                if !deck.pop_frame(&mut second) {
                    // A single-frame stream: hold it.
                    second = first;
                }
                deck.prev = first;
                deck.next = second;
                deck.pos = 0.0;
                deck.primed = true;
                consumed += 2;
            } else {
                if eos {
                    shared.finished.store(true, Ordering::Release);
                    finished_at = Some(frame);
                    break;
                }
                underran = true;
                continue;
            }
        }

        // Advance the source cursor until `pos` is within [0, 1).
        while deck.pos >= 1.0 {
            // Load EOS before popping so a push-then-set race cannot drop the tail.
            let eos = shared.eos.load(Ordering::Acquire);
            let mut incoming = [0.0; MAX_CHANNELS];
            if deck.pop_frame(&mut incoming) {
                deck.prev = deck.next;
                deck.next = incoming;
                deck.pos -= 1.0;
                consumed += 1;
            } else if eos {
                shared.finished.store(true, Ordering::Release);
                finished_at = Some(frame);
                break;
            } else {
                underran = true;
                break;
            }
        }
        if shared.finished.load(Ordering::Relaxed) || deck.pos >= 1.0 {
            if shared.finished.load(Ordering::Relaxed) {
                break;
            }
            continue;
        }

        let t = deck.pos as f32;
        let gain = deck.fade * deck.smoothed_gain;
        let mut src = [0.0f32; MAX_CHANNELS];
        for (ch, slot) in src.iter_mut().enumerate().take(channels) {
            *slot = deck.prev[ch] + (deck.next[ch] - deck.prev[ch]) * t;
        }
        let base = frame * out_channels;
        write_frame(&src, channels, &mut out[base..base + out_channels], gain);
        deck.pos += step;
    }

    if consumed > 0 {
        shared
            .position_frames
            .fetch_add(consumed, Ordering::Relaxed);
    }
    if underran && want_playing {
        shared.underruns.fetch_add(1, Ordering::Relaxed);
    }
    finished_at
}

/// Map `src_channels` to the device layout and accumulate into `out`.
fn write_frame(src: &[f32; MAX_CHANNELS], src_channels: usize, out: &mut [f32], gain: f32) {
    let out_channels = out.len();
    if out_channels == 1 {
        let sum: f32 = src.iter().take(src_channels).sum();
        out[0] += sum / src_channels as f32 * gain;
        return;
    }
    for (ch, slot) in out.iter_mut().enumerate() {
        let value = if src_channels == 1 {
            src[0]
        } else if ch < src_channels {
            src[ch]
        } else {
            0.0
        };
        *slot += value * gain;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rtrb::RingBuffer;

    struct Rig {
        mixer: Mixer,
        producer: rtrb::Producer<f32>,
        shared: Arc<DeckShared>,
        id: u64,
    }

    fn rig(src_rate: u32, channels: usize, out_rate: u32) -> Rig {
        let (producer, consumer) = RingBuffer::new(1 << 16);
        let shared = Arc::new(DeckShared::new());
        let mut mixer = Mixer::new();
        mixer.set_output_format(out_rate, 2);
        let id = mixer
            .add_deck(consumer, Arc::clone(&shared), channels, src_rate)
            .expect("add deck");
        Rig {
            mixer,
            producer,
            shared,
            id,
        }
    }

    fn push_stereo_const(rig: &mut Rig, frames: usize, value: f32) {
        for _ in 0..frames * 2 {
            rig.producer.push(value).expect("ring has room");
        }
    }

    fn render_frames(rig: &mut Rig, frames: usize) -> Vec<f32> {
        let mut out = vec![0.0; frames * 2];
        rig.mixer.render(&mut out);
        out
    }

    #[test]
    fn paused_deck_is_silent_and_consumes_nothing() {
        let mut r = rig(48_000, 2, 48_000);
        push_stereo_const(&mut r, 1000, 0.5);
        let out = render_frames(&mut r, 256);
        assert!(out.iter().all(|s| *s == 0.0));
        assert_eq!(r.shared.position_frames.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn playing_deck_fades_in_then_reaches_unity() {
        let mut r = rig(48_000, 2, 48_000);
        push_stereo_const(&mut r, 4000, 0.5);
        r.shared.playing.store(true, Ordering::Relaxed);
        let out = render_frames(&mut r, 1000);
        assert!(out[0].abs() < 0.05, "starts near silent: {}", out[0]);
        assert!(
            (out[out.len() - 1] - 0.5).abs() < 1e-3,
            "settles at source level"
        );
    }

    #[test]
    fn position_counts_consumed_source_frames() {
        let mut r = rig(48_000, 2, 48_000);
        push_stereo_const(&mut r, 4000, 0.25);
        r.shared.playing.store(true, Ordering::Relaxed);
        render_frames(&mut r, 1000);
        let position = r.shared.position_frames.load(Ordering::Relaxed);
        // Two frames prime the interpolator; the rest advance 1:1.
        assert!((1000..=1002).contains(&position), "position {position}");
    }

    #[test]
    fn upsampling_consumes_fewer_source_frames() {
        let mut r = rig(24_000, 2, 48_000);
        push_stereo_const(&mut r, 4000, 0.25);
        r.shared.playing.store(true, Ordering::Relaxed);
        render_frames(&mut r, 1000);
        let position = r.shared.position_frames.load(Ordering::Relaxed);
        assert!((500..=503).contains(&position), "position {position}");
    }

    #[test]
    fn underrun_is_silent_counted_and_resumes() {
        let mut r = rig(48_000, 2, 48_000);
        r.shared.playing.store(true, Ordering::Relaxed);
        let out = render_frames(&mut r, 128);
        assert!(out.iter().all(|s| *s == 0.0));
        assert!(r.shared.underruns.load(Ordering::Relaxed) > 0);

        push_stereo_const(&mut r, 4000, 0.5);
        let out = render_frames(&mut r, 1000);
        assert!(out[out.len() - 1] > 0.4);
    }

    #[test]
    fn finishes_only_after_ring_drains_following_eos() {
        let mut r = rig(48_000, 2, 48_000);
        push_stereo_const(&mut r, 500, 0.5);
        r.shared.eos.store(true, Ordering::Release);
        r.shared.playing.store(true, Ordering::Relaxed);

        render_frames(&mut r, 250);
        assert!(!r.shared.finished.load(Ordering::Relaxed));
        render_frames(&mut r, 1000);
        assert!(r.shared.finished.load(Ordering::Relaxed));
    }

    #[test]
    fn flush_discards_buffered_audio_and_clears_finished() {
        let mut r = rig(48_000, 2, 48_000);
        push_stereo_const(&mut r, 2000, 0.5);
        r.shared.eos.store(true, Ordering::Release);
        r.shared.playing.store(true, Ordering::Relaxed);
        render_frames(&mut r, 100);

        r.mixer.flush_deck(r.id);
        r.shared.eos.store(false, Ordering::Release);
        r.shared.position_frames.store(48_000, Ordering::Relaxed);
        push_stereo_const(&mut r, 2000, -0.5);
        let out = render_frames(&mut r, 1000);
        assert!(out[out.len() - 1] < -0.4, "post-seek audio only");
        assert!(!r.shared.finished.load(Ordering::Relaxed));
        let position = r.shared.position_frames.load(Ordering::Relaxed);
        assert!(
            position >= 48_000 + 999,
            "position continues from seek: {position}"
        );
    }

    #[test]
    fn pause_fades_out_and_stops_consuming() {
        let mut r = rig(48_000, 2, 48_000);
        push_stereo_const(&mut r, 8000, 0.5);
        r.shared.playing.store(true, Ordering::Relaxed);
        render_frames(&mut r, 1000);
        r.shared.playing.store(false, Ordering::Relaxed);
        let out = render_frames(&mut r, 1000);
        assert!(out[out.len() - 1].abs() < 1e-6, "silent after fade");
        let frozen = r.shared.position_frames.load(Ordering::Relaxed);
        render_frames(&mut r, 500);
        assert_eq!(r.shared.position_frames.load(Ordering::Relaxed), frozen);
        assert!(!r.mixer.wants_output(), "fade complete releases the stream");
    }

    #[test]
    fn mono_source_is_duplicated_to_both_channels() {
        let (mut producer, consumer) = RingBuffer::new(1 << 12);
        let shared = Arc::new(DeckShared::new());
        let mut mixer = Mixer::new();
        mixer.set_output_format(48_000, 2);
        mixer
            .add_deck(consumer, Arc::clone(&shared), 1, 48_000)
            .expect("add deck");
        for _ in 0..2000 {
            producer.push(0.5).expect("room");
        }
        shared.playing.store(true, Ordering::Relaxed);
        let mut out = vec![0.0; 2000];
        mixer.render(&mut out);
        assert!((out[1998] - 0.5).abs() < 1e-3);
        assert!((out[1999] - 0.5).abs() < 1e-3);
    }

    #[test]
    fn volume_gain_scales_output() {
        let mut r = rig(48_000, 2, 48_000);
        push_stereo_const(&mut r, 8000, 0.8);
        r.shared.set_gain(0.5);
        r.shared.playing.store(true, Ordering::Relaxed);
        let out = render_frames(&mut r, 4000);
        assert!((out[out.len() - 1] - 0.4).abs() < 2e-3);
    }

    fn two_deck_rig(frames_a: usize, frames_b: usize) -> (Mixer, [Arc<DeckShared>; 2], [u64; 2]) {
        let mut mixer = Mixer::new();
        mixer.set_output_format(48_000, 2);
        let mut shared = Vec::new();
        let mut ids = Vec::new();
        for (frames, value) in [(frames_a, 0.5f32), (frames_b, -0.5f32)] {
            let (mut producer, consumer) = RingBuffer::new(1 << 16);
            for _ in 0..frames * 2 {
                producer.push(value).expect("room");
            }
            let deck_shared = Arc::new(DeckShared::new());
            deck_shared.eos.store(true, Ordering::Release);
            ids.push(
                mixer
                    .add_deck(consumer, Arc::clone(&deck_shared), 2, 48_000)
                    .expect("deck"),
            );
            shared.push(deck_shared);
        }
        (
            mixer,
            [Arc::clone(&shared[0]), Arc::clone(&shared[1])],
            [ids[0], ids[1]],
        )
    }

    #[test]
    fn gapless_successor_starts_on_the_frame_the_source_runs_out() {
        let (mut mixer, shared, ids) = two_deck_rig(300, 5000);
        mixer.link_gapless(ids[0], ids[1]).expect("link");
        shared[0].playing.store(true, Ordering::Relaxed);

        // First block: the 300-frame source fades in, runs out, successor takes over.
        let mut out = vec![0.0; 1024 * 2];
        mixer.render(&mut out);

        assert!(shared[0].finished.load(Ordering::Relaxed));
        assert!(shared[1].gapless_started.load(Ordering::Relaxed));
        assert!(shared[1].playing.load(Ordering::Relaxed));

        // No silent frame at the seam: every frame is either deck A (+) or deck B (-).
        let first_b = out
            .chunks(2)
            .position(|frame| frame[0] < 0.0)
            .expect("successor audible in the same block");
        assert!((298..=301).contains(&first_b), "seam at frame {first_b}");
        assert!(
            out.chunks(2)
                .skip(first_b)
                .all(|frame| (frame[0] + 0.5).abs() < 1e-3),
            "successor plays at full level from the first frame, no fade-in"
        );
        assert!(
            out.chunks(2)
                .skip(5)
                .take(first_b - 5)
                .all(|frame| frame[0] > 0.0),
            "no silent frames before the seam"
        );
    }

    #[test]
    fn gapless_successor_stays_silent_until_the_source_finishes() {
        let (mut mixer, shared, ids) = two_deck_rig(5000, 5000);
        mixer.link_gapless(ids[0], ids[1]).expect("link");
        shared[0].playing.store(true, Ordering::Relaxed);

        let mut out = vec![0.0; 1000 * 2];
        mixer.render(&mut out);
        assert!(out.iter().all(|s| *s >= 0.0), "only the source is audible");
        assert!(!shared[1].playing.load(Ordering::Relaxed));
        assert_eq!(shared[1].position_frames.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn gapless_link_after_the_source_already_finished_starts_the_successor() {
        let (mut mixer, shared, ids) = two_deck_rig(100, 5000);
        shared[0].playing.store(true, Ordering::Relaxed);
        let mut out = vec![0.0; 1024 * 2];
        mixer.render(&mut out);
        assert!(shared[0].finished.load(Ordering::Relaxed));

        mixer.link_gapless(ids[0], ids[1]).expect("late link");
        assert!(shared[1].playing.load(Ordering::Relaxed));
        mixer.render(&mut out);
        assert!(out.iter().any(|s| *s < -0.4), "successor audible");
    }

    #[test]
    fn gapless_link_to_a_removed_deck_is_rejected() {
        let (mut mixer, _shared, ids) = two_deck_rig(100, 100);
        mixer.remove_deck(ids[1]);
        assert!(mixer.link_gapless(ids[0], ids[1]).is_err());
    }

    #[test]
    fn third_deck_is_rejected() {
        let mut r = rig(48_000, 2, 48_000);
        let (_, c2) = RingBuffer::new(16);
        r.mixer
            .add_deck(c2, Arc::new(DeckShared::new()), 2, 48_000)
            .expect("second deck");
        let (_, c3) = RingBuffer::new(16);
        assert!(r
            .mixer
            .add_deck(c3, Arc::new(DeckShared::new()), 2, 48_000)
            .is_err());
    }
}
