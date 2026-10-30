//! Library audio playback: decodes files and feeds the native audio output.

pub mod decoder;
mod engine;

pub use engine::{
    link_gapless, pause, ramp_gain, resume, seek, set_balance, set_gain, start, stop, stop_all,
    FilePlaybackStarted,
};
