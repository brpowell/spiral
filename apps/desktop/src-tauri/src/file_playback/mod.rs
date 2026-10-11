//! Native PCM streaming playback for library audio files (all supported formats).

pub mod decoder;
mod engine;

pub use engine::{
    ack_pcm_chunks, pause, resume, seek, start, stop, FilePlaybackStarted, PcmChannel,
};
