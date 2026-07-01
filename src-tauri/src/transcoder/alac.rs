//! Encode 16-bit PCM to Apple Lossless (.m4a) using bundled `alac-encoder`.

use std::fs::File;
use std::io::Write;
use std::path::Path;

use alac_encoder::{AlacEncoder, FormatDescription};

use super::decode;
use super::error;
use super::pcm_stream::PcmStream;

const FRAMES_PER_PACKET: u32 = 4096;
const MVHD_TIMESCALE: u32 = 1000;

pub fn transcode_file_to_alac(source: &Path, dest: &Path) -> Result<(), String> {
    let pcm = decode::pcm_from_audio_file(source)?;
    encode_pcm_to_alac_m4a(&pcm, dest)
}

fn encode_pcm_to_alac_m4a(pcm: &PcmStream, dest: &Path) -> Result<(), String> {
    if pcm.channels == 0 || pcm.channels > 2 {
        return Err("Apple Lossless encoding supports mono or stereo only".into());
    }
    if pcm.sample_rate == 0 {
        return Err("Apple Lossless encoding requires a valid sample rate".into());
    }
    if pcm.samples.is_empty() {
        return Err("Apple Lossless encoding requires audio samples".into());
    }

    let packets = encode_alac_packets(pcm)?;
    let file = File::create(dest)
        .map_err(|err| format!("Failed to create {}: {err}", dest.display()))?;
    write_alac_m4a(file, pcm, &packets)
        .map_err(|err| format!("Failed to write {}: {err}", dest.display()))?;

    if !dest.is_file() {
        return Err(error::format_missing_output(dest));
    }

    Ok(())
}

struct AlacPacket {
    data: Vec<u8>,
    sample_count: u32,
}

struct EncodedAlac {
    magic_cookie: Vec<u8>,
    packets: Vec<AlacPacket>,
}

fn encode_alac_packets(pcm: &PcmStream) -> Result<EncodedAlac, String> {
    let input_format =
        FormatDescription::pcm::<i16>(pcm.sample_rate as f64, pcm.channels as u32);
    let output_format = FormatDescription::alac(
        pcm.sample_rate as f64,
        FRAMES_PER_PACKET,
        pcm.channels as u32,
    );
    let mut encoder = AlacEncoder::new(&output_format);
    let magic_cookie = encoder.magic_cookie();

    let bytes_per_frame = pcm.channels as usize * 2;
    let frame_bytes = FRAMES_PER_PACKET as usize * bytes_per_frame;
    let pcm_bytes = pcm_samples_to_bytes(&pcm.samples);
    let mut output_buf = vec![0u8; output_format.max_packet_size()];
    let mut packets = Vec::new();

    for chunk in pcm_bytes.chunks(frame_bytes) {
        let sample_count = (chunk.len() / bytes_per_frame) as u32;
        if sample_count == 0 {
            continue;
        }

        let size = encoder.encode(&input_format, chunk, &mut output_buf);
        if size == 0 {
            return Err("ALAC encoder returned an empty packet".into());
        }

        packets.push(AlacPacket {
            data: output_buf[..size].to_vec(),
            sample_count,
        });
    }

    if packets.is_empty() {
        return Err("ALAC encoder produced no packets".into());
    }

    Ok(EncodedAlac {
        magic_cookie,
        packets,
    })
}

fn pcm_samples_to_bytes(samples: &[i16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn write_alac_m4a(
    mut file: File,
    pcm: &PcmStream,
    encoded: &EncodedAlac,
) -> std::io::Result<()> {
    let total_samples: u32 = encoded
        .packets
        .iter()
        .map(|packet| packet.sample_count)
        .sum();
    let duration_ms = ((total_samples as u64) * 1000 / pcm.sample_rate as u64) as u32;

    let mut mdat = Vec::new();
    for packet in &encoded.packets {
        mdat.extend_from_slice(&packet.data);
    }

    let ftyp = build_ftyp();
    let moov_probe = build_moov(pcm, encoded, total_samples, duration_ms, 0);
    let mdat_offset = (ftyp.len() + moov_probe.len() + 8) as u32;
    let moov = build_moov(pcm, encoded, total_samples, duration_ms, mdat_offset);

    file.write_all(&ftyp)?;
    file.write_all(&moov)?;
    file.write_all(&build_mdat_atom(&mdat))?;
    Ok(())
}

fn build_ftyp() -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(b"M4A ");
    body.extend_from_slice(&0x0000_0200u32.to_be_bytes());
    body.extend_from_slice(b"M4A ");
    body.extend_from_slice(b"isom");
    body.extend_from_slice(b"iso2");
    wrap_box(b"ftyp", &body)
}

fn build_mdat_atom(data: &[u8]) -> Vec<u8> {
    wrap_box(b"mdat", data)
}

fn build_moov(
    pcm: &PcmStream,
    encoded: &EncodedAlac,
    total_samples: u32,
    duration_ms: u32,
    mdat_offset: u32,
) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend(build_mvhd(duration_ms));
    body.extend(build_trak(
        pcm,
        encoded,
        total_samples,
        duration_ms,
        mdat_offset,
    ));
    wrap_box(b"moov", &body)
}

