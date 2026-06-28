//! Rip CD tracks using built-in encoding profiles.

#[cfg(target_os = "macos")]
mod macos;

#[cfg(not(target_os = "macos"))]
mod stub;

#[cfg(target_os = "macos")]
pub use macos::{cleanup_rip_temp, rip_cd_track};

#[cfg(not(target_os = "macos"))]
pub use stub::{cleanup_rip_temp, rip_cd_track};
