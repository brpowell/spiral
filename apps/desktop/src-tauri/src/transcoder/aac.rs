//! Encode interleaved PCM to AAC-LC `.m4a` via bundled `fdk-aac`.

use std::fs::File;
use std::io::Write;
use std::path::Path;

use fdk_aac::enc::{AudioObjectType, BitRate, ChannelMode, Encoder, EncoderParams, Transport};

use crate::encoding_profiles::EncodingProfile;

use super::error;
use super::pcm_stream::PcmStream;

const MVHD_TIMESCALE: u32 = 1000;
/// `apple-aac` profile target: 256 kbps AAC-LC.
const AAC_BITRATE: u32 = 256_000;

pub fn encode_pcm_to_aac_m4a(
    pcm: &PcmStream,
    dest: &Path,
    profile: &EncodingProfile,
) -> Result<(), String> {
    if profile.id != "apple-aac" {
        return Err(format!(
            "AAC encoder expects apple-aac profile (got {})",
            profile.id
        ));
    }
    if pcm.channels == 0 || pcm.channels > 2 {
        return Err("AAC encoding supports mono or stereo only".into());
    }
    if pcm.sample_rate == 0 {
        return Err("AAC encoding requires a valid sample rate".into());
    }
    if pcm.samples.is_empty() {
        return Err("AAC encoding requires audio samples".into());
    }
    if pcm.samples.len() % pcm.channels as usize != 0 {
        return Err(format!(
            "PCM sample count {} is not divisible by channel count {}",
            pcm.samples.len(),
            pcm.channels
        ));
    }

    let encoded = encode_aac_packets(pcm)?;
    let file =
        File::create(dest).map_err(|err| format!("Failed to create {}: {err}", dest.display()))?;
    write_aac_m4a(file, pcm, &encoded)
        .map_err(|err| format!("Failed to write {}: {err}", dest.display()))?;

    crate::itunes_smpb::write_itunes_smpb(
        dest,
        encoded.encoder_delay,
        encoded.padding_frames,
        u64::from(encoded.pcm_frames),
    )?;

    if !dest.is_file() {
        return Err(error::format_missing_output(dest));
    }

    Ok(())
}

struct AacPacket {
    data: Vec<u8>,
    sample_count: u32,
}

struct EncodedAac {
    /// MPEG-4 AudioSpecificConfig from FDK (`confBuf`).
    audio_specific_config: Vec<u8>,
    packets: Vec<AacPacket>,
    /// Original PCM frames (per channel), used for movie/media duration.
    pcm_frames: u32,
    /// FDK encoder delay (priming frames) for gapless `iTunSMPB`.
    encoder_delay: u32,
    /// Trailing padding frames advertised in `iTunSMPB`.
    padding_frames: u32,
}