fn build_mvhd(duration_ms: u32) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&MVHD_TIMESCALE.to_be_bytes());
    body.extend_from_slice(&duration_ms.to_be_bytes());
    body.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    body.extend_from_slice(&0x0100u16.to_be_bytes());
    body.extend_from_slice(&[0; 2]);
    body.extend_from_slice(&[0; 8]);
    body.extend_from_slice(&[
        0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00,
    ]);
    body.extend_from_slice(&[0; 24]);
    body.extend_from_slice(&2u32.to_be_bytes());
    wrap_box(b"mvhd", &body)
}

fn build_trak(
    pcm: &PcmStream,
    encoded: &EncodedAlac,
    total_samples: u32,
    duration_ms: u32,
    mdat_offset: u32,
) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend(build_tkhd(duration_ms));
    body.extend(build_edts(duration_ms));
    body.extend(build_mdia(pcm, encoded, total_samples, mdat_offset));
    wrap_box(b"trak", &body)
}

fn build_tkhd(duration_ms: u32) -> Vec<u8> {
    let mut body = vec![
        0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x32, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ];
    body[20..24].copy_from_slice(&duration_ms.to_be_bytes());
    wrap_box(b"tkhd", &body)
}

fn build_edts(duration_ms: u32) -> Vec<u8> {
    let mut elst_body = Vec::new();
    elst_body.extend_from_slice(&[0; 4]);
    elst_body.extend_from_slice(&1u32.to_be_bytes());
    elst_body.extend_from_slice(&duration_ms.to_be_bytes());
    elst_body.extend_from_slice(&[0; 4]);
    elst_body.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    let elst = wrap_box(b"elst", &elst_body);
    wrap_box(b"edts", &elst)
}

fn build_mdia(
    pcm: &PcmStream,
    encoded: &EncodedAlac,
    total_samples: u32,
    mdat_offset: u32,
) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend(build_mdhd(pcm.sample_rate, total_samples));
    body.extend(build_hdlr());
    body.extend(build_minf(pcm, encoded, mdat_offset));
    wrap_box(b"mdia", &body)
}

fn build_mdhd(timescale: u32, duration: u32) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&timescale.to_be_bytes());
    body.extend_from_slice(&duration.to_be_bytes());
    body.extend_from_slice(&0x55C4u16.to_be_bytes());
    body.extend_from_slice(&[0; 2]);
    wrap_box(b"mdhd", &body)
}

fn build_hdlr() -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&[0; 4]); // version + flags
    body.extend_from_slice(&[0; 4]); // pre_defined
    body.extend_from_slice(b"soun");
    body.extend_from_slice(&[0; 12]); // reserved
    body.extend_from_slice(b"SoundHandler");
    body.push(0);
    wrap_box(b"hdlr", &body)
}

fn build_minf(pcm: &PcmStream, encoded: &EncodedAlac, mdat_offset: u32) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend(build_smhd());
    body.extend(build_dinf());
    body.extend(build_stbl(pcm, encoded, mdat_offset));
    wrap_box(b"minf", &body)
}

fn build_smhd() -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&[0; 4]);
    wrap_box(b"smhd", &body)
}

fn build_dinf() -> Vec<u8> {
    let mut dref_body = Vec::new();
    dref_body.extend_from_slice(&[0; 4]);
    dref_body.extend_from_slice(&1u32.to_be_bytes());
    let mut url_body = Vec::new();
    url_body.extend_from_slice(&0x0000_0001u32.to_be_bytes());
    dref_body.extend(wrap_box(b"url ", &url_body));
    let dref = wrap_box(b"dref", &dref_body);
    wrap_box(b"dinf", &dref)
}

