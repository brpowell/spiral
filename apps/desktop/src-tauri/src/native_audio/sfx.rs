//! One-shot UI sounds (skin clicks, transport cues).
//!
//! Clips are short WAV files decoded once and kept in memory. Each play adds a
//! voice to the mixer that renders after the EQ, so clicks never ride the
//! equalizer or the visualizer tap, and they play even when no music does.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

/// Voices that may sound at once; a burst of clicks past this drops the oldest.
pub const MAX_VOICES: usize = 8;

/// Level applied to every UI sound (about -9 dB). Clips are authored hot and
/// ignore the volume slider, so they need their own headroom under the music.
pub const SFX_LEVEL: f32 = 0.35;

/// A decoded clip: interleaved f32 at its own rate and channel count.
#[derive(Debug, PartialEq)]
pub struct SfxClip {
    pub channels: usize,
    pub sample_rate: u32,
    pub samples: Vec<f32>,
}

impl SfxClip {
    pub fn frames(&self) -> usize {
        self.samples.len() / self.channels.max(1)
    }
}

fn read_u16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn read_u32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

/// Parse a RIFF/WAVE file: 8/16/24/32-bit integer PCM or 32-bit float.
pub fn parse_wav(bytes: &[u8]) -> Result<SfxClip, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a RIFF/WAVE file".into());
    }

    let mut format: Option<(u16, usize, u32, u16)> = None; // tag, channels, rate, bits
    let mut data: Option<&[u8]> = None;
    let mut offset = 12;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = read_u32(bytes, offset + 4).ok_or("truncated chunk header")? as usize;
        let body_start = offset + 8;
        // A data chunk may claim more than the file holds; play what is there.
        let body_end = (body_start + size).min(bytes.len());
        let body = &bytes[body_start..body_end];
        match id {
            b"fmt " => {
                let tag = read_u16(body, 0).ok_or("short fmt chunk")?;
                let channels = read_u16(body, 2).ok_or("short fmt chunk")? as usize;
                let rate = read_u32(body, 4).ok_or("short fmt chunk")?;
                let bits = read_u16(body, 14).ok_or("short fmt chunk")?;
                // WAVE_FORMAT_EXTENSIBLE carries the real tag in the sub-format.
                let tag = if tag == 0xFFFE {
                    read_u16(body, 24).ok_or("short extensible fmt chunk")?
                } else {
                    tag
                };
                format = Some((tag, channels, rate, bits));
            }
            b"data" => data = Some(body),
            _ => {}
        }
        // Chunks are word-aligned.
        offset = body_start + size + (size & 1);
    }

    let (tag, channels, sample_rate, bits) = format.ok_or("missing fmt chunk")?;
    let data = data.ok_or("missing data chunk")?;
    if channels == 0 || sample_rate == 0 {
        return Err("invalid WAVE format".into());
    }

    let samples: Vec<f32> = match (tag, bits) {
        (1, 8) => data.iter().map(|b| (*b as f32 - 128.0) / 128.0).collect(),
        (1, 16) => data
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
            .collect(),
        (1, 24) => data
            .chunks_exact(3)
            .map(|c| {
                let value = i32::from_le_bytes([0, c[0], c[1], c[2]]) >> 8;
                value as f32 / 8_388_608.0
            })
            .collect(),
        (1, 32) => data
            .chunks_exact(4)
            .map(|c| i32::from_le_bytes([c[0], c[1], c[2], c[3]]) as f32 / 2_147_483_648.0)
            .collect(),
        (3, 32) => data
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect(),
        _ => return Err(format!("unsupported WAVE format (tag {tag}, {bits}-bit)")),
    };
    let usable = samples.len() - samples.len() % channels;
    let mut samples = samples;
    samples.truncate(usable);
    if samples.is_empty() {
        return Err("WAVE file has no audio".into());
    }
    Ok(SfxClip {
        channels,
        sample_rate,
        samples,
    })
}

