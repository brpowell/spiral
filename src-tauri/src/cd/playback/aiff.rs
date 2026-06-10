//! Minimal AIFF / AIFF-C PCM reader for cddafs-mounted CD audio tracks.
//!
//! Only 16-bit PCM is supported — that is all CD-DA produces. Incremental
//! reads so a full track is never buffered in memory.
#![cfg(target_os = "macos")]

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const READ_BUFFER_BYTES: usize = 64 * 1024;
const BYTES_PER_SAMPLE: u64 = 2;

struct AiffInfo {
    channels: u16,
    sample_rate: u32,
    bits_per_sample: u16,
    little_endian: bool,
    /// Absolute file offset of the first PCM byte.
    data_start: u64,
    /// PCM payload length in bytes (from the SSND chunk).
    data_len: u64,
}

fn parse_extended80(bytes: &[u8]) -> f64 {
    let sign = if bytes[0] & 0x80 != 0 { -1.0 } else { 1.0 };
    let exponent = ((((bytes[0] & 0x7f) as i32) << 8) | bytes[1] as i32) - 16383;
    let mantissa = u64::from_be_bytes(bytes[2..10].try_into().expect("8 mantissa bytes"));
    sign * mantissa as f64 * 2f64.powi(exponent - 63)
}

fn parse_header(reader: &mut (impl Read + Seek)) -> Result<AiffInfo, String> {
    let mut form = [0u8; 12];
    reader
        .read_exact(&mut form)
        .map_err(|err| format!("Failed to read AIFF header: {err}"))?;
    if &form[0..4] != b"FORM" {
        return Err("Not an AIFF file (missing FORM chunk)".into());
    }
    let is_aifc = match &form[8..12] {
        b"AIFF" => false,
        b"AIFC" => true,
        other => {
            return Err(format!(
                "Not an AIFF file (form type {:?})",
                String::from_utf8_lossy(other)
            ))
        }
    };

    let mut comm: Option<(u16, u32, u16, f64, bool)> = None;
    let mut ssnd: Option<(u64, u64)> = None;

    loop {
        let mut chunk_header = [0u8; 8];
        if reader.read_exact(&mut chunk_header).is_err() {
            break;
        }
        let chunk_id = &chunk_header[0..4];
        let chunk_size =
            u32::from_be_bytes(chunk_header[4..8].try_into().expect("4 size bytes")) as u64;
        let chunk_data_start = reader
            .stream_position()
            .map_err(|err| format!("AIFF read failed: {err}"))?;

        match chunk_id {
            b"COMM" => {
                if chunk_size < 18 {
                    return Err("AIFF COMM chunk too small".into());
                }
                let mut buf = vec![0u8; chunk_size as usize];
                reader
                    .read_exact(&mut buf)
                    .map_err(|err| format!("Failed to read AIFF COMM chunk: {err}"))?;
                let channels = u16::from_be_bytes(buf[0..2].try_into().expect("2 bytes"));
                let num_frames = u32::from_be_bytes(buf[2..6].try_into().expect("4 bytes"));
                let bits = u16::from_be_bytes(buf[6..8].try_into().expect("2 bytes"));
                let sample_rate = parse_extended80(&buf[8..18]);
                let little_endian = if is_aifc && chunk_size >= 22 {
                    match &buf[18..22] {
                        b"NONE" | b"twos" => false,
                        b"sowt" => true,
                        other => {
                            return Err(format!(
                                "Unsupported AIFF-C compression: {:?}",
                                String::from_utf8_lossy(other)
                            ))
                        }
                    }
                } else {
                    false
                };
                comm = Some((channels, num_frames, bits, sample_rate, little_endian));
            }
            b"SSND" => {
                if chunk_size < 8 {
                    return Err("AIFF SSND chunk too small".into());
                }
                let mut prefix = [0u8; 8];
                reader
                    .read_exact(&mut prefix)
                    .map_err(|err| format!("Failed to read AIFF SSND chunk: {err}"))?;
                let offset = u32::from_be_bytes(prefix[0..4].try_into().expect("4 bytes")) as u64;
                let data_start = chunk_data_start + 8 + offset;
                let data_len = chunk_size.saturating_sub(8 + offset);
                ssnd = Some((data_start, data_len));
            }
            _ => {}
        }

        if comm.is_some() && ssnd.is_some() {
            break;
        }

        // Chunks are padded to even byte boundaries.
        let next_chunk = chunk_data_start + chunk_size + (chunk_size & 1);
        reader
            .seek(SeekFrom::Start(next_chunk))
            .map_err(|err| format!("AIFF read failed: {err}"))?;
    }

    let (channels, comm_frames, bits_per_sample, sample_rate, little_endian) =
        comm.ok_or_else(|| "AIFF file has no COMM chunk".to_string())?;
    let (data_start, ssnd_len) = ssnd.ok_or_else(|| "AIFF file has no SSND chunk".to_string())?;

    if bits_per_sample != 16 {
        return Err(format!("Unsupported AIFF sample size: {bits_per_sample}-bit"));
    }
    if channels == 0 || !(8000.0..=192_000.0).contains(&sample_rate) {
        return Err("Invalid AIFF format description".into());
    }

    // Trust the smaller of the declared frame counts so reads never run past EOF.
    let frame_bytes = channels as u64 * BYTES_PER_SAMPLE;
    let data_len = ssnd_len.min(comm_frames as u64 * frame_bytes);

    Ok(AiffInfo {
        channels,
        sample_rate: sample_rate.round() as u32,
        bits_per_sample,
        little_endian,
        data_start,
        data_len,
    })
}