fn build_stbl(pcm: &PcmStream, encoded: &EncodedAlac, mdat_offset: u32) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend(build_stsd(pcm, &encoded.magic_cookie));
    body.extend(build_stts(&encoded.packets));
    body.extend(build_stsc(encoded.packets.len() as u32));
    body.extend(build_stsz(&encoded.packets));
    body.extend(build_stco(mdat_offset));
    wrap_box(b"stbl", &body)
}

fn build_stsd(pcm: &PcmStream, magic_cookie: &[u8]) -> Vec<u8> {
    let mut alac_config = Vec::new();
    alac_config.extend_from_slice(&(magic_cookie.len() as u32 + 12).to_be_bytes());
    alac_config.extend_from_slice(b"alac");
    alac_config.extend_from_slice(&[0; 4]);
    alac_config.extend_from_slice(magic_cookie);

    let mut sample_entry = Vec::new();
    sample_entry.extend_from_slice(&[0; 6]);
    sample_entry.extend_from_slice(&1u16.to_be_bytes());
    sample_entry.extend_from_slice(&[0; 8]);
    sample_entry.extend_from_slice(&pcm.channels.to_be_bytes());
    sample_entry.extend_from_slice(&16u16.to_be_bytes());
    sample_entry.extend_from_slice(&[0; 4]);
    sample_entry.extend_from_slice(&(pcm.sample_rate << 16).to_be_bytes());
    sample_entry.extend(alac_config);

    let mut body = Vec::new();
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&1u32.to_be_bytes());
    let mut entry = Vec::new();
    entry.extend_from_slice(&(sample_entry.len() as u32 + 8).to_be_bytes());
    entry.extend_from_slice(b"alac");
    entry.extend(sample_entry);
    body.extend(entry);
    wrap_box(b"stsd", &body)
}

fn build_stts(packets: &[AlacPacket]) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&(packets.len() as u32).to_be_bytes());
    for packet in packets {
        body.extend_from_slice(&1u32.to_be_bytes());
        body.extend_from_slice(&packet.sample_count.to_be_bytes());
    }
    wrap_box(b"stts", &body)
}

fn build_stsc(sample_count: u32) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&1u32.to_be_bytes());
    body.extend_from_slice(&1u32.to_be_bytes());
    body.extend_from_slice(&sample_count.to_be_bytes());
    body.extend_from_slice(&1u32.to_be_bytes());
    wrap_box(b"stsc", &body)
}

fn build_stsz(packets: &[AlacPacket]) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&(packets.len() as u32).to_be_bytes());
    for packet in packets {
        body.extend_from_slice(&(packet.data.len() as u32).to_be_bytes());
    }
    wrap_box(b"stsz", &body)
}

fn build_stco(chunk_offset: u32) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&1u32.to_be_bytes());
    body.extend_from_slice(&chunk_offset.to_be_bytes());
    wrap_box(b"stco", &body)
}

fn wrap_box(fourcc: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut atom = Vec::with_capacity(8 + body.len());
    atom.extend_from_slice(&((8 + body.len()) as u32).to_be_bytes());
    atom.extend_from_slice(fourcc);
    atom.extend_from_slice(body);
    atom
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn minimal_flac_fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac")
    }

    #[test]
    fn encode_pcm_fixture_to_alac_m4a() {
        let source = minimal_flac_fixture();
        if !source.is_file() {
            return;
        }

        let pcm = decode::pcm_from_audio_file(&source).expect("decode fixture");
        let dest = std::env::temp_dir().join(format!(
            "spiral-alac-encode-{}.m4a",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&dest);

        encode_pcm_to_alac_m4a(&pcm, &dest).expect("encode fixture");

        assert!(dest.is_file());
        assert!(dest.metadata().unwrap().len() > 64);

        let roundtrip = decode::pcm_from_audio_file(&dest).expect("decode encoded alac");
        assert_eq!(roundtrip.channels, pcm.channels);
        assert_eq!(roundtrip.sample_rate, pcm.sample_rate);
        assert_eq!(roundtrip.samples.len(), pcm.samples.len());

        #[cfg(target_os = "macos")]
        {
            use std::process::Command;
            let output = Command::new("afinfo").arg(&dest).output().expect("run afinfo");
            assert!(
                output.status.success(),
                "afinfo failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            let stdout = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
            assert!(stdout.contains("alac"), "output should be ALAC: {stdout}");
        }

        let _ = std::fs::remove_file(&dest);
    }
}