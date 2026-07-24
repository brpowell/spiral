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

// CD rip encodes from PCM on both platforms (macOS: cddafs AIFF → PCM; Windows: CD-DA sectors).
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub use pipeline::encode_pcm_with_metadata;
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub use pcm_stream::PcmStream;
