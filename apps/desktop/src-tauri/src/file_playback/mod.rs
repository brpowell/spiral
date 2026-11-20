//! Library audio playback: decodes files and feeds the native audio output.

pub mod decoder;
mod engine;

pub(crate) use engine::not_responding;

pub use engine::{
    link_gapless, pause, position, ramp_gain, resume, seek, set_balance, set_gain, start, stop,
    stop_all, FilePlaybackPosition, FilePlaybackStarted,
};
