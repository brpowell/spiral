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

    #[cfg(target_os = "macos")]
    if let Some(props) = read_afinfo_properties(path) {
        return props;
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());

    let mut props = match ext.as_deref() {
        Some("flac") => read_flac_properties(path),
        Some("wav") => read_wav_properties(path),
        Some("mp3") => read_mp3_properties(path),
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

#[cfg(target_os = "macos")]
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
    if lower.contains("lpcm") || lower.contains("pcm") {
        return Some("pcm".into());
    }
    None
}

fn parse_inline_bitrate(text: &str) -> Option<u32> {
    let lower = text.to_ascii_lowercase();
    if !lower.contains("bits/sec") && !lower.contains("bits per second") {
        return None;
    }
    parse_bitrate_number(text)
}

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

    if streaminfo.bits_per_sample > 0
        && streaminfo.num_channels > 0
        && streaminfo.sample_rate > 0
    {
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
                let bitrate = u64::from(bits_per_sample)
                    * u64::from(channels)
                    * u64::from(sample_rate);
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

    let Ok(data) = std::fs::read(path) else {
        return props;
    };

    let frame_offset = match find_mp3_frame_offset(&data) {
        Some(offset) => offset,
        None => return props,
    };
    let header_bytes: [u8; 4] = match data[frame_offset..frame_offset + 4].try_into() {
        Ok(bytes) => bytes,
        Err(_) => return props,
    };
    let header = u32::from_be_bytes(header_bytes);

    if header & 0xFFE0_0000 != 0xFFE0_0000 {
        return props;
    }

    let version = (header >> 19) & 0x3;
    let layer = (header >> 17) & 0x3;
    if layer != 0b01 {
        return props;
    }

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

    props
}

fn find_mp3_frame_offset(data: &[u8]) -> Option<usize> {
    let limit = data.len().saturating_sub(4);
    let mut offset = 0usize;
    while offset < limit {
        if data[offset] == 0xFF && (data[offset + 1] & 0xE0) == 0xE0 {
            return Some(offset);
        }
        offset += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hz_value_reads_sample_rate() {
        assert_eq!(
            parse_hz_value("2 ch,  44100 Hz, FLAC"),
            Some(44_100)
        );
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
    }

    #[test]
    fn parse_bitrate_number_reads_first_number() {
        assert_eq!(parse_bitrate_number("256000 bits/sec"), Some(256_000));
        assert_eq!(parse_bitrate_number("193239.6 bits per second"), Some(193_240));
    }

    #[cfg(target_os = "macos")]
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

        let channels: u16 = 2;
        let sample_rate: u32 = 48_000;
        let bits_per_sample: u16 = 16;
        let block_align = channels * (bits_per_sample / 8);
        let byte_rate = sample_rate * u32::from(block_align);
        let samples: [i16; 4] = [0, 0, 0, 0];
        let data_bytes = samples.len() * 2;

        let mut file = std::fs::File::create(&path).unwrap();
        use std::io::Write;
        file.write_all(b"RIFF").unwrap();
        file.write_all(&(36u32 + data_bytes as u32).to_le_bytes())
            .unwrap();
        file.write_all(b"WAVE").unwrap();
        file.write_all(b"fmt ").unwrap();
        file.write_all(&16u32.to_le_bytes()).unwrap();
        file.write_all(&1u16.to_le_bytes()).unwrap();
        file.write_all(&channels.to_le_bytes()).unwrap();
        file.write_all(&sample_rate.to_le_bytes()).unwrap();
        file.write_all(&byte_rate.to_le_bytes()).unwrap();
        file.write_all(&block_align.to_le_bytes()).unwrap();
        file.write_all(&bits_per_sample.to_le_bytes()).unwrap();
        file.write_all(b"data").unwrap();
        file.write_all(&(data_bytes as u32).to_le_bytes()).unwrap();
        for sample in samples {
            file.write_all(&sample.to_le_bytes()).unwrap();
        }

        let props = read_wav_properties(&path);
        assert_eq!(props.codec.as_deref(), Some("pcm"));
        assert_eq!(props.sample_rate, Some(48_000));
        assert_eq!(props.bitrate, Some(1_536_000));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