fn encode_aac_packets(pcm: &PcmStream) -> Result<EncodedAac, String> {
    let channels = pcm.channels as usize;
    let pcm_frames = (pcm.samples.len() / channels) as u32;

    let channel_mode = match pcm.channels {
        1 => ChannelMode::Mono,
        2 => ChannelMode::Stereo,
        _ => unreachable!("channel count validated above"),
    };

    let encoder = Encoder::new(EncoderParams {
        bit_rate: BitRate::Cbr(AAC_BITRATE),
        sample_rate: pcm.sample_rate,
        transport: Transport::Raw,
        channels: channel_mode,
        audio_object_type: AudioObjectType::Mpeg4LowComplexity,
    })
    .map_err(|err| format!("Failed to initialize AAC encoder: {err}"))?;

    let info = encoder
        .info()
        .map_err(|err| format!("Failed to read AAC encoder info: {err}"))?;
    let frame_length = info.frameLength;
    if frame_length == 0 {
        return Err("AAC encoder reported zero frame length".into());
    }
    let conf_size = info.confSize as usize;
    if conf_size == 0 || conf_size > info.confBuf.len() {
        return Err("AAC encoder returned an invalid AudioSpecificConfig".into());
    }
    let audio_specific_config = info.confBuf[..conf_size].to_vec();
    let max_out = (info.maxOutBufBytes as usize).max(2048);
    let delay = info.nDelay as usize;

    // FDK buffers input; pad silence so delayed frames flush without a -1 EOF API.
    let mut samples = pcm.samples.clone();
    let pad_frames = delay + frame_length as usize;
    samples.extend(std::iter::repeat_n(0i16, pad_frames * channels));

    let mut packets = Vec::new();
    let mut offset = 0usize;
    let mut out_buf = vec![0u8; max_out];

    while offset < samples.len() {
        let encode_info = encoder
            .encode(&samples[offset..], &mut out_buf)
            .map_err(|err| format!("AAC encoding failed: {err}"))?;
        if encode_info.input_consumed == 0 && encode_info.output_size == 0 {
            break;
        }
        offset += encode_info.input_consumed;
        if encode_info.output_size > 0 {
            packets.push(AacPacket {
                data: out_buf[..encode_info.output_size].to_vec(),
                sample_count: frame_length,
            });
        }
    }

    // Keep enough packets for encoder delay + original PCM (drop only flush padding).
    let encoder_delay = delay as u32;
    let frames_needed = pcm_frames
        .saturating_add(encoder_delay)
        .div_ceil(frame_length)
        .max(1) as usize;
    if packets.len() < frames_needed {
        return Err(format!(
            "AAC encoder produced {} packets, need at least {frames_needed}",
            packets.len()
        ));
    }
    packets.truncate(frames_needed);

    let encoded_samples = (packets.len() as u32).saturating_mul(frame_length);
    let padding_frames = encoded_samples
        .saturating_sub(encoder_delay)
        .saturating_sub(pcm_frames);

    Ok(EncodedAac {
        audio_specific_config,
        packets,
        pcm_frames,
        encoder_delay,
        padding_frames,
    })
}

fn write_aac_m4a(mut file: File, pcm: &PcmStream, encoded: &EncodedAac) -> std::io::Result<()> {
    let duration_ms = ((encoded.pcm_frames as u64) * 1000 / pcm.sample_rate as u64) as u32;

    let mut mdat = Vec::new();
    for packet in &encoded.packets {
        mdat.extend_from_slice(&packet.data);
    }

    let ftyp = build_ftyp();
    let moov_probe = build_moov(pcm, encoded, duration_ms, 0);
    let mdat_offset = (ftyp.len() + moov_probe.len() + 8) as u32;
    let moov = build_moov(pcm, encoded, duration_ms, mdat_offset);

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
    encoded: &EncodedAac,
    duration_ms: u32,
    mdat_offset: u32,
) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend(build_mvhd(duration_ms));
    body.extend(build_trak(pcm, encoded, duration_ms, mdat_offset));
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
        0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x40, 0x00, 0x00, 0x00,
    ]);
    body.extend_from_slice(&[0; 24]);
    body.extend_from_slice(&2u32.to_be_bytes());
    wrap_box(b"mvhd", &body)
}

fn build_trak(
    pcm: &PcmStream,
    encoded: &EncodedAac,
    duration_ms: u32,
    mdat_offset: u32,
) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend(build_tkhd(duration_ms));
    body.extend(build_edts(duration_ms));
    body.extend(build_mdia(pcm, encoded, mdat_offset));
    wrap_box(b"trak", &body)
}

