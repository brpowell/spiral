//! Gapless priming metadata (iTunSMPB) for AAC/M4A decode-time trim.

use std::path::Path;

use mp4ameta::ident::{FreeformIdent, FreeformIdentStatic, APPLE_ITUNES_MEAN};
use mp4ameta::{Data, Tag as Mp4Tag};

const ITUNES_SMPB: FreeformIdentStatic = FreeformIdent::new_static(APPLE_ITUNES_MEAN, "iTunSMPB");

/// Encoder delay / padding / original length from an iTunes `iTunSMPB` tag.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ItunesSmpb {
    /// Leading priming frames (per channel) to discard.
    pub delay_frames: u32,
    /// Trailing padding frames (per channel) after the original audio.
    pub padding_frames: u32,
    /// Original PCM frame count (per channel), when present and non-zero.
    pub original_frames: Option<u64>,
}

/// Parse the space-separated hex payload of an `iTunSMPB` value.
///
/// Layout: `unused delay padding original …` (fields 1–3 are what we use).
pub fn parse_itunes_smpb(value: &str) -> Option<ItunesSmpb> {
    let fields: Vec<&str> = value.split_whitespace().collect();
    if fields.len() < 3 {
        return None;
    }
    let delay_frames = u32::from_str_radix(fields[1], 16).ok()?;
    let padding_frames = u32::from_str_radix(fields[2], 16).ok()?;
    let original_frames = fields
        .get(3)
        .and_then(|field| u64::from_str_radix(field, 16).ok())
        .filter(|frames| *frames > 0);

    if delay_frames == 0 && padding_frames == 0 && original_frames.is_none() {
        return None;
    }

    Some(ItunesSmpb {
        delay_frames,
        padding_frames,
        original_frames,
    })
}

/// Format an `iTunSMPB` string (leading space matches common encoder output).
pub fn format_itunes_smpb(delay_frames: u32, padding_frames: u32, original_frames: u64) -> String {
    format!(
        " 00000000 {:08X} {:08X} {:016X} 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000",
        delay_frames, padding_frames, original_frames
    )
}

/// Read `iTunSMPB` from an M4A/MP4 path via mp4ameta freeform atoms.
pub fn read_itunes_smpb(path: &Path) -> Option<ItunesSmpb> {
    let tag = Mp4Tag::read_from_path(path).ok()?;
    let value = tag
        .data_of(&ITUNES_SMPB)
        .next()
        .and_then(|data| data.string())?;
    parse_itunes_smpb(value)
}

/// Write (or replace) `iTunSMPB` on an M4A/MP4 path.
pub fn write_itunes_smpb(
    path: &Path,
    delay_frames: u32,
    padding_frames: u32,
    original_frames: u64,
) -> Result<(), String> {
    let mut tag = Mp4Tag::read_from_path(path)
        .map_err(|err| format!("Failed to read M4A tags for iTunSMPB: {err}"))?;
    tag.set_data(
        ITUNES_SMPB,
        Data::Utf8(format_itunes_smpb(
            delay_frames,
            padding_frames,
            original_frames,
        )),
    );
    tag.write_to_path(path)
        .map_err(|err| format!("Failed to write iTunSMPB: {err}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_itunes_smpb_reads_delay_padding_and_original() {
        let parsed = parse_itunes_smpb(
            " 00000000 00000840 000001CA 00000000003F31F6 00000000 00000000 00000000 00000000",
        )
        .expect("parse");
        assert_eq!(parsed.delay_frames, 2112);
        assert_eq!(parsed.padding_frames, 458);
        assert_eq!(parsed.original_frames, Some(0x003F_31F6));
    }

    #[test]
    fn format_round_trips_through_parse() {
        let formatted = format_itunes_smpb(1600, 128, 44_100);
        let parsed = parse_itunes_smpb(&formatted).expect("parse");
        assert_eq!(parsed.delay_frames, 1600);
        assert_eq!(parsed.padding_frames, 128);
        assert_eq!(parsed.original_frames, Some(44_100));
    }
}
