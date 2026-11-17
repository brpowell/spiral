//! Raw CD-DA sector reader for Windows / Linux optical drives.
//!
//! Reads 2352-byte audio sectors and yields interleaved little-endian 16-bit
//! samples as f32 for the shared engine, or as a full-track `PcmStream` for ripping.
//!
//! - Windows: `IOCTL_CDROM_RAW_READ`
//! - Linux: `CDROMREADAUDIO`
#![cfg(any(target_os = "windows", target_os = "linux"))]

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use super::damage::{read_sectors_resilient, RipBudget, SectorDamage};
use super::source::CdPcmSource;
use crate::cd::platform::{open_drive_handle, read_track_bounds, with_drive_lock, TrackBounds};
use crate::transcoder::PcmStream;

#[cfg(target_os = "windows")]
use std::mem::size_of;
#[cfg(target_os = "windows")]
use windows::Win32::Devices::Cdrom::{CDDA, IOCTL_CDROM_RAW_READ, RAW_READ_INFO};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(target_os = "windows")]
use windows::Win32::System::IO::DeviceIoControl;

#[cfg(target_os = "linux")]
use crate::cd::platform::read_cdda_sectors;
#[cfg(target_os = "linux")]
use std::fs::File;
#[cfg(target_os = "linux")]
use std::os::fd::AsRawFd;

/// Bytes per raw CD-DA sector (pure PCM for CDDA track mode).
const CDDA_SECTOR_BYTES: usize = 2352;
/// Stereo 16-bit frames per sector at 44.1 kHz / 75 sectors/s.
const FRAMES_PER_SECTOR: usize = 588;
const CHANNELS: u16 = 2;
const SAMPLE_RATE: u32 = 44_100;
const BYTES_PER_SAMPLE: usize = 2;
/// How many sectors to read per ioctl call.
const SECTORS_PER_READ: u32 = 16;

pub struct CddaTrackSource {
    #[cfg(target_os = "windows")]
    handle: HANDLE,
    #[cfg(target_os = "linux")]
    file: File,
    bounds: TrackBounds,
    /// Absolute LBA of the next sector to read.
    next_lba: u32,
    /// Byte offset within the current sector buffer.
    buf_pos: usize,
    /// Valid bytes in `buf`.
    buf_len: usize,
    buf: Vec<u8>,
    samples_read: u64,
    total_samples: u64,
    read_failed: Arc<AtomicBool>,
    /// Unreadable-sector tally; strict sources (ripping) error instead of silencing.
    damage: SectorDamage,
}

// Windows HANDLE is a raw pointer; ownership is exclusive to this source.
#[cfg(target_os = "windows")]
unsafe impl Send for CddaTrackSource {}

impl CddaTrackSource {
    /// `strict` is for ripping: an unreadable sector is an error. Playback passes `false` and
    /// plays silence over damaged sectors instead.
    pub fn open(drive_id: &str, track_number: u32, strict: bool) -> Result<Self, String> {
        let bounds = with_drive_lock(|| read_track_bounds(drive_id, track_number))??;
        #[cfg(target_os = "windows")]
        let handle = with_drive_lock(|| open_drive_handle(drive_id))??;
        #[cfg(target_os = "linux")]
        let file = with_drive_lock(|| open_drive_handle(drive_id))??;
        let sector_count = bounds.sector_count() as u64;
        let total_samples = sector_count * FRAMES_PER_SECTOR as u64 * CHANNELS as u64;

        Ok(Self {
            #[cfg(target_os = "windows")]
            handle,
            #[cfg(target_os = "linux")]
            file,
            bounds,
            next_lba: bounds.start_lba,
            buf_pos: 0,
            buf_len: 0,
            buf: vec![0u8; CDDA_SECTOR_BYTES * SECTORS_PER_READ as usize],
            samples_read: 0,
            total_samples,
            read_failed: Arc::new(AtomicBool::new(false)),
            damage: SectorDamage::new(strict),
        })
    }

    /// `refill`, reporting the read to the rip's stall budget when ripping.
    fn refill_budgeted(&mut self, budget: Option<&RipBudget>) -> Result<bool, String> {
        let Some(budget) = budget else {
            return self.refill();
        };
        budget.begin_read()?;
        let refilled = self.refill();
        budget.end_read()?;
        refilled
    }