/// Decoded clips by key (the clip's URL). Windows share this table, so the key
/// must identify the sound itself; a per-window counter would let one window's
/// clip replace another's.
static CLIPS: LazyLock<Mutex<HashMap<String, (u64, Arc<SfxClip>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub fn store_clip(key: &str, bytes: &[u8]) -> Result<(), String> {
    let clip = Arc::new(parse_wav(bytes)?);
    let mut clips = CLIPS.lock().unwrap_or_else(|p| p.into_inner());
    // Reloading keeps the voice id, so a replay still cuts the earlier play.
    let id = clips
        .get(key)
        .map(|(id, _)| *id)
        .unwrap_or_else(|| NEXT_ID.fetch_add(1, Ordering::Relaxed));
    clips.insert(key.to_string(), (id, clip));
    Ok(())
}

/// The clip's voice id and data, if it was stored.
pub fn clip(key: &str) -> Option<(u64, Arc<SfxClip>)> {
    CLIPS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get(key)
        .cloned()
}

/// One sounding instance of a clip.
pub struct SfxVoice {
    /// Plays of the same id cut each other off.
    pub id: u64,
    clip: Arc<SfxClip>,
    /// Fractional source frame.
    pos: f64,
}

impl SfxVoice {
    pub fn new(id: u64, clip: Arc<SfxClip>) -> Self {
        Self { id, clip, pos: 0.0 }
    }

    pub fn finished(&self) -> bool {
        self.pos >= self.clip.frames() as f64
    }

    /// Add the next `frames` frames into `out` (interleaved, `out_channels` wide).
    pub fn mix_into(&mut self, out: &mut [f32], out_channels: usize, out_rate: f32) {
        let clip = &*self.clip;
        let channels = clip.channels;
        let frames = clip.frames();
        let step = clip.sample_rate as f64 / out_rate as f64;
        for frame in out.chunks_exact_mut(out_channels) {
            if self.pos >= frames as f64 {
                return;
            }
            let i0 = self.pos as usize;
            let i1 = (i0 + 1).min(frames - 1);
            let t = (self.pos - i0 as f64) as f32;
            for (ch, slot) in frame.iter_mut().enumerate() {
                // Mono clips play on every output channel; extra source
                // channels beyond the device's are dropped.
                let src_ch = if channels == 1 {
                    0
                } else {
                    ch.min(channels - 1)
                };
                let a = clip.samples[i0 * channels + src_ch];
                let b = clip.samples[i1 * channels + src_ch];
                *slot += (a + (b - a) * t) * SFX_LEVEL;
            }
            self.pos += step;
        }
    }
}

#[cfg(test)]
pub(crate) fn wav_bytes(
    channels: u16,
    rate: u32,
    bits: u16,
    float: bool,
    frames: &[Vec<f32>],
) -> Vec<u8> {
    let mut data = Vec::new();
    for frame in frames {
        for sample in frame {
            match (float, bits) {
                (true, 32) => data.extend_from_slice(&sample.to_le_bytes()),
                (false, 8) => data.push((sample * 128.0 + 128.0) as u8),
                (false, 16) => data.extend_from_slice(&((sample * 32767.0) as i16).to_le_bytes()),
                (false, 24) => {
                    let v = (sample * 8_388_607.0) as i32;
                    data.extend_from_slice(&v.to_le_bytes()[..3]);
                }
                (false, 32) => {
                    data.extend_from_slice(&((sample * 2_147_483_647.0) as i32).to_le_bytes())
                }
                _ => panic!("unsupported test format"),
            }
        }
    }
    let mut out = Vec::new();
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&(if float { 3u16 } else { 1u16 }).to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * channels as u32 * bits as u32 / 8).to_le_bytes());
    out.extend_from_slice(&(channels * bits / 8).to_le_bytes());
    out.extend_from_slice(&bits.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&data);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp_frames(channels: usize, count: usize) -> Vec<Vec<f32>> {
        (0..count)
            .map(|n| vec![n as f32 / count as f32 - 0.5; channels])
            .collect()
    }

    #[test]
    fn parses_16_bit_stereo() {
        let frames = ramp_frames(2, 100);
        let clip = parse_wav(&wav_bytes(2, 44_100, 16, false, &frames)).expect("parse");
        assert_eq!(
            (clip.channels, clip.sample_rate, clip.frames()),
            (2, 44_100, 100)
        );
        assert!((clip.samples[0] + 0.5).abs() < 1e-3);
        assert!((clip.samples[100] - 0.0).abs() < 1e-2);
    }

    #[test]
    fn parses_each_supported_depth() {
        for (bits, float) in [
            (8u16, false),
            (16, false),
            (24, false),
            (32, false),
            (32, true),
        ] {
            let frames = vec![vec![0.5], vec![-0.5]];
            let clip = parse_wav(&wav_bytes(1, 8000, bits, float, &frames))
                .unwrap_or_else(|e| panic!("{bits}-bit float={float}: {e}"));
            assert!((clip.samples[0] - 0.5).abs() < 0.02, "{bits} bit positive");
            assert!((clip.samples[1] + 0.5).abs() < 0.02, "{bits} bit negative");
        }
    }

    #[test]
    fn skips_unknown_chunks_and_odd_padding() {
        let mut bytes = wav_bytes(1, 8000, 16, false, &[vec![0.25], vec![0.25]]);
        // Insert an odd-sized LIST chunk (padded to even) between fmt and data.
        let list: Vec<u8> = [b"LIST".as_slice(), &3u32.to_le_bytes(), b"abc", &[0u8]].concat();
        bytes.splice(36..36, list);
        let clip = parse_wav(&bytes).expect("parse");
        assert_eq!(clip.frames(), 2);
    }

    #[test]
    fn tolerates_a_data_chunk_longer_than_the_file() {
        let mut bytes = wav_bytes(1, 8000, 16, false, &ramp_frames(1, 50));
        bytes.truncate(bytes.len() - 20); // drops 10 frames, header still claims 50
        let clip = parse_wav(&bytes).expect("parse");
        assert_eq!(clip.frames(), 40);
    }

    #[test]
    fn rejects_non_wave_and_empty_input() {
        assert!(parse_wav(b"").is_err());
        assert!(parse_wav(b"RIFFxxxxAVI LIST").is_err());
        assert!(parse_wav(&wav_bytes(1, 8000, 16, false, &[])).is_err());
    }

    #[test]
    fn voice_plays_to_the_end_then_finishes() {
        let clip =
            Arc::new(parse_wav(&wav_bytes(1, 48_000, 16, false, &vec![vec![0.5]; 100])).unwrap());
        let mut voice = SfxVoice::new(1, clip);
        let mut out = vec![0.0; 64 * 2];
        voice.mix_into(&mut out, 2, 48_000.0);
        assert!(!voice.finished());
        assert!(
            (out[0] - 0.5 * SFX_LEVEL).abs() < 1e-3 && (out[1] - 0.5 * SFX_LEVEL).abs() < 1e-3,
            "mono → both"
        );
        out.fill(0.0);
        voice.mix_into(&mut out, 2, 48_000.0);
        assert!(voice.finished());
        assert!(
            out[(100 - 64 - 1) * 2] > 0.4 * SFX_LEVEL,
            "last frames of the clip"
        );
        assert_eq!(out[(100 - 64) * 2], 0.0, "silence after the clip ends");
    }

    #[test]
    fn voice_resamples_to_the_device_rate() {
        let clip =
            Arc::new(parse_wav(&wav_bytes(1, 24_000, 16, false, &vec![vec![0.5]; 100])).unwrap());
        let mut voice = SfxVoice::new(1, clip);
        let mut out = vec![0.0; 300 * 2];
        voice.mix_into(&mut out, 2, 48_000.0);
        let audible = out.chunks(2).filter(|f| f[0] > 0.1 * SFX_LEVEL).count();
        assert!(
            (196..=201).contains(&audible),
            "half-rate clip lasts twice as long: {audible}"
        );
    }

    #[test]
    fn voice_adds_to_existing_audio() {
        let clip =
            Arc::new(parse_wav(&wav_bytes(1, 48_000, 16, false, &vec![vec![0.25]; 10])).unwrap());
        let mut voice = SfxVoice::new(1, clip);
        let mut out = vec![0.5; 10 * 2];
        voice.mix_into(&mut out, 2, 48_000.0);
        assert!((out[0] - (0.5 + 0.25 * SFX_LEVEL)).abs() < 1e-3);
    }

    #[test]
    fn stored_clips_are_retrievable_by_key() {
        let wav = wav_bytes(1, 8000, 16, false, &[vec![0.1], vec![0.2]]);
        store_clip("test://a.wav", &wav).expect("store");
        assert_eq!(clip("test://a.wav").expect("stored").1.frames(), 2);
        assert!(clip("test://never.wav").is_none());
        assert!(store_clip("test://junk.wav", b"junk").is_err());
        assert!(clip("test://junk.wav").is_none());
    }

    #[test]
    fn different_keys_never_share_a_clip_or_a_voice_id() {
        // Two windows both load "their first sound": the clips must stay apart.
        store_clip(
            "test://core-play.wav",
            &wav_bytes(1, 8000, 16, false, &vec![vec![0.1]; 10]),
        )
        .expect("store");
        store_clip(
            "test://t3-click.wav",
            &wav_bytes(1, 8000, 16, false, &vec![vec![0.9]; 20]),
        )
        .expect("store");

        let (core_id, core) = clip("test://core-play.wav").expect("core");
        let (t3_id, t3) = clip("test://t3-click.wav").expect("t3");
        assert_ne!(core_id, t3_id);
        assert_eq!(core.frames(), 10);
        assert_eq!(t3.frames(), 20);
    }

    #[test]
    fn reloading_a_key_keeps_its_voice_id_and_replaces_the_data() {
        let key = "test://reload.wav";
        store_clip(key, &wav_bytes(1, 8000, 16, false, &vec![vec![0.1]; 5])).expect("first");
        let (id, _) = clip(key).expect("stored");
        store_clip(key, &wav_bytes(1, 8000, 16, false, &vec![vec![0.1]; 9])).expect("second");
        let (same_id, data) = clip(key).expect("stored");
        assert_eq!(id, same_id);
        assert_eq!(data.frames(), 9);
    }
}