pub struct AiffSource {
    reader: BufReader<File>,
    channels: u16,
    sample_rate: u32,
    little_endian: bool,
    data_start: u64,
    total_samples: u64,
    samples_read: u64,
    read_failed: Arc<AtomicBool>,
}

impl AiffSource {
    pub fn open(path: &Path) -> Result<AiffSource, String> {
        let file = File::open(path)
            .map_err(|err| format!("Failed to open CD track {}: {err}", path.display()))?;
        let mut reader = BufReader::with_capacity(READ_BUFFER_BYTES, file);
        let info = parse_header(&mut reader)?;
        debug_assert_eq!(info.bits_per_sample, 16);

        reader
            .seek(SeekFrom::Start(info.data_start))
            .map_err(|err| format!("Failed to seek CD track audio data: {err}"))?;

        Ok(AiffSource {
            reader,
            channels: info.channels,
            sample_rate: info.sample_rate,
            little_endian: info.little_endian,
            data_start: info.data_start,
            total_samples: info.data_len / BYTES_PER_SAMPLE,
            samples_read: 0,
            read_failed: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn duration_seconds(&self) -> f64 {
        let frames = self.total_samples / self.channels as u64;
        frames as f64 / self.sample_rate as f64
    }

    pub fn position_seconds(&self) -> f64 {
        let frames = self.samples_read / self.channels as u64;
        frames as f64 / self.sample_rate as f64
    }

    /// Set when a mid-track read fails (eject, scratched disc, I/O error).
    pub fn read_failed_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.read_failed)
    }

    pub fn seek_seconds(&mut self, seconds: f64) -> Result<(), String> {
        let channels = self.channels as u64;
        let total_frames = self.total_samples / channels;
        let frame = ((seconds.max(0.0) * self.sample_rate as f64).round() as u64).min(total_frames);
        let sample_index = frame * channels;
        self.reader
            .seek(SeekFrom::Start(
                self.data_start + sample_index * BYTES_PER_SAMPLE,
            ))
            .map_err(|err| format!("CD seek failed: {err}"))?;
        self.samples_read = sample_index;
        Ok(())
    }
}

impl Iterator for AiffSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.samples_read >= self.total_samples {
            return None;
        }
        let mut buf = [0u8; 2];
        if let Err(err) = self.reader.read_exact(&mut buf) {
            eprintln!("cd playback: audio read failed: {err}");
            self.read_failed.store(true, Ordering::SeqCst);
            self.samples_read = self.total_samples;
            return None;
        }
        self.samples_read += 1;
        let sample = if self.little_endian {
            i16::from_le_bytes(buf)
        } else {
            i16::from_be_bytes(buf)
        };
        Some(sample as f32 / 32768.0)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let remaining = (self.total_samples - self.samples_read) as usize;
        (remaining, Some(remaining))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn extended80_from(value: f64) -> [u8; 10] {
        // Build the 80-bit float for a positive integer value (e.g. 44100).
        let int = value as u64;
        let bits = 63 - int.leading_zeros() as i32;
        let exponent = (16383 + bits) as u16;
        let mantissa = int << (63 - bits);
        let mut out = [0u8; 10];
        out[0..2].copy_from_slice(&exponent.to_be_bytes());
        out[2..10].copy_from_slice(&mantissa.to_be_bytes());
        out
    }

    fn build_aiff(frames: u32, little_endian: bool) -> Vec<u8> {
        let channels: u16 = 2;
        let data_len = frames as usize * channels as usize * 2;
        let mut out = Vec::new();
        out.extend_from_slice(b"FORM");
        out.extend_from_slice(&0u32.to_be_bytes()); // size: not validated by parser
        out.extend_from_slice(if little_endian { b"AIFC" } else { b"AIFF" });

        let comm_size: u32 = if little_endian { 24 } else { 18 };
        out.extend_from_slice(b"COMM");
        out.extend_from_slice(&comm_size.to_be_bytes());
        out.extend_from_slice(&channels.to_be_bytes());
        out.extend_from_slice(&frames.to_be_bytes());
        out.extend_from_slice(&16u16.to_be_bytes());
        out.extend_from_slice(&extended80_from(44100.0));
        if little_endian {
            out.extend_from_slice(b"sowt");
            out.extend_from_slice(&[0, 0]); // empty pascal string + pad
        }

        out.extend_from_slice(b"SSND");
        out.extend_from_slice(&((data_len + 8) as u32).to_be_bytes());
        out.extend_from_slice(&0u32.to_be_bytes()); // offset
        out.extend_from_slice(&0u32.to_be_bytes()); // block size
        for i in 0..(frames * channels as u32) {
            let sample = (i % 100) as i16;
            if little_endian {
                out.extend_from_slice(&sample.to_le_bytes());
            } else {
                out.extend_from_slice(&sample.to_be_bytes());
            }
        }
        out
    }

    #[test]
    fn parses_big_endian_aiff() {
        let data = build_aiff(441, false);
        let info = parse_header(&mut Cursor::new(&data)).expect("parse");
        assert_eq!(info.channels, 2);
        assert_eq!(info.sample_rate, 44100);
        assert!(!info.little_endian);
        assert_eq!(info.data_len, 441 * 2 * 2);
    }

    #[test]
    fn parses_little_endian_aifc() {
        let data = build_aiff(441, true);
        let info = parse_header(&mut Cursor::new(&data)).expect("parse");
        assert_eq!(info.channels, 2);
        assert_eq!(info.sample_rate, 44100);
        assert!(info.little_endian);
    }

    #[test]
    fn extended80_roundtrip() {
        assert_eq!(parse_extended80(&extended80_from(44100.0)), 44100.0);
        assert_eq!(parse_extended80(&extended80_from(48000.0)), 48000.0);
    }
}
