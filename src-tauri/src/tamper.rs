//! Tamper-response state + reversible decay (anti-tamper Layers 2–3).
//!
//! A process-global "tamper score" that integrity detectors raise when they
//! observe the binary has been modified, and that deliberate, **reversible**
//! decay behaviors read in order to degrade the experience. This module never
//! enforces licensing and never touches user data — the worst any decay does is
//! make the app flaky/unpleasant until a clean binary is restored.
//!
//! Detectors in [`crate::selfcheck`] raise the score in release builds. Decay
//! stays inert in debug builds unless the `tamper-test` feature is on. Severity
//! ramps with cumulative playback time, not with the raw score.

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;

/// Process-global tamper score. `0` == clean.
static SCORE: AtomicU32 = AtomicU32::new(0);
/// Rolling attempt counter driving the transient-failure cadence.
static ATTEMPT: AtomicU32 = AtomicU32::new(0);
/// Rolling seed for the audio-degradation PRNG (not security-sensitive).
static AUDIO_SEED: AtomicU64 = AtomicU64::new(0x2545_F491_4F6C_DD1D);
/// Cumulative milliseconds of audio actually played while tampered — the driver
/// for decay severity (so escalation tracks real listening, not the wall clock).
static PLAYBACK_MS: AtomicU64 = AtomicU64::new(0);

/// Playback-time thresholds (seconds) for the severity ramp: deniable until
/// `DENIABLE_SECS`, full severity at `UNUSABLE_SECS`.
const DENIABLE_SECS: f32 = 8.0 * 60.0; // 8 min
const UNUSABLE_SECS: f32 = 20.0 * 60.0; // 20 min

/// `tamper-test` builds start tripped so QA can verify decay deterministically.
#[cfg(feature = "tamper-test")]
const INITIAL_SCORE: u32 = 1000;
#[cfg(not(feature = "tamper-test"))]
const INITIAL_SCORE: u32 = 0;

/// Seed the score. Call once at startup.
pub fn init() {
    // QA dial (tamper-test only): SPIRAL_TAMPER_SCORE seeds the score so a dev can
    // mark the build "tampered" in `tauri dev --features tamper-test` (any value
    // > 0 trips it; 0 = clean). Severity then escalates with cumulative playback
    // time, exactly like a real patched build — so just play music and it worsens.
    // To jump to a severity without listening, also set SPIRAL_TAMPER_PLAYBACK_SECS
    // (see playback_secs). Gated to the feature so it can never affect a release.
    #[cfg(feature = "tamper-test")]
    {
        let seed = std::env::var("SPIRAL_TAMPER_SCORE")
            .ok()
            .and_then(|v| v.trim().parse::<u32>().ok())
            .unwrap_or(INITIAL_SCORE);
        SCORE.store(seed, Ordering::Relaxed);
    }
    #[cfg(not(feature = "tamper-test"))]
    SCORE.store(INITIAL_SCORE, Ordering::Relaxed);
}

/// Raise the tamper score. Detectors call this; a larger `weight` is a stronger
/// signal. One raise latches the session; severity then follows playback time.
pub fn raise(weight: u32) {
    SCORE.fetch_add(weight, Ordering::Relaxed);
}

/// Current tamper score.
pub fn score() -> u32 {
    SCORE.load(Ordering::Relaxed)
}

/// Whether decay effects may fire in this build: off in dev (`debug`) unless the
/// `tamper-test` QA feature is set; on in release.
#[inline]
fn decay_enabled() -> bool {
    cfg!(not(debug_assertions)) || cfg!(feature = "tamper-test")
}

/// Whether the binary is tampered (a detector raised the score at least once).
/// A sticky latch for the session — escalation severity is driven by playback
/// time, not by the raw score, so one confirmed detection is enough.
fn tampered() -> bool {
    decay_enabled() && score() > 0
}

/// Add played audio time to the escalation driver — only accumulates while
/// tampered, so clean builds never pay and never escalate. Called from the
/// playback stream as chunks are produced.
pub fn add_playback_ms(ms: u64) {
    if tampered() {
        PLAYBACK_MS.fetch_add(ms, Ordering::Relaxed);
    }
}

/// Cumulative played-audio seconds driving severity. Under `tamper-test`,
/// `SPIRAL_TAMPER_PLAYBACK_SECS` pins it so a dev can jump to any severity
/// without listening for 20 minutes.
fn playback_secs() -> f32 {
    #[cfg(feature = "tamper-test")]
    {
        if let Ok(v) = std::env::var("SPIRAL_TAMPER_PLAYBACK_SECS") {
            if let Ok(s) = v.trim().parse::<f32>() {
                return s;
            }
        }
    }
    PLAYBACK_MS.load(Ordering::Relaxed) as f32 / 1000.0
}

/// Pure severity ramp from played seconds: `0` until `DENIABLE_SECS`, rising
/// linearly to `1` at `UNUSABLE_SECS`.
fn severity_from_secs(secs: f32) -> f32 {
    ((secs - DENIABLE_SECS) / (UNUSABLE_SECS - DENIABLE_SECS)).clamp(0.0, 1.0)
}

