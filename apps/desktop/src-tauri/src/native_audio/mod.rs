//! Native audio output: decoded PCM is mixed in Rust and played through the
//! operating system's audio API instead of a webview `AudioContext`.
//!
//! The webview's audio sink can die across macOS sleep/wake in a way no
//! JavaScript can repair (spiral#21). This module owns the device instead and
//! rebuilds the stream after wake, device loss and device changes.

pub mod analyser;
mod cpal_backend;
pub mod dsp;
pub mod mixer;
pub mod output;
mod power;
pub mod sfx;

use std::sync::OnceLock;

pub use output::{AudioOutput, DeckHandle};

static GLOBAL: OnceLock<AudioOutput> = OnceLock::new();

/// The process-wide output stage, started on first use.
pub fn global() -> &'static AudioOutput {
    GLOBAL.get_or_init(|| {
        let output = AudioOutput::new(cpal_backend::CpalFactory);
        power::watch_power_events(output.clone());
        output
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Opens the real default output device and plays a second of a tone.
    /// Needs audio hardware, so it only runs on request:
    /// `cargo test -p Spiral --lib cpal_smoke -- --ignored --nocapture`.
    #[test]
    #[ignore = "needs a real audio output device"]
    fn cpal_smoke_plays_through_the_default_device() {
        let output = global();
        let mut deck = output.create_deck(2, 48_000, 2.0).expect("deck");
        for frame in 0..48_000usize {
            let sample = (frame as f32 * 440.0 * std::f32::consts::TAU / 48_000.0).sin() * 0.1;
            deck.producer.push(sample).expect("room");
            deck.producer.push(sample).expect("room");
        }
        let (frames_tx, frames_rx) = std::sync::mpsc::channel();
        output.start_analyser(move |frame| frames_tx.send(frame.to_vec()).is_ok());
        deck.set_playing(true);
        std::thread::sleep(std::time::Duration::from_millis(1200));
        let loudest = frames_rx
            .try_iter()
            .map(|frame| {
                frame[..analyser::BIN_COUNT]
                    .iter()
                    .copied()
                    .max()
                    .unwrap_or(0)
            })
            .max()
            .unwrap_or(0);
        output.stop_analyser();
        assert!(loudest > 100, "analyser saw the tone: {loudest}");

        let consumed = deck
            .shared
            .position_frames
            .load(std::sync::atomic::Ordering::Relaxed);
        assert!(output.callback_count() > 0, "device callback ran");
        assert!(consumed > 20_000, "mixer consumed audio: {consumed}");
        for entry in crate::activity_log::get_recent(20, Some("audio.output")) {
            println!("{}", entry.message);
        }
    }
}
