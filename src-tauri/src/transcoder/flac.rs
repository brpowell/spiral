//! Encode interleaved PCM to FLAC via bundled `flacenc`.

use std::fs;
use std::path::Path;

use flacenc::component::BitRepr;
use flacenc::error::Verify;
use flacenc::source::MemSource;

use super::error;
use super::pcm_stream::PcmStream;

const BITS_PER_SAMPLE: usize = 16;
/// flacenc rejects block sizes above this (stricter than the FLAC max of 65535).
const MAX_FLACENC_BLOCK_SIZE: usize = 32_767;
const MIN_FLAC_BLOCK_SIZE: usize = 16;
/// Prefer these when they divide the frame count so every frame is full-sized.
/// Symphonia's FLAC demuxer fails to probe some flacenc bitstreams that end with a
/// short final frame (claxon/ffmpeg accept them); equal frame sizes avoid that.
const PREFERRED_BLOCK_SIZES: &[usize] = &[4096, 2048, 1152, 1024, 512, 256, 192];

pub fn encode_pcm_to_flac(pcm: &PcmStream, dest: &Path) -> Result<(), String> {
    if pcm.channels == 0 {
        return Err("Cannot encode FLAC with zero channels".into());
    }
    if pcm.channels > 8 {
        return Err(format!(
            "FLAC encoding supports up to 8 channels (got {} channels)",
            pcm.channels
        ));
    }
    if pcm.sample_rate == 0 {
        return Err("FLAC encoding requires a valid sample rate".into());
    }
    if pcm.samples.is_empty() {
        return Err("FLAC encoding requires audio samples".into());
    }

    let channels = pcm.channels as usize;
    if pcm.samples.len() % channels != 0 {
        return Err(format!(
            "PCM sample count {} is not divisible by channel count {channels}",
            pcm.samples.len()
        ));
    }

    let frame_count = pcm.samples.len() / channels;
    let (samples, block_size) = prepare_samples_and_block_size(&pcm.samples, channels, frame_count);

    let mut encoder_config = flacenc::config::Encoder::default();
    encoder_config.block_size = block_size;
    let config = encoder_config
        .into_verified()
        .map_err(|(_, err)| format!("Invalid FLAC encoder config: {err}"))?;

    let source = MemSource::from_samples(
        &samples,
        channels,
        BITS_PER_SAMPLE,
        pcm.sample_rate as usize,
    );
    let stream = flacenc::encode_with_fixed_block_size(&config, source, config.block_size)
        .map_err(|err| format!("FLAC encoding failed: {err}"))?;

    let mut sink = flacenc::bitsink::ByteSink::with_capacity(stream.count_bits());
    stream
        .write(&mut sink)
        .map_err(|err| format!("Failed to serialize FLAC stream: {err}"))?;

    fs::write(dest, sink.as_slice())
        .map_err(|err| format!("Failed to write {}: {err}", dest.display()))?;

    if !dest.is_file() {
        return Err(error::format_missing_output(dest));
    }

    Ok(())
}

fn prepare_samples_and_block_size(
    pcm_samples: &[i16],
    channels: usize,
    frame_count: usize,
) -> (Vec<i32>, usize) {
    let mut samples: Vec<i32> = pcm_samples.iter().map(|&s| i32::from(s)).collect();

    if frame_count < MIN_FLAC_BLOCK_SIZE {
        // FLAC requires at least 16 samples per frame; pad with silence.
        let pad_frames = MIN_FLAC_BLOCK_SIZE - frame_count;
        samples.extend(std::iter::repeat(0i32).take(pad_frames * channels));
        return (samples, MIN_FLAC_BLOCK_SIZE);
    }

    match choose_block_size(frame_count) {
        BlockSizeChoice::Exact(block_size) => (samples, block_size),
        BlockSizeChoice::PadToMultiple(block_size) => {
            // Extremely rare (e.g. twice a prime > 32767). Padding keeps every
            // frame full-sized so Symphonia can probe the bitstream.
            let padded_frames = frame_count.div_ceil(block_size) * block_size;
            let pad_frames = padded_frames - frame_count;
            samples.extend(std::iter::repeat(0i32).take(pad_frames * channels));
            (samples, block_size)
        }
    }
}

enum BlockSizeChoice {
    Exact(usize),
    /// Pathological frame counts with no divisor in the valid range — pad to a multiple.
    PadToMultiple(usize),
}