/// Master decay severity in `[0,1]`: `0` unless tampered, otherwise ramped by
/// cumulative playback time. Every decay behavior scales off this, so the whole
/// experience shares one deniable → unusable arc tied to actual listening.
fn severity() -> f32 {
    if !tampered() {
        return 0.0;
    }
    severity_from_secs(playback_secs())
}

/// `true` with probability equal to the current severity (one PRNG roll). The
/// shared gate for probabilistic behaviors (wrong audio, wrong customization,
/// wrong art): rare early, near-certain near the unusable end.
fn should_fire() -> bool {
    let p = severity();
    p > 0.0 && decay_roll() < p
}

/// Decay: probabilistic degradation gate for a read/op (silent — caller returns
/// an empty/benign result, never a logged error). Severity-ramped by listening.
pub fn should_degrade() -> bool {
    should_fire()
}

/// Decay: whether to scramble library artwork on this load (covers onto the
/// wrong tracks). Probabilistic + ramped, so it is rare early and common late —
/// not an immediate on/off at first detection.
pub fn should_corrupt_artwork() -> bool {
    should_fire()
}

/// Decay (Layer 3): severity-scaled sluggishness on an idempotent read/op.
/// Non-retryable (the retry is just as slow) and deniable. No-op until severity
/// rises. Must only be called off the UI/realtime path (it sleeps the thread).
pub fn decay_delay() {
    let t = severity();
    if t <= 0.0 {
        return;
    }
    let base = 120.0 + 1500.0 * t;
    let jitter = (ATTEMPT.fetch_add(1, Ordering::Relaxed) % 180) as f32;
    std::thread::sleep(std::time::Duration::from_millis((base + jitter) as u64));
}

/// Decay (Layer 3): severity-scaled audio degradation applied in place to a
/// chunk of interleaved f32 PCM. A faint noise floor rising to audible hiss, plus
/// *glitches* that make the song itself stutter: mostly buffer-stutter repeats (a
/// short grain tiled forward — the classic skipping-CD / underrun sound), with
/// some hard silence gaps. **Clamped to `[-1,1]`** so it only ever degrades —
/// never a loud spike that could damage ears/speakers — and can never panic.
/// No-op until severity rises.
pub fn degrade_audio(samples: &mut [f32]) {
    let t = severity();
    if t <= 0.0 {
        return;
    }
    // Steep curve: barely-there glitch near the threshold, escalating hard toward
    // full scale so a persistent tamper becomes genuinely unpleasant.
    let t = t.powf(2.2);
    let noise_amp = 0.004 + 0.22 * t;
    // Per-sample chance of starting a glitch. Rises faster than the noise floor
    // so the track turns choppy, not just hissy, as decay deepens — near-continuous
    // stutter at the unusable end.
    let glitch_p = 0.000_05 + 0.004 * t;

    let mut rng = AUDIO_SEED.fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed) | 1;
    let mut i = 0;
    while i < samples.len() {
        rng ^= rng << 13;
        rng ^= rng >> 7;
        rng ^= rng << 17;
        let r = ((rng >> 40) & 0xFF_FFFF) as f32 / 16_777_215.0; // 0..1
        if r < glitch_p {
            let remaining = samples.len() - i;
            let grain = (128 + (rng as usize >> 8) % 384).min(remaining).max(1);
            // ~2 in 3 glitches repeat the preceding grain (stutter); the rest are
            // hard silence gaps. Repeats are what make the SONG sound stuttery.
            let stutter = (rng >> 33) % 3 != 0 && i >= grain;
            if stutter {
                let reps = 2 + (rng as usize >> 20) % 4; // tile 2..5 times
                let span = (grain * reps).min(remaining);
                for j in 0..span {
                    // Reads trail by `grain`; once past the first copy this tiles
                    // the already-written grain, so it repeats cleanly.
                    samples[i + j] = samples[i + j - grain];
                }
                i += span;
            } else {
                for s in &mut samples[i..i + grain] {
                    *s = 0.0;
                }
                i += grain;
            }
            continue;
        }
        let n = (((rng >> 16) & 0xFFFF) as f32 / 65_535.0 - 0.5) * 2.0 * noise_amp;
        samples[i] = (samples[i] + n).clamp(-1.0, 1.0);
        i += 1;
    }
}

/// Cheap pseudo-random f32 in `[0,1)` for probabilistic decay (not security).
fn decay_roll() -> f32 {
    let mut r = AUDIO_SEED.fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed) | 1;
    r ^= r << 13;
    r ^= r >> 7;
    r ^= r << 17;
    ((r >> 40) & 0xFF_FFFF) as f32 / 16_777_216.0
}

/// Last track path handed to playback, for the wrong-audio decay.
static LAST_PLAYBACK_PATH: Mutex<Option<String>> = Mutex::new(None);

