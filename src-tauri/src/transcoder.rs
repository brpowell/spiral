//! Transcode audio files using built-in encoding profiles.

mod alac;
mod decode;
mod error;
mod pcm_stream;
mod wav;

#[cfg(target_os = "macos")]
mod afconvert;
#[cfg(target_os = "macos")]
mod lame;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(not(target_os = "macos"))]
mod stub;

#[cfg(target_os = "macos")]
pub use macos::transcode_file_with_metadata;

#[cfg(not(target_os = "macos"))]
pub use stub::transcode_file_with_metadata;
