//! Incremental Symphonia / opus-decoder source for file PCM playback.
//!
//! Supported library codecs: OGG Vorbis, Opus, ALAC, AAC, MP3, FLAC, and PCM/WAV.
//! Opus uses `opus-decoder`; most formats use Symphonia. WAVE uses a native
//! RIFF reader so ID3-tagged files Spiral writes still play.

use std::collections::VecDeque;
use std::fs::File;
use std::path::Path;

use opus_decoder::OpusDecoder;
use symphonia::core::audio::{AudioBufferRef, SampleBuffer};
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL, CODEC_TYPE_OPUS};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

const OPUS_PCM_BUFFER_SAMPLES: usize = 5760 * 2;
/// Symphonia often rejects Accurate seeks at exact EOS; leave a small margin.
const SEEK_END_MARGIN_SECONDS: f64 = 0.05;
const SEEK_BACKOFF_STEP_SECONDS: f64 = 0.25;

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
    /// Interleaved f32 from the native WAVE reader (ID3-safe).
    PcmBuffer {
        samples: Vec<f32>,
        position: usize,
        channels: usize,
        sample_rate: u32,
    },
}

pub struct StreamingDecoder {
    backend: Backend,
    duration_seconds: f64,
    samples_emitted: u64,
}

impl StreamingDecoder {
    pub fn open(path: &Path) -> Result<Self, String> {
        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("wav"))
        {
            return Self::open_wav(path);
        }

        Self::open_symphonia(path)
    }

    fn open_wav(path: &Path) -> Result<Self, String> {
        let label = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("audio");

        let pcm = crate::transcoder::read_pcm_from_wav(path)
            .map_err(|err| format!("Failed to open {label}: {err}"))?;
        let channels = (pcm.channels as usize).max(1).min(2);
        let sample_rate = pcm.sample_rate;
        if sample_rate == 0 {
            return Err(format!("Missing sample rate in {label}"));
        }

        let frames = pcm.samples.len() / pcm.channels.max(1) as usize;
        let duration_seconds = frames as f64 / f64::from(sample_rate);
        let samples: Vec<f32> = pcm
            .samples
            .into_iter()
            .map(|sample| f32::from(sample) / 32768.0)
            .collect();

        Ok(Self {
            backend: Backend::PcmBuffer {
                samples,
                position: 0,
                channels,
                sample_rate,
            },
            duration_seconds,
            samples_emitted: 0,
        })
    }

    fn open_symphonia(path: &Path) -> Result<Self, String> {
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
            .map(|(frames, rate)| frames as f64 / f64::from(rate))
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
        } else {
            let decoder = symphonia::default::get_codecs()
                .make(&track.codec_params, &DecoderOptions::default())
                .map_err(|err| {
                    format!(
                        "Unsupported codec {:?} in {label}: {err}",
                        track.codec_params.codec
                    )
                })?;

            let channels = output_channels_for_track(track.codec_params.channels)?;

            Backend::Symphonia {
                format,
                track_id,
                decoder,
                channels,
                sample_rate,
                pending: VecDeque::new(),
            }
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
            Backend::Symphonia { sample_rate, .. }
            | Backend::Opus { sample_rate, .. }
            | Backend::PcmBuffer { sample_rate, .. } => *sample_rate,
        }
    }

    pub fn channels(&self) -> u16 {
        match &self.backend {
            Backend::Symphonia { channels, .. }
            | Backend::Opus { channels, .. }
            | Backend::PcmBuffer { channels, .. } => *channels as u16,
        }
    }

    pub fn position_seconds(&self) -> f64 {
        let rate = self.sample_rate();
        let channels = self.channels().max(1) as u64;
        if rate == 0 {
            return 0.0;
        }
        (self.samples_emitted / channels) as f64 / f64::from(rate)
    }

    pub fn seek_seconds(&mut self, seconds: f64) -> Result<(), String> {
        if let Backend::PcmBuffer {
            samples,
            position,
            channels,
            sample_rate,
        } = &mut self.backend
        {
            let channels = (*channels).max(1);
            let frame = (seconds.max(0.0) * f64::from(*sample_rate)).round() as usize;
            let max_frame = samples.len() / channels;
            *position = frame.min(max_frame) * channels;
            self.samples_emitted = *position as u64;
            return Ok(());
        }

        // Symphonia Accurate seek to exact EOS (or past the last packet) often
        // fails with "end of stream". Clamp slightly before duration and fall
        // back through Coarse + backed-off targets so scrub/crossfade seeks
        // near the end still land.
        let mut target = seconds.max(0.0);
        if self.duration_seconds > 0.0 {
            let max_seek = (self.duration_seconds - SEEK_END_MARGIN_SECONDS).max(0.0);
            target = target.min(max_seek);
        }

        if self.try_format_seek(target, SeekMode::Accurate).is_ok() {
            return Ok(());
        }
        if self.try_format_seek(target, SeekMode::Coarse).is_ok() {
            return Ok(());
        }

        let mut backoff = target;
        for _ in 0..8 {
            if backoff <= 0.0 {
                break;
            }
            backoff = (backoff - SEEK_BACKOFF_STEP_SECONDS).max(0.0);
            if self.try_format_seek(backoff, SeekMode::Coarse).is_ok() {
                return Ok(());
            }
        }

        self.try_format_seek(0.0, SeekMode::Coarse)
            .map_err(|err| format!("Seek failed: {err}"))
    }

    fn try_format_seek(&mut self, seconds: f64, mode: SeekMode) -> Result<(), String> {
        let track_id = match &self.backend {
            Backend::Symphonia { track_id, .. } | Backend::Opus { track_id, .. } => *track_id,
            Backend::PcmBuffer { .. } => return Ok(()),
        };

        let time = Time::from(seconds.max(0.0));
        let seeked_to = match &mut self.backend {
            Backend::Symphonia { format, .. } | Backend::Opus { format, .. } => format
                .seek(
                    mode,
                    SeekTo::Time {
                        time,
                        track_id: Some(track_id),
                    },
                )
                .map_err(|err| err.to_string())?,
            Backend::PcmBuffer { .. } => return Ok(()),
        };

        self.samples_emitted = seeked_to
            .actual_ts
            .saturating_mul(u64::from(self.channels()));

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
            Backend::PcmBuffer { .. } => {}
        }

        Ok(())
    }

    pub fn next_sample(&mut self) -> Option<f32> {
        if let Backend::PcmBuffer {
            samples,
            position,
            ..
        } = &mut self.backend
        {
            if *position >= samples.len() {
                return None;
            }
            let sample = samples[*position];
            *position += 1;
            self.samples_emitted += 1;
            return Some(sample);
        }

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
            Backend::PcmBuffer { .. } => Ok(false),
            Backend::Symphonia {
                format,
                track_id,
                decoder,
                channels,
                pending,
                ..
            } => loop {
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
            },
            Backend::Opus {
                format,
                track_id,
                decoder,
                channels,
                pending,
                pcm_scratch,
                packets_seen,
                ..
            } => loop {
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

                let frame_samples =
                    match decoder.decode_float(packet.buf(), pcm_scratch, false) {
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
            },
        }
    }
}

