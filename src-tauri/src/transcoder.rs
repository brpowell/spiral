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

// CD rip encodes from PCM (macOS: cddafs AIFF → PCM; Windows/Linux: CD-DA sectors).
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub use pcm_stream::PcmStream;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub use pipeline::encode_pcm_with_metadata;

/// Shared by file PCM playback when Symphonia rejects ID3-tagged WAVE files.
pub(crate) use wav::read_pcm_from_wav;
