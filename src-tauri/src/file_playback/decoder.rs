//! Incremental Symphonia / opus-decoder source for file PCM playback.
//!
//! Supported: OGG Vorbis, Opus, and ALAC (m4a). Opus uses `opus-decoder`;
//! Vorbis and ALAC use Symphonia.

use std::collections::VecDeque;
use std::fs::File;
use std::path::Path;

use opus_decoder::OpusDecoder;
use symphonia::core::audio::{AudioBufferRef, SampleBuffer};
use symphonia::core::codecs::{
    Decoder, DecoderOptions, CODEC_TYPE_ALAC, CODEC_TYPE_NULL, CODEC_TYPE_OPUS, CODEC_TYPE_VORBIS,
};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

const OPUS_PCM_BUFFER_SAMPLES: usize = 5760 * 2;

enum Backend {
    Symphonia {
        format: Box<dyn FormatReader>,
        track_id: u32,
        decoder: Box<dyn Decoder>,
        channels: usize,
        sample_rate: u32,
        pending: VecDeque<f32>,
    },
    Opus {
        format: Box<dyn FormatReader>,
        track_id: u32,
        decoder: OpusDecoder,
        channels: usize,
        sample_rate: u32,
        pending: VecDeque<f32>,
        pcm_scratch: Vec<f32>,
        packets_seen: u32,
    },
}

pub struct StreamingDecoder {
    backend: Backend,
    duration_seconds: f64,
    samples_emitted: u64,
}

impl StreamingDecoder {
    pub fn open(path: &Path) -> Result<Self, String> {
        let label = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("audio");

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
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .map_err(|err| format_open_failure(label, err))?;

        let format = probed.format;
        let track = format
            .tracks()
            .iter()
            .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or_else(|| format!("No decodable audio track in {label}"))?;

        let track_id = track.id;
        let sample_rate = track
            .codec_params
            .sample_rate
            .filter(|rate| *rate > 0)
            .ok_or_else(|| format!("Missing sample rate in {label}"))?;

        let duration_seconds = track
            .codec_params
            .n_frames
            .zip(track.codec_params.sample_rate)
            .map(|(frames, rate)| frames as f64 / rate as f64)
            .filter(|seconds| *seconds > 0.0)
            .unwrap_or(0.0);

        let backend = if track.codec_params.codec == CODEC_TYPE_OPUS {
            let channels = track
                .codec_params
                .channels
                .map(|layout| layout.count())
                .filter(|count| *count > 0)
                .unwrap_or(2)
                .min(2);

            // opus-decoder output rate; Opus packets decode to 48 kHz PCM.
            let decoder = OpusDecoder::new(48_000, channels)
                .map_err(|err| format!("Failed to init Opus decoder for {label}: {err}"))?;

            Backend::Opus {
                format,
                track_id,
                decoder,
                channels,
                sample_rate: 48_000,
                pending: VecDeque::new(),
                pcm_scratch: vec![0.0; OPUS_PCM_BUFFER_SAMPLES],
                packets_seen: 0,
            }
        } else if track.codec_params.codec == CODEC_TYPE_VORBIS
            || track.codec_params.codec == CODEC_TYPE_ALAC
        {
            let decoder = symphonia::default::get_codecs()
                .make(&track.codec_params, &DecoderOptions::default())
                .map_err(|err| format_open_failure(label, err))?;

            let channels = output_channels_for_track(track.codec_params.channels)?;

            Backend::Symphonia {
                format,
                track_id,
                decoder,
                channels,
                sample_rate,
                pending: VecDeque::new(),
            }
        } else {
            return Err(format!(
                "Unsupported codec {:?} in {label} (expected Vorbis, Opus, or ALAC)",
                track.codec_params.codec
            ));
        };

        Ok(Self {
            backend,
            duration_seconds,
            samples_emitted: 0,
        })
    }

    pub fn duration_seconds(&self) -> f64 {
        self.duration_seconds
    }

    pub fn sample_rate(&self) -> u32 {
        match &self.backend {
            Backend::Symphonia { sample_rate, .. } => *sample_rate,
            Backend::Opus { sample_rate, .. } => *sample_rate,
        }
    }

    pub fn channels(&self) -> u16 {
        match &self.backend {
            Backend::Symphonia { channels, .. } => *channels as u16,
            Backend::Opus { channels, .. } => *channels as u16,
        }
    }

    pub fn position_seconds(&self) -> f64 {
        let rate = self.sample_rate();
        let channels = self.channels().max(1) as u64;
        if rate == 0 {
            return 0.0;
        }
        (self.samples_emitted / channels) as f64 / rate as f64
    }

    pub fn seek_seconds(&mut self, seconds: f64) -> Result<(), String> {
        let track_id = match &self.backend {
            Backend::Symphonia { track_id, .. } => *track_id,
            Backend::Opus { track_id, .. } => *track_id,
        };

        let time = Time::from(seconds.max(0.0));
        let seeked_to = match &mut self.backend {
            Backend::Symphonia { format, .. } | Backend::Opus { format, .. } => format
                .seek(
                    SeekMode::Accurate,
                    SeekTo::Time {
                        time,
                        track_id: Some(track_id),
                    },
                )
                .map_err(|err| format!("Seek failed: {err}"))?,
        };

        self.samples_emitted = seeked_to
            .actual_ts
            .saturating_mul(self.channels() as u64);

        clear_pending(&mut self.backend);

        let sample_rate = self.sample_rate();
        let channels = self.channels() as usize;

        match &mut self.backend {
            Backend::Symphonia { decoder, .. } => decoder.reset(),
            Backend::Opus {
                decoder,
                packets_seen,
                ..
            } => {
                *decoder = OpusDecoder::new(sample_rate, channels)
                    .map_err(|err| format!("Failed to reset Opus decoder: {err}"))?;
                *packets_seen = 0;
            }
        }

        Ok(())
    }