fn clear_pending(backend: &mut Backend) {
    match backend {
        Backend::Symphonia { pending, .. } | Backend::Opus { pending, .. } => pending.clear(),
        Backend::PcmBuffer { .. } => {}
    }
}

fn pop_pending(backend: &mut Backend) -> Option<f32> {
    match backend {
        Backend::Symphonia { pending, .. } | Backend::Opus { pending, .. } => pending.pop_front(),
        Backend::PcmBuffer { .. } => None,
    }
}

fn output_channels_for_track(
    channels: Option<symphonia::core::audio::Channels>,
) -> Result<usize, String> {
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
    use crate::test_fixtures::{m4a, wav};

    #[test]
    fn output_channels_caps_at_stereo() {
        assert_eq!(
            output_channels_for_track(Some(symphonia::core::audio::Channels::FRONT_LEFT))
                .unwrap(),
            1
        );
    }

    #[test]
    fn streaming_decoder_opens_aac_m4a_fixture() {
        let mut source =
            StreamingDecoder::open(&m4a::moov_before_mdat_fixture_path()).expect("open aac m4a");
        assert!(source.sample_rate() > 0);
        assert!(source.next_sample().is_some());
    }

    #[test]
    fn streaming_decoder_opens_flac_fixture() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac");
        let mut source = StreamingDecoder::open(&path).expect("open flac");
        assert!(source.sample_rate() > 0);
        assert!(source.next_sample().is_some());
    }

    #[test]
    fn streaming_decoder_opens_wav_fixture() {
        let mut source = StreamingDecoder::open(&wav::tagged_fixture_path()).expect("open wav");
        assert_eq!(source.sample_rate(), 48_000);
        assert!(source.next_sample().is_some());
    }

    #[test]
    fn streaming_decoder_seek_to_duration_does_not_fail() {
        // Seeking to exact duration historically failed with Symphonia "end of stream".
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.ogg");
        let mut source = StreamingDecoder::open(&path).expect("open ogg");
        let duration = source.duration_seconds();
        assert!(duration > 0.0);
        source
            .seek_seconds(duration)
            .expect("seek to duration should succeed");
        source
            .seek_seconds(duration + 1.0)
            .expect("seek past duration should clamp");
    }

    #[test]
    fn streaming_decoder_seek_near_end_can_continue_decoding() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.ogg");
        let mut source = StreamingDecoder::open(&path).expect("open ogg");
        let duration = source.duration_seconds();
        source
            .seek_seconds((duration - 0.5).max(0.0))
            .expect("seek near end");
        assert!(source.next_sample().is_some());
    }
}
