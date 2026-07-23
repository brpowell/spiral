//! Encode interleaved PCM to MP3 via bundled libmp3lame.

use std::fs::File;
use std::io::Write;
use std::path::Path;

use mp3lame_encoder::{
    Bitrate, Builder, Encoder, FlushNoGap, InterleavedPcm, MonoPcm, Quality, VbrMode,
};

use crate::encoding_profiles;

use super::pcm_stream::PcmStream;

const ENCODE_CHUNK_SAMPLES: usize = 1152;

pub fn encode_pcm_to_mp3(
    pcm: &PcmStream,
    dest: &Path,
    profile: &encoding_profiles::EncodingProfile,
) -> Result<(), String> {
    if pcm.channels > 2 {
        return Err(format!(
            "MP3 encoding supports mono and stereo only (got {} channels)",
            pcm.channels
        ));
    }

    let mut encoder = build_encoder(pcm.channels, pcm.sample_rate, profile)?;
    let mut output = File::create(dest)
        .map_err(|err| format!("Failed to create {}: {err}", dest.display()))?;

    let frame_samples = pcm.channels as usize;
    if frame_samples == 0 {
        return Err("Cannot encode MP3 with zero channels".into());
    }

    let mut mp3_buffer = Vec::new();
    for frame in pcm.samples.chunks(ENCODE_CHUNK_SAMPLES * frame_samples) {
        if frame.is_empty() {
            continue;
        }
        append_encoded(&mut encoder, pcm.channels, frame, &mut mp3_buffer)?;
        if !mp3_buffer.is_empty() {
            output
                .write_all(&mp3_buffer)
                .map_err(|err| format!("Failed to write MP3 data: {err}"))?;
            mp3_buffer.clear();
        }
    }

    append_flushed(&mut encoder, &mut mp3_buffer)?;
    if !mp3_buffer.is_empty() {
        output
            .write_all(&mp3_buffer)
            .map_err(|err| format!("Failed to finalize MP3 data: {err}"))?;
    }

    if !dest.is_file() {
        return Err(format!("MP3 output missing: {}", dest.display()));
    }

    Ok(())
}

fn build_encoder(
    channels: u16,
    sample_rate: u32,
    profile: &encoding_profiles::EncodingProfile,
) -> Result<Encoder, String> {
    let mut builder = Builder::new().ok_or_else(|| "Failed to create LAME encoder".to_string())?;
    builder = builder
        .with_num_channels(
            u8::try_from(channels).map_err(|_| format!("Invalid channel count: {channels}"))?,
        )
        .map_err(map_build_error)?
        .with_sample_rate(sample_rate)
        .map_err(map_build_error)?
        .with_quality(Quality::Best)
        .map_err(map_build_error)?;

    builder = match profile.id {
        "mp3-high" => builder
            .with_brate(Bitrate::Kbps320)
            .map_err(map_build_error)?,
        "mp3-compact" => builder
            .with_vbr_mode(VbrMode::Mtrh)
            .map_err(map_build_error)?
            .with_vbr_quality(Quality::Good)
            .map_err(map_build_error)?,
        other => return Err(format!("Profile {other} is not an MP3 profile")),
    };

    builder.build().map_err(map_build_error)
}

fn append_encoded(
    encoder: &mut Encoder,
    channels: u16,
    frame: &[i16],
    output: &mut Vec<u8>,
) -> Result<(), String> {
    let capacity = mp3lame_encoder::max_required_buffer_size(frame.len());
    output.reserve(capacity);
    let spare = output.spare_capacity_mut();
    let spare = &mut spare[..capacity];

    let encoded_size = match channels {
        1 => encoder
            .encode(MonoPcm(frame), spare)
            .map_err(map_encode_error)?,
        2 => encoder
            .encode(InterleavedPcm(frame), spare)
            .map_err(map_encode_error)?,
        _ => unreachable!("channel count validated before encoding"),
    };

    unsafe {
        output.set_len(output.len().wrapping_add(encoded_size));
    }
    Ok(())
}

fn append_flushed(encoder: &mut Encoder, output: &mut Vec<u8>) -> Result<(), String> {
    let capacity = mp3lame_encoder::max_required_buffer_size(0);
    output.reserve(capacity);
    let spare = output.spare_capacity_mut();
    let spare = &mut spare[..capacity];

    let encoded_size = encoder
        .flush::<FlushNoGap>(spare)
        .map_err(map_encode_error)?;

    unsafe {
        output.set_len(output.len().wrapping_add(encoded_size));
    }
    Ok(())
}

fn map_build_error(err: mp3lame_encoder::BuildError) -> String {
    format!("Failed to initialize MP3 encoder: {err:?}")
}

fn map_encode_error(err: mp3lame_encoder::EncodeError) -> String {
    format!("MP3 encoding failed: {err:?}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoding_profiles::profile_from_id;

    #[test]
    fn mp3_high_builds_encoder() {
        let profile = profile_from_id("mp3-high").unwrap();
        build_encoder(2, 44_100, profile).expect("build encoder");
    }

    #[test]
    fn mp3_compact_builds_encoder() {
        let profile = profile_from_id("mp3-compact").unwrap();
        build_encoder(2, 44_100, profile).expect("build encoder");
    }

    #[test]
    fn encode_pcm_to_mp3_supports_mono_and_stereo() {
        let profile = profile_from_id("mp3-high").unwrap();
        for (channels, samples) in [(1u16, vec![0i16; 1152]), (2u16, vec![0i16; 1152 * 2])] {
            let dest = std::env::temp_dir().join(format!(
                "spiral-lame-ch{channels}-{}.mp3",
                std::process::id()
            ));
            let _ = std::fs::remove_file(&dest);
            let pcm = PcmStream {
                channels,
                sample_rate: 44_100,
                samples,
            };
            encode_pcm_to_mp3(&pcm, &dest, profile).expect("encode");
            assert!(dest.is_file());
            let _ = std::fs::remove_file(&dest);
        }
    }

    #[test]
    fn encode_pcm_to_mp3_rejects_too_many_channels() {
        let profile = profile_from_id("mp3-high").unwrap();
        let pcm = PcmStream {
            channels: 3,
            sample_rate: 44_100,
            samples: vec![0; 1152 * 3],
        };
        let err = encode_pcm_to_mp3(&pcm, Path::new("out.mp3"), profile).unwrap_err();
        assert!(err.contains("mono and stereo only"));
    }
}
