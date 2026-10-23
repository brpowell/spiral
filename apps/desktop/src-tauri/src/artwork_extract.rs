use crate::artwork_paths::{
    album_artwork_dir, ensure_inside_album_artwork, ext_from_mime_or_bytes, find_front_image,
    override_art_filename, to_library_relative, FRONT_STEM,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct TrackArtSource {
    pub track_id: Option<i64>,
    pub title: String,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    /// Raw image bytes when known (embed or cache file contents).
    pub bytes: Option<Vec<u8>>,
    pub mime: String,
}

#[derive(Debug, Clone)]
pub struct TrackArtAssignment {
    /// Library-relative override path, or None when using album front.jpg.
    pub art_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteMode {
    /// Import / add: never overwrite existing files whose bytes differ.
    NoClobber,
    /// Refresh / full reconstruct: replace folder contents to match embeds.
    Reconstruct,
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn track_sort_key(t: &TrackArtSource) -> (i32, i32, String) {
    (
        t.disc_number.unwrap_or(1),
        t.track_number.unwrap_or(i32::MAX),
        t.title.to_ascii_lowercase(),
    )
}

/// Choose canonical SHA: largest group; ties → lowest disc/track/title among members.
fn pick_canonical_sha(
    groups: &HashMap<String, Vec<usize>>,
    tracks: &[TrackArtSource],
) -> Option<String> {
    let mut best: Option<(usize, (i32, i32, String), String)> = None;
    for (sha, indices) in groups {
        let count = indices.len();
        let min_key = indices
            .iter()
            .map(|&i| track_sort_key(&tracks[i]))
            .min()
            .unwrap_or((i32::MAX, i32::MAX, String::new()));
        let candidate = (count, min_key, sha.clone());
        match &best {
            None => best = Some(candidate),
            Some(current) => {
                // Prefer higher count; on equal count prefer smaller sort key.
                if candidate.0 > current.0 || (candidate.0 == current.0 && candidate.1 < current.1)
                {
                    best = Some(candidate);
                }
            }
        }
    }
    best.map(|(_, _, sha)| sha)
}

fn write_bytes_if_allowed(dest: &Path, bytes: &[u8], mode: WriteMode) -> Result<bool, String> {
    if dest.is_file() {
        let existing =
            fs::read(dest).map_err(|e| format!("failed to read {}: {e}", dest.display()))?;
        if existing == bytes {
            return Ok(false);
        }
        if mode == WriteMode::NoClobber {
            return Ok(false);
        }
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    fs::write(dest, bytes).map_err(|e| format!("failed to write {}: {e}", dest.display()))?;
    Ok(true)
}

/// Extract unique art for an album into `Artwork/albums/{artist}/{album}/`.
///
/// Returns per-track assignments (`None` art_path = use front.jpg).
pub fn write_album_unique_art(
    library_root: &Path,
    album_artist: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    tracks: &[TrackArtSource],
    mode: WriteMode,
) -> Result<Vec<TrackArtAssignment>, String> {
    let album_dir = album_artwork_dir(library_root, album_artist, artist, album);
    ensure_inside_album_artwork(library_root, &album_dir)?;
    fs::create_dir_all(&album_dir)
        .map_err(|e| format!("failed to create album artwork dir: {e}"))?;

    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
    let mut sha_bytes: HashMap<String, (Vec<u8>, String)> = HashMap::new();

    for (i, track) in tracks.iter().enumerate() {
        let Some(bytes) = track.bytes.as_ref() else {
            continue;
        };
        if bytes.is_empty() {
            continue;
        }
        let sha = sha256_hex(bytes);
        groups.entry(sha.clone()).or_default().push(i);
        sha_bytes
            .entry(sha)
            .or_insert_with(|| (bytes.clone(), track.mime.clone()));
    }

    let mut assignments: Vec<TrackArtAssignment> = tracks
        .iter()
        .map(|_| TrackArtAssignment { art_path: None })
        .collect();

    if groups.is_empty() {
        if mode == WriteMode::Reconstruct {
            prune_album_dir_except(library_root, &album_dir, &[])?;
        }
        return Ok(assignments);
    }

    let canonical_sha = pick_canonical_sha(&groups, tracks)
        .ok_or_else(|| "failed to pick canonical album art".to_string())?;

    let (canon_bytes, canon_mime) = sha_bytes
        .get(&canonical_sha)
        .ok_or_else(|| "missing canonical art bytes".to_string())?;
    let canon_ext = ext_from_mime_or_bytes(canon_mime, canon_bytes);
    let front_path = album_dir.join(format!("{FRONT_STEM}.{canon_ext}"));

    // Remove other front.* extensions when reconstructing.
    if mode == WriteMode::Reconstruct {
        if let Some(existing) = find_front_image(&album_dir) {
            if existing != front_path {
                let _ = fs::remove_file(&existing);
            }
        }
    }

    write_bytes_if_allowed(&front_path, canon_bytes, mode)?;

    let front_rel = to_library_relative(library_root, &front_path)
        .unwrap_or_else(|| format!("Artwork/albums/.../{FRONT_STEM}.{canon_ext}"));

    let mut kept_files: Vec<PathBuf> = vec![front_path.clone()];
    let mut sha_to_rel: HashMap<String, Option<String>> = HashMap::new();
    sha_to_rel.insert(canonical_sha.clone(), None);

    for (sha, indices) in &groups {
        if sha == &canonical_sha {
            continue;
        }
        let Some((bytes, mime)) = sha_bytes.get(sha) else {
            continue;
        };
        let ext = ext_from_mime_or_bytes(mime, bytes);
        // Name from first track in disc/track order.
        let naming_idx = indices
            .iter()
            .copied()
            .min_by_key(|&i| track_sort_key(&tracks[i]))
            .unwrap_or(indices[0]);
        let t = &tracks[naming_idx];
        let filename = override_art_filename(t.track_number, &t.title, FRONT_STEM, ext);
        let dest = album_dir.join(&filename);

        if mode == WriteMode::NoClobber && dest.is_file() {
            let existing = fs::read(&dest).unwrap_or_default();
            if existing != *bytes {
                // Drop-in / different file: still point tracks at whatever file we find
                // with matching bytes, or write under a collision-safe name.
                let alt =
                    find_or_write_bytes_as_override(&album_dir, library_root, bytes, &filename)?;
                sha_to_rel.insert(sha.clone(), Some(alt.0));
                kept_files.push(alt.1);
                continue;
            }
        }

        write_bytes_if_allowed(&dest, bytes, mode)?;
        let rel = to_library_relative(library_root, &dest).unwrap_or(filename);
        sha_to_rel.insert(sha.clone(), Some(rel));
        kept_files.push(dest);
    }

    for (i, track) in tracks.iter().enumerate() {
        let Some(bytes) = track.bytes.as_ref() else {
            assignments[i].art_path = None;
            continue;
        };
        if bytes.is_empty() {
            assignments[i].art_path = None;
            continue;
        }
        let sha = sha256_hex(bytes);
        assignments[i].art_path = sha_to_rel.get(&sha).cloned().flatten();
    }

    if mode == WriteMode::Reconstruct {
        prune_album_dir_except(library_root, &album_dir, &kept_files)?;
    }

    let _ = front_rel; // used for documentation; assignments use None for canonical
    Ok(assignments)
}

fn find_or_write_bytes_as_override(
    album_dir: &Path,
    library_root: &Path,
    bytes: &[u8],
    preferred_name: &str,
) -> Result<(String, PathBuf), String> {
    if let Ok(entries) = fs::read_dir(album_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if fs::read(&path).ok().as_deref() == Some(bytes) {
                let rel = to_library_relative(library_root, &path)
                    .unwrap_or_else(|| path.file_name().unwrap().to_string_lossy().into_owned());
                return Ok((rel, path));
            }
        }
    }
    let dest = album_dir.join(preferred_name);
    if dest.is_file() {
        // Collision: append short hash.
        let short = &sha256_hex(bytes)[..8];
        let stem = Path::new(preferred_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("override");
        let ext = Path::new(preferred_name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("jpg");
        let alt = album_dir.join(format!("{stem}-{short}.{ext}"));
        fs::write(&alt, bytes).map_err(|e| e.to_string())?;
        let rel = to_library_relative(library_root, &alt).unwrap_or_default();
        return Ok((rel, alt));
    }
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    let rel = to_library_relative(library_root, &dest).unwrap_or(preferred_name.to_string());
    Ok((rel, dest))
}

fn prune_album_dir_except(
    library_root: &Path,
    album_dir: &Path,
    keep: &[PathBuf],
) -> Result<(), String> {
    ensure_inside_album_artwork(library_root, album_dir)?;
    if !album_dir.is_dir() {
        return Ok(());
    }
    let keep_set: std::collections::HashSet<_> = keep.iter().collect();
    for entry in fs::read_dir(album_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() && !keep_set.contains(&path) {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

/// When importing a single track into an album that may already have art.
pub fn assign_track_art_on_import(
    library_root: &Path,
    album_artist: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    title: &str,
    track_number: Option<i32>,
    bytes: Option<&[u8]>,
    mime: &str,
) -> Result<Option<String>, String> {
    let Some(bytes) = bytes.filter(|b| !b.is_empty()) else {
        return Ok(None);
    };

    let album_dir = album_artwork_dir(library_root, album_artist, artist, album);
    ensure_inside_album_artwork(library_root, &album_dir)?;
    fs::create_dir_all(&album_dir)
        .map_err(|e| format!("failed to create album artwork dir: {e}"))?;

    let sha = sha256_hex(bytes);
    let ext = ext_from_mime_or_bytes(mime, bytes);

    if let Some(front) = find_front_image(&album_dir) {
        let front_bytes = fs::read(&front).unwrap_or_default();
        if sha256_hex(&front_bytes) == sha {
            return Ok(None);
        }
        // Check existing overrides for matching bytes.
        if let Ok(entries) = fs::read_dir(&album_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path == front || !path.is_file() {
                    continue;
                }
                if fs::read(&path).ok().as_deref() == Some(bytes) {
                    return Ok(to_library_relative(library_root, &path));
                }
            }
        }
        let filename = override_art_filename(track_number, title, FRONT_STEM, ext);
        let dest = album_dir.join(&filename);
        write_bytes_if_allowed(&dest, bytes, WriteMode::NoClobber)?;
        // If no-clobber skipped write but file differs, still try collision name.
        if dest.is_file() {
            let existing = fs::read(&dest).unwrap_or_default();
            if existing == bytes {
                return Ok(to_library_relative(library_root, &dest));
            }
            let (rel, _) =
                find_or_write_bytes_as_override(&album_dir, library_root, bytes, &filename)?;
            return Ok(Some(rel));
        }
        return Ok(to_library_relative(library_root, &dest));
    }

    // No front yet — write as front (first art wins for empty folder; refresh
    // will recompute majority later).
    let front_path = album_dir.join(format!("{FRONT_STEM}.{ext}"));
    write_bytes_if_allowed(&front_path, bytes, WriteMode::NoClobber)?;
    Ok(None)
}

/// Rebuild `Artwork/albums/` from embedded pictures for every album in the library.
pub fn reconstruct_all_album_artwork(
    conn: &rusqlite::Connection,
    library_root: &Path,
) -> Result<(), String> {
    use crate::db;
    use std::collections::HashMap;

    let tracks = db::get_all_tracks(conn).map_err(|e| e.to_string())?;
    let mut groups: HashMap<(String, String), Vec<crate::models::Track>> = HashMap::new();
    for track in tracks {
        let album = track
            .album
            .clone()
            .unwrap_or_else(|| "Unknown Album".into());
        let album_artist = track
            .album_artist
            .clone()
            .or_else(|| track.artist.clone())
            .unwrap_or_else(|| "Unknown Artist".into());
        groups.entry((album_artist, album)).or_default().push(track);
    }

    for ((album_artist, album), album_tracks) in groups {
        let sources: Vec<TrackArtSource> = album_tracks
            .iter()
            .map(|t| {
                let art = extract_embedded_art_bytes(Path::new(&t.file_path));
                TrackArtSource {
                    track_id: Some(t.id),
                    title: t.title.clone(),
                    track_number: t.track_number,
                    disc_number: t.disc_number,
                    bytes: art.as_ref().map(|(b, _)| b.clone()),
                    mime: art
                        .as_ref()
                        .map(|(_, m)| m.clone())
                        .unwrap_or_else(|| "image/jpeg".into()),
                }
            })
            .collect();

        let assignments = write_album_unique_art(
            library_root,
            Some(&album_artist),
            None,
            Some(&album),
            &sources,
            WriteMode::Reconstruct,
        )?;

        for (source, assignment) in sources.iter().zip(assignments.iter()) {
            let Some(id) = source.track_id else {
                continue;
            };
            conn.execute(
                "UPDATE tracks SET art_path = ?1 WHERE id = ?2",
                rusqlite::params![assignment.art_path, id],
            )
            .map_err(|e| format!("failed to update art_path for track {id}: {e}"))?;
        }
    }

    Ok(())
}

fn extract_embedded_art_bytes(path: &Path) -> Option<(Vec<u8>, String)> {
    crate::metadata_reader::read_embedded_art_bytes(path)
}

/// Remove `dir` (and its parent artist dir) when empty. Only ever touches dirs strictly
/// inside `Artwork/albums`; never removes `albums` itself or anything above it.
pub fn prune_empty_album_artwork_dir(library_root: &Path, dir: &Path) -> Result<(), String> {
    ensure_inside_album_artwork(library_root, dir)?;
    if !dir.is_dir() {
        return Ok(());
    }
    let empty = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .next()
        .is_none();
    if empty {
        let _ = fs::remove_dir(dir);
        if let Some(parent) = dir
            .parent()
            .filter(|p| ensure_inside_album_artwork(library_root, p).is_ok())
        {
            let parent_empty = fs::read_dir(parent)
                .map(|mut d| d.next().is_none())
                .unwrap_or(false);
            if parent_empty {
                let _ = fs::remove_dir(parent);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(title: &str, num: i32, bytes: Option<&[u8]>) -> TrackArtSource {
        TrackArtSource {
            track_id: Some(num as i64),
            title: title.into(),
            track_number: Some(num),
            disc_number: Some(1),
            bytes: bytes.map(|b| b.to_vec()),
            mime: "image/jpeg".into(),
        }
    }

    #[test]
    fn unique_extract_majority_is_front() {
        let root = std::env::temp_dir().join(format!("spiral-art-unique-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let common = b"CANONICAL-ART-BYTES";
        let a = b"UNIQUE-A";
        let b = b"UNIQUE-B";
        let c = b"UNIQUE-C";

        let mut tracks = Vec::new();
        for i in 1..=10 {
            tracks.push(track(&format!("T{i}"), i, Some(common)));
        }
        tracks.push(track("Alt1", 11, Some(a)));
        tracks.push(track("Alt2", 12, Some(b)));
        tracks.push(track("Alt3", 13, Some(c)));

        let assignments = write_album_unique_art(
            &root,
            Some("Artist"),
            None,
            Some("Album"),
            &tracks,
            WriteMode::Reconstruct,
        )
        .unwrap();

        let album_dir = album_artwork_dir(&root, Some("Artist"), None, Some("Album"));
        assert!(find_front_image(&album_dir).is_some());
        let files: Vec<_> = fs::read_dir(&album_dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            files.len(),
            4,
            "expected front + 3 overrides, got {files:?}"
        );

        let null_count = assignments.iter().filter(|a| a.art_path.is_none()).count();
        assert_eq!(null_count, 10);
        let override_count = assignments.iter().filter(|a| a.art_path.is_some()).count();
        assert_eq!(override_count, 3);

        for a in &assignments {
            if let Some(rel) = &a.art_path {
                assert!(rel.contains(" - front."));
            }
        }

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn tie_break_prefers_earlier_track() {
        let root = std::env::temp_dir().join(format!("spiral-art-tie-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let x = b"XXXX";
        let y = b"YYYY";
        let tracks = vec![track("Second", 2, Some(y)), track("First", 1, Some(x))];

        let assignments = write_album_unique_art(
            &root,
            Some("A"),
            None,
            Some("B"),
            &tracks,
            WriteMode::Reconstruct,
        )
        .unwrap();

        // Equal counts (1 each) → canonical is SHA of track 1 (earlier).
        assert!(assignments[1].art_path.is_none());
        assert!(assignments[0].art_path.is_some());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn no_clobber_keeps_existing_front() {
        let root = std::env::temp_dir().join(format!("spiral-art-noclob-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let album_dir = album_artwork_dir(&root, Some("A"), None, Some("B"));
        fs::create_dir_all(&album_dir).unwrap();
        let front = album_dir.join("front.jpg");
        fs::write(&front, b"DROP-IN").unwrap();

        let tracks = vec![track("T1", 1, Some(b"EMBEDDED"))];
        write_album_unique_art(
            &root,
            Some("A"),
            None,
            Some("B"),
            &tracks,
            WriteMode::NoClobber,
        )
        .unwrap();

        assert_eq!(fs::read(&front).unwrap(), b"DROP-IN");
        let _ = fs::remove_dir_all(&root);
    }
}