    pub fn next_sample(&mut self) -> Option<f32> {
        loop {
            if let Some(sample) = pop_pending(&mut self.backend) {
                self.samples_emitted += 1;
                return Some(sample);
            }

            match self.decode_more() {
                Ok(true) => {}
                Ok(false) => return None,
                Err(err) => {
                    eprintln!("file decode error: {err}");
                    return None;
                }
            }
        }
    }

    fn decode_more(&mut self) -> Result<bool, String> {
        match &mut self.backend {
            Backend::Symphonia {
                format,
                track_id,
                decoder,
                channels,
                pending,
                ..
            } => {
                loop {
                    let packet = match format.next_packet() {
                        Ok(packet) => packet,
                        Err(SymphoniaError::IoError(err))
                            if err.kind() == std::io::ErrorKind::UnexpectedEof =>
                        {
                            return Ok(false);
                        }
                        Err(SymphoniaError::ResetRequired) => {
                            decoder.reset();
                            continue;
                        }
                        Err(_) => return Ok(false),
                    };

                    if packet.track_id() != *track_id {
                        continue;
                    }

                    let decoded = match decoder.decode(&packet) {
                        Ok(decoded) => decoded,
                        Err(SymphoniaError::DecodeError(_)) => continue,
                        Err(SymphoniaError::ResetRequired) => {
                            decoder.reset();
                            continue;
                        }
                        Err(_) => return Ok(false),
                    };

                    append_decoded(decoded, *channels, pending);
                    if !pending.is_empty() {
                        return Ok(true);
                    }
                }
            }
            Backend::Opus {
                format,
                track_id,
                decoder,
                channels,
                pending,
                pcm_scratch,
                packets_seen,
                ..
            } => {
                loop {
                    let packet = match format.next_packet() {
                        Ok(packet) => packet,
                        Err(SymphoniaError::IoError(err))
                            if err.kind() == std::io::ErrorKind::UnexpectedEof =>
                        {
                            return Ok(false);
                        }
                        Err(_) => return Ok(false),
                    };

                    if packet.track_id() != *track_id {
                        continue;
                    }

                    *packets_seen += 1;
                    if *packets_seen <= 2 {
                        continue;
                    }

                    let frame_samples = match decoder.decode_float(
                        packet.buf(),
                        pcm_scratch,
                        false,
                    ) {
                        Ok(samples) => samples,
                        Err(_) => continue,
                    };

                    if frame_samples == 0 {
                        continue;
                    }

                    let interleaved = frame_samples * *channels;
                    for sample in pcm_scratch.iter().take(interleaved) {
                        pending.push_back(*sample);
                    }

                    if !pending.is_empty() {
                        return Ok(true);
                    }
                }
            }
        }
    }
}

fn clear_pending(backend: &mut Backend) {
    match backend {
        Backend::Symphonia { pending, .. } | Backend::Opus { pending, .. } => pending.clear(),
    }
}

fn pop_pending(backend: &mut Backend) -> Option<f32> {
    match backend {
        Backend::Symphonia { pending, .. } | Backend::Opus { pending, .. } => pending.pop_front(),
    }
}

fn output_channels_for_track(channels: Option<symphonia::core::audio::Channels>) -> Result<usize, String> {
    let count = channels
        .map(|layout| layout.count())
        .filter(|count| *count > 0)
        .unwrap_or(2);
    Ok(count.min(2).max(1))
}

fn append_decoded(decoded: AudioBufferRef<'_>, output_channels: usize, pending: &mut VecDeque<f32>) {
    let spec = *decoded.spec();
    let duration = decoded.capacity() as u64;
    let mut sample_buf = SampleBuffer::<f32>::new(duration, spec);
    sample_buf.copy_interleaved_ref(decoded);
    let samples = sample_buf.samples();
    let source_channels = spec.channels.count();

    if source_channels <= 1 {
        for &sample in samples {
            for _ in 0..output_channels {
                pending.push_back(sample);
            }
        }
        return;
    }

    if source_channels == 2 || output_channels == 1 {
        if output_channels == 1 {
            for chunk in samples.chunks(source_channels) {
                let left = chunk.first().copied().unwrap_or(0.0);
                let right = chunk.get(1).copied().unwrap_or(left);
                pending.push_back((left + right) * 0.5);
            }
        } else {
            for chunk in samples.chunks(source_channels) {
                pending.push_back(chunk.first().copied().unwrap_or(0.0));
                pending.push_back(chunk.get(1).copied().unwrap_or(0.0));
            }
        }
        return;
    }

    // Downmix multichannel to stereo.
    for chunk in samples.chunks(source_channels) {
        let left = chunk.first().copied().unwrap_or(0.0);
        let right = chunk.get(1).copied().unwrap_or(left);
        pending.push_back(left);
        pending.push_back(right);
    }
}

fn format_open_failure(label: &str, err: SymphoniaError) -> String {
    format!("Could not open {label}: {err}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_channels_caps_at_stereo() {
        assert_eq!(
            output_channels_for_track(Some(symphonia::core::audio::Channels::FRONT_LEFT))
                .unwrap(),
            1
        );
    }
}
