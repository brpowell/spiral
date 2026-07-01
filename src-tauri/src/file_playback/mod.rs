//! Native PCM streaming playback for OGG Vorbis and Opus library files.

pub mod decoder;
mod engine;

pub use engine::{
    ack_pcm_chunks, pause, resume, seek, start, stop, FilePlaybackStarted,
};