fn build_tkhd(duration_ms: u32) -> Vec<u8> {
    let mut body = vec![
        0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x32, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
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

fn build_mdia(pcm: &PcmStream, encoded: &EncodedAac, mdat_offset: u32) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend(build_mdhd(pcm.sample_rate, encoded.pcm_frames));
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
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(b"soun");
    body.extend_from_slice(&[0; 12]);
    body.extend_from_slice(b"SoundHandler");
    body.push(0);
    wrap_box(b"hdlr", &body)
}

fn build_minf(pcm: &PcmStream, encoded: &EncodedAac, mdat_offset: u32) -> Vec<u8> {
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

fn build_stbl(pcm: &PcmStream, encoded: &EncodedAac, mdat_offset: u32) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend(build_stsd(pcm, encoded));
    body.extend(build_stts(&encoded.packets));
    body.extend(build_stsc(encoded.packets.len() as u32));
    body.extend(build_stsz(&encoded.packets));
    body.extend(build_stco(mdat_offset));
    wrap_box(b"stbl", &body)
}

fn build_stsd(pcm: &PcmStream, encoded: &EncodedAac) -> Vec<u8> {
    let esds = build_esds(&encoded.audio_specific_config);

    let mut sample_entry = Vec::new();
    sample_entry.extend_from_slice(&[0; 6]);
    sample_entry.extend_from_slice(&1u16.to_be_bytes());
    sample_entry.extend_from_slice(&[0; 8]);
    sample_entry.extend_from_slice(&pcm.channels.to_be_bytes());
    sample_entry.extend_from_slice(&16u16.to_be_bytes());
    sample_entry.extend_from_slice(&[0; 4]);
    sample_entry.extend_from_slice(&(pcm.sample_rate << 16).to_be_bytes());
    sample_entry.extend(esds);

    let mut body = Vec::new();
    body.extend_from_slice(&[0; 4]);
    body.extend_from_slice(&1u32.to_be_bytes());
    let mut entry = Vec::new();
    entry.extend_from_slice(&(sample_entry.len() as u32 + 8).to_be_bytes());
    entry.extend_from_slice(b"mp4a");
    entry.extend(sample_entry);
    body.extend(entry);
    wrap_box(b"stsd", &body)
}

fn build_esds(audio_specific_config: &[u8]) -> Vec<u8> {
    let mut decoder_specific = Vec::new();
    decoder_specific.push(0x05); // DecoderSpecificInfo tag
    decoder_specific.extend(encode_descriptor_length(audio_specific_config.len()));
    decoder_specific.extend_from_slice(audio_specific_config);

    let mut decoder_config = Vec::new();
    decoder_config.push(0x04); // DecoderConfigDescriptor tag
    let mut decoder_config_body = Vec::new();
    decoder_config_body.push(0x40); // objectTypeIndication: Audio ISO/IEC 14496-3
    decoder_config_body.push(0x15); // streamType=AudioStream, upstream=0, reserved=1
    decoder_config_body.extend_from_slice(&[0x00, 0x00, 0x00]); // bufferSizeDB
    decoder_config_body.extend_from_slice(&AAC_BITRATE.to_be_bytes()); // maxBitrate
    decoder_config_body.extend_from_slice(&AAC_BITRATE.to_be_bytes()); // avgBitrate
    decoder_config_body.extend(decoder_specific);
    decoder_config.extend(encode_descriptor_length(decoder_config_body.len()));
    decoder_config.extend(decoder_config_body);

    let mut sl_config = Vec::new();
    sl_config.push(0x06); // SLConfigDescriptor tag
    sl_config.extend(encode_descriptor_length(1));
    sl_config.push(0x02); // predefined

    let mut es_body = Vec::new();
    es_body.extend_from_slice(&0u16.to_be_bytes()); // ES_ID
    es_body.push(0x00); // flags
    es_body.extend(decoder_config);
    es_body.extend(sl_config);

    let mut es_descriptor = Vec::new();
    es_descriptor.push(0x03); // ES_Descriptor tag
    es_descriptor.extend(encode_descriptor_length(es_body.len()));
    es_descriptor.extend(es_body);

    let mut body = Vec::new();
    body.extend_from_slice(&[0; 4]); // version + flags
    body.extend(es_descriptor);
    wrap_box(b"esds", &body)
}

fn encode_descriptor_length(len: usize) -> Vec<u8> {
    // ISO/IEC 14496-1 expandable length (up to 4 bytes).
    let mut out = Vec::new();
    let remaining = len;
    for shift in (0..4).rev() {
        let byte = ((remaining >> (7 * shift)) & 0x7F) as u8;
        if shift == 0 {
            out.push(byte);
        } else if byte != 0 || !out.is_empty() {
            out.push(byte | 0x80);
        }
    }
    if out.is_empty() {
        out.push(0);
    }
    out
}

fn build_stts(packets: &[AacPacket]) -> Vec<u8> {
    // Collapse identical sample deltas (all AAC frames share frame_length).
    let mut body = Vec::new();
    body.extend_from_slice(&[0; 4]);
    if packets.is_empty() {
        body.extend_from_slice(&0u32.to_be_bytes());
        return wrap_box(b"stts", &body);
    }
    body.extend_from_slice(&1u32.to_be_bytes());
    body.extend_from_slice(&(packets.len() as u32).to_be_bytes());
    body.extend_from_slice(&packets[0].sample_count.to_be_bytes());
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

fn build_stsz(packets: &[AacPacket]) -> Vec<u8> {
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

    use super::super::decode;

    fn silence_pcm(frames: usize) -> PcmStream {
        PcmStream {
            channels: 2,
            sample_rate: 44_100,
            samples: vec![0; frames * 2],
        }
    }

    fn sample_profile() -> EncodingProfile {
        *crate::encoding_profiles::profile_from_id("apple-aac").unwrap()
    }

    fn minimal_flac_fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac")
    }

    #[test]
    fn encode_silence_to_aac_m4a() {
        let dest =
            std::env::temp_dir().join(format!("spiral-aac-silence-{}.m4a", std::process::id()));
        let _ = std::fs::remove_file(&dest);

        encode_pcm_to_aac_m4a(&silence_pcm(44_100 / 5), &dest, &sample_profile())
            .expect("encode silence");

        assert!(dest.is_file());
        assert!(dest.metadata().unwrap().len() > 64);

        let smpb = crate::itunes_smpb::read_itunes_smpb(&dest).expect("iTunSMPB");
        assert!(smpb.delay_frames > 0);
        assert_eq!(smpb.original_frames, Some((44_100 / 5) as u64));

        let decoded = decode::pcm_from_audio_file(&dest).expect("decode aac m4a");
        assert_eq!(decoded.channels, 2);
        assert_eq!(decoded.sample_rate, 44_100);
        // Lossy: allow a little length slack from framing.
        assert!(decoded.samples.len() > 44_100 / 5);

        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn streaming_decoder_trims_aac_itunes_smpb() {
        let pcm_frames = 22_050u32;
        let mut samples = vec![0i16; pcm_frames as usize * 2];
        samples[0] = i16::MAX / 2;
        samples[1] = i16::MAX / 2;
        let pcm = PcmStream {
            channels: 2,
            sample_rate: 44_100,
            samples,
        };
        let dest =
            std::env::temp_dir().join(format!("spiral-gapless-aac-{}.m4a", std::process::id()));
        let _ = std::fs::remove_file(&dest);
        encode_pcm_to_aac_m4a(&pcm, &dest, &sample_profile()).expect("encode aac");

        let smpb = crate::itunes_smpb::read_itunes_smpb(&dest).expect("iTunSMPB written");
        assert!(smpb.delay_frames > 0, "FDK should report encoder delay");
        assert_eq!(smpb.original_frames, Some(u64::from(pcm_frames)));

        let mut source =
            crate::file_playback::decoder::StreamingDecoder::open(&dest).expect("open aac");
        assert!(
            (source.duration_seconds() - f64::from(pcm_frames) / 44_100.0).abs() < 0.05,
            "duration should match original PCM length"
        );
        let channels = u64::from(source.channels().max(1));
        let mut sample_count = 0u64;
        while source.next_sample().is_some() {
            sample_count += 1;
        }
        let emitted = sample_count / channels;
        assert_eq!(
            emitted,
            u64::from(pcm_frames),
            "AAC trim should emit exactly original frame count"
        );

        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn encode_flac_fixture_to_aac_m4a() {
        let source = minimal_flac_fixture();
        if !source.is_file() {
            return;
        }

        let pcm = decode::pcm_from_audio_file(&source).expect("decode fixture");
        let dest =
            std::env::temp_dir().join(format!("spiral-aac-fixture-{}.m4a", std::process::id()));
        let _ = std::fs::remove_file(&dest);

        encode_pcm_to_aac_m4a(&pcm, &dest, &sample_profile()).expect("encode fixture");
        assert!(dest.is_file());

        let roundtrip = decode::pcm_from_audio_file(&dest).expect("decode encoded aac");
        assert_eq!(roundtrip.channels, pcm.channels);
        assert_eq!(roundtrip.sample_rate, pcm.sample_rate);

        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn encode_descriptor_length_encodes_short_values() {
        assert_eq!(encode_descriptor_length(0), vec![0]);
        assert_eq!(encode_descriptor_length(5), vec![5]);
        assert_eq!(encode_descriptor_length(127), vec![127]);
        assert_eq!(encode_descriptor_length(128), vec![0x81, 0x00]);
    }
}
