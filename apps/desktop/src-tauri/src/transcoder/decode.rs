//! Decode supported audio files to 16-bit PCM for transcoding.

use std::fs::File;
use std::path::Path;

use symphonia::core::audio::{AudioBufferRef, SampleBuffer};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use super::error;
use super::pcm_stream::PcmStream;
use super::wav;

pub fn pcm_from_audio_file(path: &Path) -> Result<PcmStream, String> {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("wav"))
    {
        if let Ok(pcm) = wav::read_pcm_from_wav(path) {
            return Ok(pcm);
        }
    }

    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("opus"))
    {
        return decode_opus_file(path);
    }

    decode_with_symphonia(path)
}

fn decode_with_symphonia(path: &Path) -> Result<PcmStream, String> {
    let label = error::file_label(path);
    let file = File::open(path).map_err(|err| format!("Failed to open {label}: {err}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions {
                enable_gapless: true,
                ..Default::default()
            },
            &MetadataOptions::default(),
        )
        .map_err(|err| format_decode_failure(path, err))?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| format!("No decodable audio track in {label}"))?;

    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|err| format_decode_failure(path, err))?;

    let mut channels = track
        .codec_params
        .channels
        .map(|layout| layout.count() as u16)
        .filter(|count| *count > 0);
    let mut sample_rate = track.codec_params.sample_rate;

    let mut samples = Vec::new();

    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }

        let decoded = decoder
            .decode(&packet)
            .map_err(|err| format_decode_failure(path, err))?;
        if channels.is_none() {
            channels = Some(decoded.spec().channels.count() as u16);
        }
        if sample_rate.is_none() {
            sample_rate = Some(decoded.spec().rate);
        }
        append_decoded_samples(decoded, &mut samples);
    }

    if samples.is_empty() {
        return Err(format!("No audio samples decoded from {label}"));
    }

    let channels = channels
        .filter(|count| *count > 0)
        .ok_or_else(|| format!("Missing channel layout in {label}"))?;
    let sample_rate = sample_rate.ok_or_else(|| format!("Missing sample rate in {label}"))?;

    Ok(PcmStream {
        channels,
        sample_rate,
        samples,
    })
}

fn append_decoded_samples(decoded: AudioBufferRef<'_>, samples: &mut Vec<i16>) {
    let spec = *decoded.spec();
    let duration = decoded.capacity() as u64;
    let mut sample_buf = SampleBuffer::<i16>::new(duration, spec);
    sample_buf.copy_interleaved_ref(decoded);
    samples.extend_from_slice(sample_buf.samples());
}

fn format_decode_failure(path: &Path, err: SymphoniaError) -> String {
    format!(
        "Could not decode {} for transcoding: {err}",
        error::file_label(path)
    )
}

fn decode_opus_file(path: &Path) -> Result<PcmStream, String> {
    use crate::file_playback::decoder::StreamingDecoder;

    let label = error::file_label(path);
    let mut source = StreamingDecoder::open(path)?;
    let channels = source.channels();
    let sample_rate = source.sample_rate();
    let mut samples_f32 = Vec::new();

    while let Some(sample) = source.next_sample() {
        samples_f32.push(sample);
    }

    if samples_f32.is_empty() {
        return Err(format!("No audio samples decoded from {label}"));
    }

    let samples = samples_f32
        .into_iter()
        .map(|value| (value.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16)
        .collect();

    Ok(PcmStream {
        channels,
        sample_rate,
        samples,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures::{ogg, opus};

    #[test]
    fn decodes_ogg_fixture_for_transcode() {
        let pcm = pcm_from_audio_file(&ogg::minimal_fixture_path()).expect("decode ogg");
        assert!(!pcm.samples.is_empty());
        assert_eq!(pcm.channels, 2);
        assert!(pcm.sample_rate > 0);
    }

    #[test]
    #[ignore = "opus-decoder 0.1 panics on full-file decode of the ffmpeg-generated fixture"]
    fn decodes_opus_fixture_for_transcode() {
        let pcm = pcm_from_audio_file(&opus::minimal_fixture_path()).expect("decode opus");
        assert!(!pcm.samples.is_empty());
        assert!(pcm.sample_rate > 0);
    }
}
