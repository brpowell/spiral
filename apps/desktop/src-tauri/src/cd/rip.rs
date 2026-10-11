//! Rip CD tracks using built-in encoding profiles.
//!
//! Platform difference is only PCM acquisition (`read_track_pcm`); encode is shared.

mod common;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod stub;

pub use common::cleanup_rip_temp;

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub use common::rip_cd_track;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub use stub::rip_cd_track;