fn choose_block_size(frame_count: usize) -> BlockSizeChoice {
    for &bs in PREFERRED_BLOCK_SIZES {
        if frame_count >= bs && frame_count % bs == 0 {
            return BlockSizeChoice::Exact(bs);
        }
    }

    if (MIN_FLAC_BLOCK_SIZE..=MAX_FLACENC_BLOCK_SIZE).contains(&frame_count) {
        return BlockSizeChoice::Exact(frame_count);
    }

    let upper = MAX_FLACENC_BLOCK_SIZE.min(frame_count);
    for bs in (MIN_FLAC_BLOCK_SIZE..=upper).rev() {
        if frame_count % bs == 0 {
            return BlockSizeChoice::Exact(bs);
        }
    }

    BlockSizeChoice::PadToMultiple(PREFERRED_BLOCK_SIZES[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn silence_pcm(channels: u16, frames: usize) -> PcmStream {
        PcmStream {
            channels,
            sample_rate: 44_100,
            samples: vec![0; frames * channels as usize],
        }
    }

    fn assert_flac_magic(path: &Path) {
        let bytes = fs::read(path).expect("read flac");
        assert!(bytes.len() > 4, "flac too small: {} bytes", bytes.len());
        assert_eq!(&bytes[..4], b"fLaC");
    }

    #[test]
    fn choose_block_size_prefers_dividing_candidates() {
        assert!(matches!(
            choose_block_size(8192),
            BlockSizeChoice::Exact(4096)
        ));
        assert!(matches!(
            choose_block_size(2048),
            BlockSizeChoice::Exact(2048)
        ));
        assert!(matches!(
            choose_block_size(4410),
            BlockSizeChoice::Exact(4410)
        ));
        assert!(matches!(
            choose_block_size(44_100),
            BlockSizeChoice::Exact(22_050)
        ));
    }

    #[test]
    fn encode_pcm_to_flac_supports_mono_and_stereo() {
        for channels in [1u16, 2u16] {
            let dest = std::env::temp_dir().join(format!(
                "spiral-flac-ch{channels}-{}.flac",
                std::process::id()
            ));
            let _ = fs::remove_file(&dest);

            encode_pcm_to_flac(&silence_pcm(channels, 4096), &dest).expect("encode");
            assert_flac_magic(&dest);

            let decoded =
                super::super::decode::pcm_from_audio_file(&dest).expect("decode round-trip");
            assert_eq!(decoded.channels, channels);
            assert_eq!(decoded.sample_rate, 44_100);
            assert_eq!(decoded.samples.len(), 4096 * channels as usize);
            assert!(decoded.samples.iter().all(|&s| s == 0));

            let _ = fs::remove_file(&dest);
        }
    }

    #[test]
    fn encode_pcm_to_flac_handles_non_dividing_frame_counts() {
        let dest =
            std::env::temp_dir().join(format!("spiral-flac-odd-{}.flac", std::process::id()));
        let _ = fs::remove_file(&dest);

        let pcm = PcmStream {
            channels: 2,
            sample_rate: 44_100,
            samples: (0..4410 * 2)
                .map(|i| ((i % 64) as i16).wrapping_mul(17))
                .collect(),
        };
        encode_pcm_to_flac(&pcm, &dest).expect("encode");
        assert_flac_magic(&dest);

        let decoded = super::super::decode::pcm_from_audio_file(&dest).expect("decode");
        assert_eq!(decoded.channels, 2);
        assert_eq!(decoded.sample_rate, 44_100);
        assert_eq!(decoded.samples, pcm.samples);

        let _ = fs::remove_file(&dest);
    }

    #[test]
    fn encode_pcm_to_flac_rejects_too_many_channels() {
        let pcm = PcmStream {
            channels: 9,
            sample_rate: 44_100,
            samples: vec![0; 9 * 64],
        };
        let err = encode_pcm_to_flac(&pcm, Path::new("out.flac")).unwrap_err();
        assert!(err.contains("up to 8 channels"));
    }

    #[test]
    fn encode_pcm_to_flac_rejects_empty_samples() {
        let pcm = PcmStream {
            channels: 2,
            sample_rate: 44_100,
            samples: vec![],
        };
        let err = encode_pcm_to_flac(&pcm, Path::new("out.flac")).unwrap_err();
        assert!(err.contains("requires audio samples"));
    }
}
