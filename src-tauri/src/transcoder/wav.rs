use std::fs::File;
use std::io::Read;
use std::path::Path;

use super::error;
use super::pcm_stream::PcmStream;

const WAVE_FORMAT_PCM: u16 = 1;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

fn is_pcm_wave_format(audio_format: u16, fmt_body: &[u8]) -> bool {
    if audio_format == WAVE_FORMAT_PCM {
        return true;
    }

    if audio_format == WAVE_FORMAT_EXTENSIBLE && fmt_body.len() >= 28 {
        let subformat_tag = u32::from_le_bytes([
            fmt_body[24],
            fmt_body[25],
            fmt_body[26],
            fmt_body[27],
        ]);
        return subformat_tag == 1;
    }

    false
}

pub fn read_pcm_from_wav(path: &Path) -> Result<PcmStream, String> {
    let label = error::file_label(path);
    let mut file =
        File::open(path).map_err(|err| format!("Failed to open {label}: {err}"))?;
    let mut data = Vec::new();
    file.read_to_end(&mut data)
        .map_err(|err| error::format_wav_read_failure(path, &err.to_string()))?;

    if data.len() < 44 || &data[0..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return Err(error::format_wav_read_failure(path, "not a WAVE file"));
    }

    let mut offset = 12;
    let mut audio_format = None;
    let mut fmt_body = None;
    let mut channels = None;
    let mut sample_rate = None;
    let mut bits_per_sample = None;
    let mut data_offset = None;
    let mut data_size = None;

    while offset + 8 <= data.len() {
        let chunk_id = &data[offset..offset + 4];
        let chunk_size = u32::from_le_bytes([
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7],
        ]) as usize;
        offset += 8;

        if offset + chunk_size > data.len() {
            break;
        }

        if chunk_id == b"fmt " && chunk_size >= 16 {
            let body = &data[offset..offset + chunk_size];
            audio_format = Some(u16::from_le_bytes([body[0], body[1]]));
            fmt_body = Some(body);
            channels = Some(u16::from_le_bytes([body[2], body[3]]));
            sample_rate = Some(u32::from_le_bytes([body[4], body[5], body[6], body[7]]));
            bits_per_sample = Some(u16::from_le_bytes([body[14], body[15]]));
        } else if chunk_id == b"data" {
            data_offset = Some(offset);
            data_size = Some(chunk_size);
        }

        offset += chunk_size + (chunk_size % 2);
    }

    let audio_format = audio_format.ok_or_else(|| {
        error::format_wav_read_failure(path, "missing fmt chunk")
    })?;
    let fmt_body = fmt_body.ok_or_else(|| {
        error::format_wav_read_failure(path, "missing fmt chunk")
    })?;
    if !is_pcm_wave_format(audio_format, fmt_body) {
        return Err(error::format_wav_read_failure(
            path,
            "only PCM WAVE files are supported",
        ));
    }

    let channels = channels.ok_or_else(|| {
        error::format_wav_read_failure(path, "missing channel count")
    })?;
    let sample_rate = sample_rate.ok_or_else(|| {
        error::format_wav_read_failure(path, "missing sample rate")
    })?;
    let bits_per_sample = bits_per_sample.unwrap_or(16);
    if bits_per_sample != 16 {
        return Err(error::format_wav_read_failure(
            path,
            &format!("unsupported sample size: {bits_per_sample}-bit"),
        ));
    }

    let data_offset = data_offset.ok_or_else(|| {
        error::format_wav_read_failure(path, "missing data chunk")
    })?;
    let data_size = data_size.unwrap_or(0);
    if data_size == 0 || data_offset + data_size > data.len() {
        return Err(error::format_wav_read_failure(path, "empty audio data"));
    }

    let bytes = &data[data_offset..data_offset + data_size];
    let mut samples = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.chunks_exact(2) {
        samples.push(i16::from_le_bytes([chunk[0], chunk[1]]));
    }

    if samples.is_empty() {
        return Err(error::format_wav_read_failure(path, "no audio samples"));
    }

    Ok(PcmStream {
        channels,
        sample_rate,
        samples,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    use std::path::PathBuf;

    fn write_test_wav(dir: &Path, channels: u16, sample_rate: u32, samples: &[i16]) -> PathBuf {
        let path = dir.join("test.wav");
        let mut data = Vec::new();
        for sample in samples {
            data.extend_from_slice(&sample.to_le_bytes());
        }

        let block_align = channels * 2;
        let byte_rate = sample_rate * u32::from(block_align);
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(b"RIFF").unwrap();
        file.write_all(&(36u32 + data.len() as u32).to_le_bytes())
            .unwrap();
        file.write_all(b"WAVE").unwrap();
        file.write_all(b"fmt ").unwrap();
        file.write_all(&16u32.to_le_bytes()).unwrap();
        file.write_all(&1u16.to_le_bytes()).unwrap(); // PCM
        file.write_all(&channels.to_le_bytes()).unwrap();
        file.write_all(&sample_rate.to_le_bytes()).unwrap();
        file.write_all(&byte_rate.to_le_bytes()).unwrap();
        file.write_all(&block_align.to_le_bytes()).unwrap();
        file.write_all(&16u16.to_le_bytes()).unwrap();
        file.write_all(b"data").unwrap();
        file.write_all(&(data.len() as u32).to_le_bytes()).unwrap();
        file.write_all(&data).unwrap();
        path
    }

    fn write_extensible_test_wav(
        dir: &Path,
        channels: u16,
        sample_rate: u32,
        samples: &[i16],
    ) -> PathBuf {
        let path = dir.join("extensible.wav");
        let mut pcm = Vec::new();
        for sample in samples {
            pcm.extend_from_slice(&sample.to_le_bytes());
        }

        let block_align = channels * 2;
        let byte_rate = sample_rate * u32::from(block_align);
        let fmt_chunk_size = 40u32;
        let riff_size = 4 + (8 + fmt_chunk_size) + (8 + pcm.len() as u32);
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(b"RIFF").unwrap();
        file.write_all(&riff_size.to_le_bytes()).unwrap();
        file.write_all(b"WAVE").unwrap();
        file.write_all(b"fmt ").unwrap();
        file.write_all(&fmt_chunk_size.to_le_bytes()).unwrap();
        file.write_all(&WAVE_FORMAT_EXTENSIBLE.to_le_bytes()).unwrap();
        file.write_all(&channels.to_le_bytes()).unwrap();
        file.write_all(&sample_rate.to_le_bytes()).unwrap();
        file.write_all(&byte_rate.to_le_bytes()).unwrap();
        file.write_all(&block_align.to_le_bytes()).unwrap();
        file.write_all(&16u16.to_le_bytes()).unwrap();
        file.write_all(&22u16.to_le_bytes()).unwrap(); // cbSize
        file.write_all(&16u16.to_le_bytes()).unwrap(); // valid bits
        file.write_all(&3u32.to_le_bytes()).unwrap(); // stereo channel mask
        file.write_all(&1u32.to_le_bytes()).unwrap(); // PCM subformat tag
        file.write_all(&[0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71])
            .unwrap();
        file.write_all(b"data").unwrap();
        file.write_all(&(pcm.len() as u32).to_le_bytes()).unwrap();
        file.write_all(&pcm).unwrap();
        path
    }

    #[test]
    fn read_pcm_from_wav_parses_wave_format_extensible() {
        let dir = std::env::temp_dir().join(format!("spiral-wav-ext-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = write_extensible_test_wav(&dir, 2, 44_100, &[100, -100, 200, -200]);

        let pcm = read_pcm_from_wav(&path).expect("read extensible wav");
        assert_eq!(pcm.channels, 2);
        assert_eq!(pcm.sample_rate, 44_100);
        assert_eq!(pcm.samples, vec![100, -100, 200, -200]);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn read_pcm_from_wav_parses_afconvert_output() {
        use std::process::Command;

        let dir = std::env::temp_dir().join(format!("spiral-wav-afconvert-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = write_test_wav(&dir, 2, 44_100, &[1, 2, 3, 4]);
        let decoded = dir.join("decoded.wav");

        let status = Command::new("afconvert")
            .arg(&source)
            .arg(&decoded)
            .args(["-f", "WAVE", "-d", "LEI16", "-c", "2"])
            .status()
            .expect("run afconvert");
        assert!(status.success(), "afconvert should succeed");

        let pcm = read_pcm_from_wav(&decoded).expect("read afconvert wav");
        assert_eq!(pcm.channels, 2);
        assert_eq!(pcm.sample_rate, 44_100);
        assert!(!pcm.samples.is_empty());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn read_pcm_from_wav_parses_stereo_16_bit() {
        let dir = std::env::temp_dir().join(format!("spiral-wav-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = write_test_wav(&dir, 2, 44_100, &[100, -100, 200, -200]);

        let pcm = read_pcm_from_wav(&path).expect("read wav");
        assert_eq!(pcm.channels, 2);
        assert_eq!(pcm.sample_rate, 44_100);
        assert_eq!(pcm.samples, vec![100, -100, 200, -200]);

        let _ = std::fs::remove_dir_all(dir);
    }
}
