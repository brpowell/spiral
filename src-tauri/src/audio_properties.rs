use std::path::Path;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct AudioProperties {
    pub sample_rate: Option<u32>,
    pub bitrate: Option<u32>,
    pub codec: Option<String>,
}

pub fn read_audio_properties(path: &Path) -> AudioProperties {
    if !path.is_file() {
        return AudioProperties::default();
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());

    #[cfg(target_os = "macos")]
    if let Some(mut props) = read_afinfo_properties(path) {
        if props.codec.is_none() {
            props.codec = codec_from_extension(ext.as_deref());
        }
        return props;
    }

    let mut props = match ext.as_deref() {
        Some("flac") => read_flac_properties(path),
        Some("wav") => read_wav_properties(path),
        Some("mp3") => read_mp3_properties(path),
        Some("m4a") | Some("aac") | Some("mp4") => read_mp4_properties(path),
        Some("ogg") => read_ogg_properties(path),
        Some("opus") => read_opus_properties(path),
        _ => AudioProperties::default(),
    };

    if props.codec.is_none() {
        props.codec = codec_from_extension(ext.as_deref());
    }

    props
}

fn codec_from_extension(ext: Option<&str>) -> Option<String> {
    match ext {
        Some("mp3") => Some("mp3".into()),
        Some("flac") => Some("flac".into()),
        Some("m4a") | Some("aac") | Some("mp4") => Some("aac".into()),
        Some("wav") => Some("pcm".into()),
        Some("ogg") => Some("vorbis".into()),
        Some("opus") => Some("opus".into()),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn read_afinfo_properties(path: &Path) -> Option<AudioProperties> {
    use std::process::Command;

    let output = Command::new("afinfo").arg(path).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Some(parse_afinfo_properties(&stdout))
}

#[cfg(any(target_os = "macos", test))]
fn parse_afinfo_properties(stdout: &str) -> AudioProperties {
    let mut props = AudioProperties::default();

    for line in stdout.lines() {
        let trimmed = line.trim();

        if let Some(rest) = trimmed.strip_prefix("Data format:") {
            if let Some(rate) = parse_hz_value(rest) {
                props.sample_rate = Some(rate);
            }
            if let Some(codec) = parse_data_format_codec(rest) {
                props.codec = Some(codec);
            }
            if let Some(bitrate) = parse_inline_bitrate(rest) {
                props.bitrate = Some(bitrate);
            }
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("bit rate:") {
            if let Some(bitrate) = parse_bitrate_number(rest) {
                props.bitrate = Some(bitrate);
            }
        }
    }

    props
}

#[cfg(any(target_os = "macos", test))]
fn parse_hz_value(text: &str) -> Option<u32> {
    let lower = text.to_ascii_lowercase();
    let hz_idx = lower.find(" hz")?;
    let prefix = &text[..hz_idx];
    let digits: String = prefix
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    digits.parse::<f64>().ok().map(|v| v.round() as u32)
}

#[cfg(any(target_os = "macos", test))]
fn parse_data_format_codec(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    if lower.contains("alac") {
        return Some("alac".into());
    }
    if lower.contains("flac") {
        return Some("flac".into());
    }
    if lower.contains("aac") {
        return Some("aac".into());
    }
    if lower.contains("mp3") || lower.contains("mpg3") {
        return Some("mp3".into());
    }
    if lower.contains("lpcm")
        || lower.contains("pcm")
        || lower.contains("int16")
        || lower.contains("int24")
        || lower.contains("int32")
        || lower.contains("float32")
        || lower.contains("float64")
        || lower.contains("f32")
        || lower.contains("f64")
    {
        return Some("pcm".into());
    }
    None
}

#[cfg(any(target_os = "macos", test))]
fn parse_inline_bitrate(text: &str) -> Option<u32> {
    let lower = text.to_ascii_lowercase();
    if !lower.contains("bits/sec") && !lower.contains("bits per second") {
        return None;
    }
    parse_bitrate_number(text)
}

#[cfg(any(target_os = "macos", test))]
fn parse_bitrate_number(text: &str) -> Option<u32> {
    text.split_whitespace()
        .find_map(|token| token.trim_end_matches(',').parse::<f64>().ok())
        .map(|value| value.round() as u32)
}

fn read_flac_properties(path: &Path) -> AudioProperties {
    let mut props = AudioProperties {
        codec: Some("flac".into()),
        ..AudioProperties::default()
    };

    let Ok(tag) = metaflac::Tag::read_from_path(path) else {
        return props;
    };

    let Some(streaminfo) = tag.get_streaminfo() else {
        return props;
    };

    if streaminfo.sample_rate > 0 {
        props.sample_rate = Some(streaminfo.sample_rate);
    }

    if streaminfo.bits_per_sample > 0 && streaminfo.num_channels > 0 && streaminfo.sample_rate > 0 {
        let bitrate = u64::from(streaminfo.bits_per_sample)
            * u64::from(streaminfo.num_channels)
            * u64::from(streaminfo.sample_rate);
        props.bitrate = Some(bitrate.min(u64::from(u32::MAX)) as u32);
    }

    props
}

fn read_wav_properties(path: &Path) -> AudioProperties {
    let mut props = AudioProperties {
        codec: Some("pcm".into()),
        ..AudioProperties::default()
    };

    let Ok(data) = std::fs::read(path) else {
        return props;
    };

    if data.len() < 44 || &data[0..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return props;
    }

    let mut offset = 12usize;
    while offset + 8 <= data.len() {
        let chunk_id = &data[offset..offset + 4];
        let chunk_size_bytes: [u8; 4] = match data[offset + 4..offset + 8].try_into() {
            Ok(bytes) => bytes,
            Err(_) => break,
        };
        let chunk_size = u32::from_le_bytes(chunk_size_bytes) as usize;
        offset += 8;
        if offset + chunk_size > data.len() {
            break;
        }

        if chunk_id == b"fmt " && chunk_size >= 16 {
            let sample_rate_bytes: [u8; 4] = match data[offset + 4..offset + 8].try_into() {
                Ok(bytes) => bytes,
                Err(_) => break,
            };
            let sample_rate = u32::from_le_bytes(sample_rate_bytes);
            let channels_bytes: [u8; 2] = match data[offset + 2..offset + 4].try_into() {
                Ok(bytes) => bytes,
                Err(_) => break,
            };
            let channels = u16::from_le_bytes(channels_bytes);
            let bits_bytes: [u8; 2] = match data[offset + 14..offset + 16].try_into() {
                Ok(bytes) => bytes,
                Err(_) => break,
            };
            let bits_per_sample = u16::from_le_bytes(bits_bytes);
            if sample_rate > 0 {
                props.sample_rate = Some(sample_rate);
            }
            if bits_per_sample > 0 && channels > 0 && sample_rate > 0 {
                let bitrate =
                    u64::from(bits_per_sample) * u64::from(channels) * u64::from(sample_rate);
                props.bitrate = Some(bitrate.min(u64::from(u32::MAX)) as u32);
            }
        }

        offset += chunk_size + (chunk_size % 2);
    }

    props
}

fn read_mp3_properties(path: &Path) -> AudioProperties {
    let mut props = AudioProperties {
        codec: Some("mp3".into()),
        ..AudioProperties::default()
    };

    if let Ok(data) = std::fs::read(path) {
        if let Some(header) = find_mp3_frame_header(&data) {
            apply_mp3_header(&mut props, header);
        }
    }

    // Cover art / ID3 bytes can still defeat the header scan; Symphonia is the fallback.
    if props.sample_rate.is_none() || props.bitrate.is_none() {
        let fallback = probe_symphonia_properties(path, Some("mp3"));
        if props.sample_rate.is_none() {
            props.sample_rate = fallback.sample_rate;
        }
        if props.bitrate.is_none() {
            props.bitrate = fallback.bitrate;
        }
        if props.codec.is_none() {
            props.codec = fallback.codec;
        }
    }

    props
}

fn apply_mp3_header(props: &mut AudioProperties, header: u32) {
    let version = (header >> 19) & 0x3;
    let bitrate_index = ((header >> 12) & 0xF) as usize;
    let sample_rate_index = ((header >> 10) & 0x3) as usize;

    let sample_rates: [u32; 3] = if version == 0b11 {
        [44_100, 48_000, 32_000]
    } else if version == 0b10 {
        [22_050, 24_000, 16_000]
    } else {
        [11_025, 12_000, 8_000]
    };

    if sample_rate_index < 3 {
        props.sample_rate = Some(sample_rates[sample_rate_index]);
    }

    let bitrates_kbps: [u32; 16] = if version == 0b11 {
        [
            0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
        ]
    } else {
        [
            0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
        ]
    };

    if bitrate_index > 0 && bitrate_index < 15 {
        props.bitrate = Some(bitrates_kbps[bitrate_index] * 1000);
    }
}

fn skip_id3v2_offset(data: &[u8]) -> usize {
    if data.len() < 10 || &data[0..3] != b"ID3" {
        return 0;
    }
    let size = ((u32::from(data[6]) & 0x7F) << 21)
        | ((u32::from(data[7]) & 0x7F) << 14)
        | ((u32::from(data[8]) & 0x7F) << 7)
        | (u32::from(data[9]) & 0x7F);
    let footer = if data[5] & 0x10 != 0 { 10usize } else { 0 };
    let offset = 10usize.saturating_add(size as usize).saturating_add(footer);
    offset.min(data.len())
}

fn is_valid_mp3_frame_header(header: u32) -> bool {
    if header & 0xFFE0_0000 != 0xFFE0_0000 {
        return false;
    }
    let version = (header >> 19) & 0x3;
    let layer = (header >> 17) & 0x3;
    let bitrate_index = (header >> 12) & 0xF;
    let sample_rate_index = (header >> 10) & 0x3;
    // Layer III only; reject reserved version/layer and free/bad bitrate or reserved rate.
    version != 0b01
        && layer == 0b01
        && bitrate_index != 0
        && bitrate_index != 0xF
        && sample_rate_index != 0b11
}

fn find_mp3_frame_header(data: &[u8]) -> Option<u32> {
    let limit = data.len().saturating_sub(4);
    let mut offset = skip_id3v2_offset(data);
    while offset < limit {
        if data[offset] == 0xFF && (data[offset + 1] & 0xE0) == 0xE0 {
            let header_bytes: [u8; 4] = data[offset..offset + 4].try_into().ok()?;
            let header = u32::from_be_bytes(header_bytes);
            if is_valid_mp3_frame_header(header) {
                return Some(header);
            }
        }
        offset += 1;
    }
    None
}

fn read_mp4_properties(path: &Path) -> AudioProperties {
    probe_symphonia_properties(path, None)
}

fn read_ogg_properties(path: &Path) -> AudioProperties {
    probe_symphonia_properties(path, Some("vorbis"))
}

fn read_opus_properties(path: &Path) -> AudioProperties {
    probe_symphonia_properties(path, Some("opus"))
}

fn probe_symphonia_properties(path: &Path, codec_hint: Option<&str>) -> AudioProperties {
    use std::fs::File;

    use symphonia::core::codecs::{
        CODEC_TYPE_AAC, CODEC_TYPE_ALAC, CODEC_TYPE_FLAC, CODEC_TYPE_MP3, CODEC_TYPE_NULL,
        CODEC_TYPE_OPUS, CODEC_TYPE_VORBIS,
    };
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let mut props = AudioProperties {
        codec: codec_hint.map(str::to_string),
        ..AudioProperties::default()
    };

    let Ok(file) = File::open(path) else {
        return props;
    };
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(ext);
    }

    let Ok(probed) = symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    ) else {
        return props;
    };

    let track = probed
        .format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL);

    let Some(track) = track else {
        return props;
    };

    let detected = match track.codec_params.codec {
        CODEC_TYPE_AAC => Some("aac"),
        CODEC_TYPE_ALAC => Some("alac"),
        CODEC_TYPE_MP3 => Some("mp3"),
        CODEC_TYPE_FLAC => Some("flac"),
        CODEC_TYPE_VORBIS => Some("vorbis"),
        CODEC_TYPE_OPUS => Some("opus"),
        _ => None,
    };
    if detected.is_some() {
        props.codec = detected.map(str::to_string);
    } else if props.codec.is_none() {
        props.codec = codec_from_extension(
            path.extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .as_deref(),
        );
    }

    if let Some(rate) = track.codec_params.sample_rate {
        props.sample_rate = Some(rate);
    }

    if let (Some(n_frames), Some(rate)) =
        (track.codec_params.n_frames, track.codec_params.sample_rate)
    {
        if rate > 0 && n_frames > 0 {
            let duration_secs = n_frames as f64 / rate as f64;
            if duration_secs > 0.0 {
                let file_size = std::fs::metadata(path).ok().map(|m| m.len()).unwrap_or(0);
                if file_size > 0 {
                    let bitrate = ((file_size as f64 * 8.0) / duration_secs).round() as u32;
                    if bitrate > 0 {
                        props.bitrate = Some(bitrate);
                    }
                }
            }
        }
    }

    props
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures::wav;

    #[test]
    fn parse_hz_value_reads_sample_rate() {
        assert_eq!(parse_hz_value("2 ch,  44100 Hz, FLAC"), Some(44_100));
    }

    #[test]
    fn parse_data_format_codec_normalizes_values() {
        assert_eq!(
            parse_data_format_codec("2 ch, 44100 Hz, alac (0x1)"),
            Some("alac".into())
        );
        assert_eq!(
            parse_data_format_codec("2 ch, 44100 Hz, '.mp3'"),
            Some("mp3".into())
        );
        assert_eq!(
            parse_data_format_codec("2 ch, 44100 Hz, Int16, interleaved"),
            Some("pcm".into())
        );
    }

    #[test]
    fn parse_bitrate_number_reads_first_number() {
        assert_eq!(parse_bitrate_number("256000 bits/sec"), Some(256_000));
        assert_eq!(
            parse_bitrate_number("193239.6 bits per second"),
            Some(193_240)
        );
    }

    #[test]
    fn parse_afinfo_properties_reads_pcm_wav_int16() {
        let stdout = "\
File type ID:   WAVE
Data format:     2 ch,  44100 Hz, Int16, interleaved
bit rate: 1411200 bits per second
";
        let props = parse_afinfo_properties(stdout);
        assert_eq!(props.sample_rate, Some(44_100));
        assert_eq!(props.codec.as_deref(), Some("pcm"));
        assert_eq!(props.bitrate, Some(1_411_200));
    }

    #[test]
    fn parse_afinfo_properties_reads_all_fields() {
        let stdout = "\
File type ID:   m4af
Data format:     2 ch,  44100 Hz, aac (0x00000000) 256000 bits/sec
bit rate: 256000 bits per second
";
        let props = parse_afinfo_properties(stdout);
        assert_eq!(props.sample_rate, Some(44_100));
        assert_eq!(props.codec.as_deref(), Some("aac"));
        assert_eq!(props.bitrate, Some(256_000));
    }

    #[test]
    fn read_wav_properties_reads_fmt_chunk() {
        let dir = std::env::temp_dir().join(format!("spiral-wav-props-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test.wav");
        wav::write_minimal(&path);

        let props = read_wav_properties(&path);
        assert_eq!(props.codec.as_deref(), Some("pcm"));
        assert_eq!(props.sample_rate, Some(48_000));
        assert_eq!(props.bitrate, Some(1_536_000));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_mp3_properties_skips_id3_jpeg_false_sync() {
        let dir = std::env::temp_dir().join(format!("spiral-mp3-props-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("cover.mp3");

        // ID3v2 with APIC JPEG (FF E0 JFIF) that used to be mistaken for an MP3 sync,
        // followed by a real MPEG-1 Layer III 128 kbps / 44.1 kHz frame header.
        let mut id3 = Vec::new();
        id3.extend_from_slice(b"ID3");
        id3.extend_from_slice(&[4, 0, 0]); // v2.4, no flags
        let jpeg = [
            0xFFu8, 0xD8, 0xFF, 0xE0, 0x00, 0x10, b'J', b'F', b'I', b'F', 0x00, 0x01,
        ];
        let mut apic = Vec::new();
        apic.push(0x03); // UTF-8
        apic.extend_from_slice(b"image/jpeg\0");
        apic.push(0x03); // Cover (front)
        apic.push(0x00); // empty description
        apic.extend_from_slice(&jpeg);
        let mut frames = Vec::new();
        frames.extend_from_slice(b"APIC");
        frames.extend_from_slice(&(apic.len() as u32).to_be_bytes());
        frames.extend_from_slice(&[0, 0]);
        frames.extend_from_slice(&apic);
        let size = frames.len() as u32;
        id3.extend_from_slice(&[
            ((size >> 21) & 0x7F) as u8,
            ((size >> 14) & 0x7F) as u8,
            ((size >> 7) & 0x7F) as u8,
            (size & 0x7F) as u8,
        ]);
        id3.extend_from_slice(&frames);

        let mut file = std::fs::File::create(&path).unwrap();
        use std::io::Write;
        file.write_all(&id3).unwrap();
        // MPEG-1 Layer III, 128 kbps, 44.1 kHz
        file.write_all(&[0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00])
            .unwrap();

        let props = read_mp3_properties(&path);
        assert_eq!(props.codec.as_deref(), Some("mp3"));
        assert_eq!(props.sample_rate, Some(44_100));
        assert_eq!(props.bitrate, Some(128_000));

        let via_public = read_audio_properties(&path);
        assert_eq!(via_public.sample_rate, Some(44_100));
        assert_eq!(via_public.bitrate, Some(128_000));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_mp4_properties_reads_m4a_fixture() {
        let dir = std::env::temp_dir().join(format!("spiral-m4a-props-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = crate::test_fixtures::m4a::copy_moov_before_mdat(&dir, "probe.m4a");

        let props = read_audio_properties(&path);
        assert!(
            props.sample_rate.unwrap_or(0) > 0,
            "expected sample rate, got {props:?}"
        );
        assert!(
            props.bitrate.unwrap_or(0) > 0,
            "expected bitrate, got {props:?}"
        );
        assert!(
            matches!(props.codec.as_deref(), Some("aac") | Some("alac")),
            "expected aac or alac, got {props:?}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
