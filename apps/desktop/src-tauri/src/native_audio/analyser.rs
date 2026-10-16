//! Spectrum and waveform tap for the visualizer.
//!
//! Reproduces what the webview's `AnalyserNode` (fftSize 256, smoothing 0.8,
//! -100…-30 dB) returned, so the visualizers read the same byte data. The audio
//! callback only pushes mono samples into a ring; everything else runs on the
//! analyser thread.

use std::f32::consts::TAU;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use rtrb::Consumer;

pub const FFT_SIZE: usize = 256;
pub const BIN_COUNT: usize = FFT_SIZE / 2;
/// One frame on the wire: frequency bytes followed by time-domain bytes.
pub const FRAME_BYTES: usize = BIN_COUNT + FFT_SIZE;

const SMOOTHING: f32 = 0.8;
const MIN_DECIBELS: f32 = -100.0;
const MAX_DECIBELS: f32 = -30.0;
/// ~60 frames per second, like the animation loop that consumes them.
const FRAME_INTERVAL: Duration = Duration::from_millis(16);
/// Samples the tap ring holds; ~170 ms at 48 kHz covers a stalled analyser thread.
pub const TAP_RING_SAMPLES: usize = 8192;

pub struct SpectrumAnalyser {
    /// The most recent `FFT_SIZE` mono samples, oldest first.
    window: [f32; FFT_SIZE],
    blackman: [f32; FFT_SIZE],
    smoothed: [f32; BIN_COUNT],
}

impl Default for SpectrumAnalyser {
    fn default() -> Self {
        Self::new()
    }
}

impl SpectrumAnalyser {
    pub fn new() -> Self {
        // Blackman window with alpha 0.16, as the Web Audio spec defines it.
        let alpha = 0.16f32;
        let (a0, a1, a2) = ((1.0 - alpha) / 2.0, 0.5, alpha / 2.0);
        let mut blackman = [0.0; FFT_SIZE];
        for (n, w) in blackman.iter_mut().enumerate() {
            let phase = TAU * n as f32 / FFT_SIZE as f32;
            *w = a0 - a1 * phase.cos() + a2 * (2.0 * phase).cos();
        }
        Self {
            window: [0.0; FFT_SIZE],
            blackman,
            smoothed: [0.0; BIN_COUNT],
        }
    }

    pub fn push_samples(&mut self, samples: &[f32]) {
        if samples.len() >= FFT_SIZE {
            self.window
                .copy_from_slice(&samples[samples.len() - FFT_SIZE..]);
            return;
        }
        self.window.copy_within(samples.len().., 0);
        self.window[FFT_SIZE - samples.len()..].copy_from_slice(samples);
    }

    pub fn push_silence(&mut self) {
        self.window = [0.0; FFT_SIZE];
    }

    /// Compute one frame: `BIN_COUNT` frequency bytes then `FFT_SIZE` time-domain bytes.
    pub fn frame(&mut self) -> [u8; FRAME_BYTES] {
        let mut re = [0.0f32; FFT_SIZE];
        let mut im = [0.0f32; FFT_SIZE];
        for (n, slot) in re.iter_mut().enumerate() {
            *slot = self.window[n] * self.blackman[n];
        }
        fft(&mut re, &mut im);

        let mut frame = [0u8; FRAME_BYTES];
        for k in 0..BIN_COUNT {
            let magnitude = (re[k] * re[k] + im[k] * im[k]).sqrt() / FFT_SIZE as f32;
            self.smoothed[k] = SMOOTHING * self.smoothed[k] + (1.0 - SMOOTHING) * magnitude;
            let db = 20.0 * self.smoothed[k].max(1e-12).log10();
            let scaled = 255.0 / (MAX_DECIBELS - MIN_DECIBELS) * (db - MIN_DECIBELS);
            frame[k] = scaled.clamp(0.0, 255.0) as u8;
        }
        for (slot, sample) in frame[BIN_COUNT..].iter_mut().zip(self.window.iter()) {
            *slot = (128.0 * (1.0 + sample)).clamp(0.0, 255.0) as u8;
        }
        frame
    }
}

