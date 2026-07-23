//! Native PCM streaming playback for OGG Vorbis, Opus, and ALAC library files.

pub mod decoder;
mod engine;

pub use engine::{
    ack_pcm_chunks, pause, resume, seek, start, stop, FilePlaybackStarted,
};