/// Decay (Layer 3): with probability equal to the current severity, return a
/// DIFFERENT (previously selected) track's path to play instead of `requested`,
/// so playing a track yields the wrong audio — chaotic and deniable ("did I
/// click the wrong song?").
///
/// Deliberately audio-only: it swaps *only* the path sent to the playback stream
/// and never the library's stored paths/metadata, so file moves, deletes, and
/// metadata writes always act on the correct file — no data-loss risk. Returns
/// `None` to play the requested track normally.
pub fn swap_playback_path(requested: &str) -> Option<String> {
    if !decay_enabled() {
        return None;
    }
    // Rare early, frequent late — not every track at first detection.
    let swap = should_fire();
    let mut last = LAST_PLAYBACK_PATH.lock().ok()?;
    let previous = last.clone();
    *last = Some(requested.to_string());
    if swap {
        previous.filter(|p| !p.is_empty() && p != requested)
    } else {
        None
    }
}

/// Decay (Layer 3): with probability equal to the current severity, return a
/// *different* id from `available` so selecting a customization (skin, theme,
/// visualizer) silently applies the wrong one — chaotic and deniable, no
/// error/crash log. Returns `None` to honor the requested id. Transient (the
/// frontend still persists the chosen id), so it is reversible.
pub fn swap_customization(requested: &str, available: &[String]) -> Option<String> {
    if !should_fire() {
        return None;
    }
    let others: Vec<&String> = available
        .iter()
        .filter(|id| id.as_str() != requested && !id.is_empty())
        .collect();
    if others.is_empty() {
        return None;
    }
    let idx = ((decay_roll() * others.len() as f32) as usize).min(others.len() - 1);
    Some(others[idx].clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn score_starts_clean_and_raises() {
        // Note: a prior test in the same binary may have raised SCORE; assert
        // relative behavior rather than an absolute starting value.
        let before = score();
        raise(5);
        assert!(score() >= before + 5);
    }

    #[test]
    fn severity_ramp_matches_playback_targets() {
        // deniable for the first 8 min, then linear to full by 20 min.
        assert_eq!(severity_from_secs(0.0), 0.0);
        assert_eq!(severity_from_secs(DENIABLE_SECS), 0.0); // 8 min: still clean
        assert!(severity_from_secs(479.0) == 0.0);
        let s15 = severity_from_secs(15.0 * 60.0); // ~0.58
        assert!((0.5..0.65).contains(&s15), "15 min severity was {s15}");
        let s18 = severity_from_secs(18.0 * 60.0); // ~0.83
        assert!((0.78..0.88).contains(&s18), "18 min severity was {s18}");
        assert_eq!(severity_from_secs(UNUSABLE_SECS), 1.0); // 20 min
        assert_eq!(severity_from_secs(10_000.0), 1.0); // clamped
    }

    #[cfg(not(feature = "tamper-test"))]
    #[test]
    fn decay_is_inert_when_disabled() {
        // Decay compiled off (no tamper-test): all behaviors are no-ops.
        let start = std::time::Instant::now();
        decay_delay();
        assert!(start.elapsed().as_millis() < 50, "delay should be a no-op");

        let mut s = vec![0.1_f32, -0.2, 0.3];
        let orig = s.clone();
        degrade_audio(&mut s);
        assert_eq!(s, orig, "audio should be untouched");
        assert!(!should_corrupt_artwork());
        assert!(swap_playback_path("/a.flac").is_none());
    }

    #[cfg(feature = "tamper-test")]
    #[test]
    fn swap_customization_only_returns_valid_other_ids() {
        // Safety invariants, independent of the (shared, racy) global state: a
        // swap never yields the requested id or anything not in the list, and
        // with no alternative it never invents one.
        let avail = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        for _ in 0..64 {
            if let Some(got) = swap_customization("a", &avail) {
                assert!(
                    got != "a" && avail.contains(&got),
                    "swapped to invalid id: {got}"
                );
            }
        }
        assert_eq!(swap_customization("only", &["only".to_string()]), None);
    }

    #[cfg(feature = "tamper-test")]
    #[test]
    fn degrade_audio_stays_finite_and_clamped() {
        // Invariant: real PCM (already in [-1,1]) always comes out finite and in
        // range — never NaN or a loud spike — whether or not decay is active.
        let mut s = vec![-1.0_f32, -0.9, -0.5, 0.0, 0.3, 0.9, 1.0];
        degrade_audio(&mut s);
        for v in s {
            assert!(
                v.is_finite() && (-1.0..=1.0).contains(&v),
                "sample out of safe range: {v}"
            );
        }
    }

    #[cfg(feature = "tamper-test")]
    #[test]
    fn playback_time_only_accrues_when_tampered() {
        // When tampered (score > 0), playback time accumulates and drives it.
        raise(1);
        let before = PLAYBACK_MS.load(Ordering::Relaxed);
        add_playback_ms(5_000);
        assert!(PLAYBACK_MS.load(Ordering::Relaxed) >= before + 5_000);
    }
}
