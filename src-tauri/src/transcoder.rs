//! Transcode audio files using built-in encoding profiles.

mod aac;
mod alac;
mod decode;
mod error;
mod flac;
mod lame;
mod pcm_stream;
mod pipeline;
mod wav;

pub use pipeline::transcode_file_with_metadata;