/// In-place iterative radix-2 FFT (length must be `FFT_SIZE`).
fn fft(re: &mut [f32; FFT_SIZE], im: &mut [f32; FFT_SIZE]) {
    let bits = FFT_SIZE.trailing_zeros();
    for i in 0..FFT_SIZE {
        let j = i.reverse_bits() >> (usize::BITS - bits);
        if j > i {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= FFT_SIZE {
        let angle = -TAU / len as f32;
        for start in (0..FFT_SIZE).step_by(len) {
            for k in 0..len / 2 {
                let (sin, cos) = (angle * k as f32).sin_cos();
                let (a, b) = (start + k, start + k + len / 2);
                let tr = re[b] * cos - im[b] * sin;
                let ti = re[b] * sin + im[b] * cos;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
        len *= 2;
    }
}

/// Background thread that turns tapped samples into frames for `sink`.
pub struct AnalyserTask {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl AnalyserTask {
    /// `sink` receives each changed frame; returning `false` ends the task
    /// (the receiver went away).
    pub fn spawn(
        mut tap: Consumer<f32>,
        mut sink: impl FnMut(&[u8; FRAME_BYTES]) -> bool + Send + 'static,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let handle = thread::Builder::new()
            .name("native-audio-analyser".into())
            .spawn(move || {
                let mut analyser = SpectrumAnalyser::new();
                let mut scratch: Vec<f32> = Vec::with_capacity(TAP_RING_SAMPLES);
                let mut last: Option<[u8; FRAME_BYTES]> = None;
                while !thread_stop.load(Ordering::Relaxed) {
                    let tick = Instant::now();
                    scratch.clear();
                    while let Ok(sample) = tap.pop() {
                        scratch.push(sample);
                    }
                    if scratch.is_empty() {
                        // No stream is running: the signal is silence, and the
                        // smoothing lets the spectrum decay instead of freezing.
                        analyser.push_silence();
                    } else {
                        analyser.push_samples(&scratch);
                    }
                    let frame = analyser.frame();
                    if last.as_ref() != Some(&frame) {
                        if !sink(&frame) {
                            return;
                        }
                        last = Some(frame);
                    }
                    if let Some(rest) = FRAME_INTERVAL.checked_sub(tick.elapsed()) {
                        thread::sleep(rest);
                    }
                }
            })
            .ok();
        Self { stop, handle }
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for AnalyserTask {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rtrb::RingBuffer;
    use std::sync::mpsc;

    fn sine(freq: f32, rate: f32, amplitude: f32, frames: usize) -> Vec<f32> {
        (0..frames)
            .map(|n| (TAU * freq * n as f32 / rate).sin() * amplitude)
            .collect()
    }

    fn settle(analyser: &mut SpectrumAnalyser, samples: &[f32]) -> [u8; FRAME_BYTES] {
        let mut frame = [0; FRAME_BYTES];
        for _ in 0..40 {
            analyser.push_samples(samples);
            frame = analyser.frame();
        }
        frame
    }

    #[test]
    fn fft_matches_a_naive_dft() {
        let input: Vec<f32> = (0..FFT_SIZE)
            .map(|n| (n as f32 * 0.37).sin() + 0.3 * (n as f32 * 1.9).cos())
            .collect();
        let mut re = [0.0; FFT_SIZE];
        let mut im = [0.0; FFT_SIZE];
        re.copy_from_slice(&input);
        fft(&mut re, &mut im);
        for k in [0usize, 1, 7, 40, 127] {
            let (mut sr, mut si) = (0.0f64, 0.0f64);
            for (n, x) in input.iter().enumerate() {
                let angle = -(std::f64::consts::TAU) * (k * n) as f64 / FFT_SIZE as f64;
                sr += *x as f64 * angle.cos();
                si += *x as f64 * angle.sin();
            }
            assert!((re[k] as f64 - sr).abs() < 1e-2, "re[{k}]");
            assert!((im[k] as f64 - si).abs() < 1e-2, "im[{k}]");
        }
    }

    #[test]
    fn silence_is_zero_spectrum_and_centred_waveform() {
        let mut analyser = SpectrumAnalyser::new();
        let frame = analyser.frame();
        assert!(frame[..BIN_COUNT].iter().all(|b| *b == 0));
        assert!(frame[BIN_COUNT..].iter().all(|b| *b == 128));
    }

    #[test]
    fn a_tone_peaks_in_its_bin_at_the_web_audio_level() {
        // Bin 5 centre at 48 kHz: 5 * 48000 / 256 = 937.5 Hz. Amplitude 0.01
        // through the Blackman window (coherent gain 0.42) is about -53.5 dB,
        // which the -100…-30 dB scale maps to ~169.
        let mut analyser = SpectrumAnalyser::new();
        let tone = sine(937.5, 48_000.0, 0.01, FFT_SIZE);
        let frame = settle(&mut analyser, &tone);
        let (peak_bin, peak) = frame[..BIN_COUNT]
            .iter()
            .enumerate()
            .max_by_key(|(_, v)| **v)
            .unwrap();
        assert_eq!(peak_bin, 5);
        assert!((160..=178).contains(peak), "peak byte {peak}");
        assert!(frame[60] < 60, "far bins stay low: {}", frame[60]);
    }

    #[test]
    fn loud_signals_saturate_at_255() {
        let mut analyser = SpectrumAnalyser::new();
        let frame = settle(&mut analyser, &sine(937.5, 48_000.0, 0.9, FFT_SIZE));
        assert_eq!(frame[5], 255);
    }

    #[test]
    fn smoothing_makes_the_spectrum_rise_and_decay_gradually() {
        let mut analyser = SpectrumAnalyser::new();
        let tone = sine(937.5, 48_000.0, 0.05, FFT_SIZE);
        analyser.push_samples(&tone);
        let first = analyser.frame()[5];
        let steady = settle(&mut analyser, &tone)[5];
        assert!(
            first + 20 < steady,
            "rises over frames: {first} -> {steady}"
        );

        analyser.push_silence();
        let after_one = analyser.frame()[5];
        assert!(
            after_one > 0 && after_one < steady,
            "decays, not drops: {after_one}"
        );
        for _ in 0..80 {
            analyser.push_silence();
            analyser.frame();
        }
        assert_eq!(analyser.frame()[5], 0, "eventually silent");
    }

    #[test]
    fn waveform_bytes_follow_the_web_audio_encoding() {
        let mut analyser = SpectrumAnalyser::new();
        let mut samples = vec![0.0; FFT_SIZE];
        samples[FFT_SIZE - 1] = 0.5;
        samples[FFT_SIZE - 2] = -0.5;
        samples[FFT_SIZE - 3] = 1.5; // over-range clips
        analyser.push_samples(&samples);
        let wave = &analyser.frame()[BIN_COUNT..];
        assert_eq!(wave[FFT_SIZE - 1], 192);
        assert_eq!(wave[FFT_SIZE - 2], 64);
        assert_eq!(wave[FFT_SIZE - 3], 255);
        assert_eq!(wave[0], 128);
    }

    #[test]
    fn pushing_fewer_samples_slides_the_window() {
        let mut analyser = SpectrumAnalyser::new();
        analyser.push_samples(&[0.5; 10]);
        analyser.push_samples(&[-0.5; 10]);
        let wave = &analyser.frame()[BIN_COUNT..];
        assert_eq!(wave[FFT_SIZE - 1], 64);
        assert_eq!(wave[FFT_SIZE - 11], 192);
        assert_eq!(wave[FFT_SIZE - 21], 128);
    }

    #[test]
    fn task_delivers_only_changed_frames_and_stops() {
        let (mut producer, consumer) = RingBuffer::new(TAP_RING_SAMPLES);
        let (tx, rx) = mpsc::channel();
        let mut task = AnalyserTask::spawn(consumer, move |frame| tx.send(frame.to_vec()).is_ok());

        for sample in sine(937.5, 48_000.0, 0.2, 2048) {
            producer.push(sample).unwrap();
        }
        // The first frame may be the initial silent one; wait for the tone.
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut heard = false;
        while Instant::now() < deadline && !heard {
            let frame = rx.recv_timeout(Duration::from_secs(1)).expect("a frame");
            assert_eq!(frame.len(), FRAME_BYTES);
            heard = frame[..BIN_COUNT].iter().any(|b| *b > 0);
        }
        assert!(heard, "the tone reached the sink");

        // With no more input the spectrum decays to zero, then frames stop.
        let mut quiet = false;
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(300)) {
                Ok(f) => quiet = f[..BIN_COUNT].iter().all(|b| *b == 0),
                Err(_) => break,
            }
        }
        assert!(quiet, "decayed to silence");
        assert!(
            rx.recv_timeout(Duration::from_millis(200)).is_err(),
            "no frames while the output is unchanged"
        );
        task.stop();
    }

    #[test]
    fn task_ends_when_the_receiver_goes_away() {
        let (_producer, consumer) = RingBuffer::<f32>::new(TAP_RING_SAMPLES);
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = Arc::clone(&calls);
        let mut task = AnalyserTask::spawn(consumer, move |_| {
            counted.fetch_add(1, Ordering::SeqCst);
            false
        });
        // Silence never changes from the initial frame, so feed the first one through
        // by waiting for the thread to exit on its own.
        thread::sleep(Duration::from_millis(100));
        task.stop();
        assert!(calls.load(Ordering::SeqCst) <= 1);
    }
}
