pub mod events;
pub mod monitor;
pub mod platform;
pub mod playback;
pub mod types;

pub mod disc_id;
mod rip;

#[cfg(target_os = "macos")]
pub mod aiff_path;

pub use rip::{cleanup_rip_temp, rip_cd_track};
