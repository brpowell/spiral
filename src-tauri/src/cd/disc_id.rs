//! MusicBrainz / freedb disc ID from a CD TOC.

const LEAD_IN_SECTORS: u32 = 150;

/// Frame offsets for MusicBrainz disc ID hashing.
/// Index 0 is lead-out; indices 1..=track_count are track start offsets.
fn frame_offsets(tracks: &[(u32, f64)]) -> Option<[u32; 100]> {
    if tracks.is_empty() || tracks.len() > 99 {
        return None;
    }

    let mut offsets = [0u32; 100];
    let mut offset = LEAD_IN_SECTORS;

    for (index, (_, duration_seconds)) in tracks.iter().enumerate() {
        offsets[index + 1] = offset;
        offset += duration_to_sectors(*duration_seconds);
    }
    offsets[0] = offset;
    Some(offsets)
}

/// Build the TOC vector for MusicBrainz `discid/-?toc=…` lookups.
/// Format: `[first, last, lead_out, track1_start, track2_start, …]`.
pub fn build_toc(tracks: &[(u32, f64)]) -> Vec<u32> {
    let Some(offsets) = frame_offsets(tracks) else {
        return Vec::new();
    };

    let track_count = tracks.len() as u32;
    let mut toc = Vec::with_capacity(3 + tracks.len());
    toc.push(1);
    toc.push(track_count);
    toc.push(offsets[0]);
    toc.extend_from_slice(&offsets[1..=tracks.len()]);
    toc
}

/// Plus-separated TOC string for MusicBrainz `discid/-?toc=…` lookups.
pub fn toc_query_string(tracks: &[(u32, f64)]) -> String {
    build_toc(tracks)
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("+")
}

/// MusicBrainz disc ID checksum from track durations.
pub fn compute_disc_id(tracks: &[(u32, f64)]) -> String {
    let Some(offsets) = frame_offsets(tracks) else {
        return String::new();
    };

    let mut message = String::with_capacity(804);
    message.push_str(&format!("{:02X}", 1u8));
    message.push_str(&format!("{:02X}", tracks.len() as u8));
    for offset in offsets {
        message.push_str(&format!("{offset:08X}"));
    }

    use sha1::{Digest, Sha1};
    let digest = Sha1::digest(message.as_bytes());
    base64_disc_id(&digest)
}

fn duration_to_sectors(duration_seconds: f64) -> u32 {
    (duration_seconds * 75.0).round().max(0.0) as u32
}

fn base64_disc_id(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    STANDARD
        .encode(bytes)
        .replace('+', ".")
        .replace('/', "_")
        .replace('=', "-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toc_uses_musicbrainz_api_format() {
        let toc = build_toc(&[(1, 180.0), (2, 200.0)]);
        assert_eq!(toc, vec![1, 2, 28650, 150, 13650]);
        assert_eq!(
            toc_query_string(&[(1, 180.0), (2, 200.0)]),
            "1+2+28650+150+13650"
        );
    }

    #[test]
    fn disc_id_is_stable_for_same_toc() {
        let tracks = [(1, 180.0), (2, 200.0)];
        assert_eq!(compute_disc_id(&tracks), compute_disc_id(&tracks));
        assert!(!compute_disc_id(&tracks).is_empty());
    }

    #[test]
    fn disc_id_matches_musicbrainz_reference_example() {
        // Offsets from https://musicbrainz.org/doc/Disc_ID_Calculation
        let tracks = [
            (1, 15213.0 / 75.0),
            (2, 16951.0 / 75.0),
            (3, 14278.0 / 75.0),
            (4, 16822.0 / 75.0),
            (5, 17075.0 / 75.0),
            (6, 14973.0 / 75.0),
        ];
        assert_eq!(compute_disc_id(&tracks), "49HHV7Eb8UKF3aQiNmu1GR8vKTY-");
    }
}
