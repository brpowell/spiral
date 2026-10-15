//! Native PCM streaming playback for library audio files (all supported formats).

pub mod decoder;
mod engine;

pub use engine::{
    ack_pcm_chunks, link_gapless, pause, resume, seek, set_balance, set_gain, start, stop,
    FilePlaybackStarted, PcmChannel,
};
