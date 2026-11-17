//! Platform-agnostic PCM source for CD playback engines.

use std::sync::atomic::{AtomicBool, AtomicU32};
use std::sync::Arc;

/// Incremental PCM reader used by the shared CD playback engine.
pub trait CdPcmSource: Send {
    fn channels(&self) -> u16;
    fn sample_rate(&self) -> u32;
    fn duration_seconds(&self) -> f64;
    fn position_seconds(&self) -> f64;
    /// Set when a mid-track read fails (eject, scratched disc, I/O error).
    fn read_failed_flag(&self) -> Arc<AtomicBool>;
    /// Count of unreadable sectors replaced with silence so far, for sources that tolerate
    /// damaged media. `None` for sources that never skip.
    fn damaged_sectors_counter(&self) -> Option<Arc<AtomicU32>> {
        None
    }
    fn seek_seconds(&mut self, seconds: f64) -> Result<(), String>;
    fn next_sample(&mut self) -> Option<f32>;
}
