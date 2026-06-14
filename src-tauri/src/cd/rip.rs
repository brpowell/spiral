//! Rip CD tracks to FLAC/MP3.

#[cfg(target_os = "macos")]
mod macos;

#[cfg(not(target_os = "macos"))]
mod stub;

#[cfg(target_os = "macos")]
pub use macos::{cleanup_rip_temp, rip_cd_track, RipFormat};

#[cfg(not(target_os = "macos"))]
pub use stub::{cleanup_rip_temp, rip_cd_track, RipFormat};
