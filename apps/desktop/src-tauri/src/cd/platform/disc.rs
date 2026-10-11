//! Shared helpers for building `CdDisc` from a TOC track list.

use std::collections::HashMap;

use crate::cd::disc_id;
use crate::cd::types::{CdDisc, CdTrack};

/// Build a `CdDisc` from TOC durations and optional CD-Text titles.
pub fn build_disc_from_tracks(
    drive_id: &str,
    toc_tracks: &[(u32, f64)],
    album: Option<String>,
    artist: Option<String>,
    cdtext_titles: &HashMap<u32, String>,
) -> CdDisc {
    let mut tracks = Vec::new();
    for (number, duration_seconds) in toc_tracks {
        let title = cdtext_titles
            .get(number)
            .cloned()
            .unwrap_or_else(|| format!("Track {number}"));
        tracks.push(CdTrack {
            number: *number,
            title,
            artist: artist.clone(),
            duration_seconds: Some(*duration_seconds),
        });
    }
    tracks.sort_by_key(|track| track.number);
    let disc_id = if toc_tracks.is_empty() {
        None
    } else {
        Some(disc_id::compute_disc_id(toc_tracks))
    };
    CdDisc {
        drive_id: drive_id.to_string(),
        disc_id,
        album,
        artist,
        tracks,
    }
}