    fn refill(&mut self) -> Result<bool, String> {
        if self.next_lba >= self.bounds.end_lba {
            self.buf_pos = 0;
            self.buf_len = 0;
            return Ok(false);
        }

        let remaining = self.bounds.end_lba - self.next_lba;
        let count = remaining.min(SECTORS_PER_READ);
        let byte_len = (count as usize) * CDDA_SECTOR_BYTES;

        #[cfg(target_os = "windows")]
        {
            let handle = self.handle;
            let raw_read = |lba: u32, sectors: u32, out: &mut [u8]| -> Result<usize, String> {
                // DiskOffset is in bytes using 2048-byte cooked sectors (Windows convention).
                let info = RAW_READ_INFO {
                    DiskOffset: (lba as i64) * 2048,
                    SectorCount: sectors,
                    TrackMode: CDDA,
                };
                let mut returned = 0u32;
                unsafe {
                    DeviceIoControl(
                        handle,
                        IOCTL_CDROM_RAW_READ,
                        Some((&info as *const RAW_READ_INFO).cast()),
                        size_of::<RAW_READ_INFO>() as u32,
                        Some(out.as_mut_ptr().cast()),
                        out.len() as u32,
                        Some(&mut returned),
                        None,
                    )
                    .map_err(|err| format!("CD-DA read failed at LBA {lba}: {err}"))?;
                }
                Ok((returned as usize).min(out.len()))
            };
            let filled = read_sectors_resilient(
                &mut self.damage,
                self.next_lba,
                count,
                &mut self.buf[..byte_len],
                CDDA_SECTOR_BYTES,
                raw_read,
            )?;
            self.next_lba += count;
            self.buf_pos = 0;
            self.buf_len = filled.min(byte_len);
        }

        #[cfg(target_os = "linux")]
        {
            let fd = self.file.as_raw_fd();
            let filled = read_sectors_resilient(
                &mut self.damage,
                self.next_lba,
                count,
                &mut self.buf[..byte_len],
                CDDA_SECTOR_BYTES,
                |lba, sectors, out| read_cdda_sectors(fd, lba, sectors, out),
            )?;
            self.next_lba += count;
            self.buf_pos = 0;
            self.buf_len = filled.min(byte_len);
        }

        if self.buf_len < BYTES_PER_SAMPLE {
            return Ok(false);
        }
        Ok(true)
    }

    fn next_i16(&mut self, budget: Option<&RipBudget>) -> Result<Option<i16>, String> {
        if self.samples_read >= self.total_samples {
            return Ok(None);
        }

        if self.buf_pos + BYTES_PER_SAMPLE > self.buf_len {
            match self.refill_budgeted(budget)? {
                true => {}
                false => {
                    self.samples_read = self.total_samples;
                    return Ok(None);
                }
            }
        }

        if self.buf_pos + BYTES_PER_SAMPLE > self.buf_len {
            self.samples_read = self.total_samples;
            return Ok(None);
        }

        let sample = i16::from_le_bytes([self.buf[self.buf_pos], self.buf[self.buf_pos + 1]]);
        self.buf_pos += BYTES_PER_SAMPLE;
        self.samples_read += 1;
        Ok(Some(sample))
    }
}

/// Read an entire CD-DA track as interleaved little-endian PCM for ripping.
pub fn read_track_pcm(
    drive_id: &str,
    track_number: u32,
    budget: &RipBudget,
) -> Result<PcmStream, String> {
    let mut source = CddaTrackSource::open(drive_id, track_number, true)?;
    let mut samples = Vec::with_capacity(source.total_samples as usize);
    while let Some(sample) = source.next_i16(Some(budget))? {
        samples.push(sample);
    }
    Ok(PcmStream {
        channels: CHANNELS,
        sample_rate: SAMPLE_RATE,
        samples,
    })
}

#[cfg(target_os = "windows")]
impl Drop for CddaTrackSource {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}

impl CdPcmSource for CddaTrackSource {
    fn channels(&self) -> u16 {
        CHANNELS
    }

    fn sample_rate(&self) -> u32 {
        SAMPLE_RATE
    }

    fn duration_seconds(&self) -> f64 {
        let frames = self.total_samples / CHANNELS as u64;
        frames as f64 / SAMPLE_RATE as f64
    }

    fn position_seconds(&self) -> f64 {
        let frames = self.samples_read / CHANNELS as u64;
        frames as f64 / SAMPLE_RATE as f64
    }

    fn read_failed_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.read_failed)
    }

    fn damaged_sectors_counter(&self) -> Option<Arc<AtomicU32>> {
        Some(self.damage.counter())
    }

    fn seek_seconds(&mut self, seconds: f64) -> Result<(), String> {
        let total_frames = self.total_samples / CHANNELS as u64;
        let frame = ((seconds.max(0.0) * SAMPLE_RATE as f64).round() as u64).min(total_frames);
        let sample_index = frame * CHANNELS as u64;

        let sector_offset = (frame / FRAMES_PER_SECTOR as u64) as u32;
        let frame_in_sector = (frame % FRAMES_PER_SECTOR as u64) as usize;

        self.next_lba = self.bounds.start_lba.saturating_add(sector_offset);
        if self.next_lba > self.bounds.end_lba {
            self.next_lba = self.bounds.end_lba;
        }
        self.samples_read = sample_index;
        self.buf_pos = 0;
        self.buf_len = 0;

        // Pre-position within the sector by reading it and skipping frames.
        if self.next_lba < self.bounds.end_lba && frame_in_sector > 0 && self.refill()? {
            let skip_bytes = frame_in_sector * CHANNELS as usize * BYTES_PER_SAMPLE;
            self.buf_pos = skip_bytes.min(self.buf_len);
        }
        Ok(())
    }

    fn next_sample(&mut self) -> Option<f32> {
        match self.next_i16(None) {
            Ok(Some(sample)) => Some(sample as f32 / 32768.0),
            Ok(None) => None,
            Err(err) => {
                eprintln!("cd playback: audio read failed: {err}");
                self.read_failed.store(true, Ordering::SeqCst);
                self.samples_read = self.total_samples;
                None
            }
        }
    }
}
