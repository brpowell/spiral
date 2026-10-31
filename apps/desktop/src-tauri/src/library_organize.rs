use crate::fs_move;
use crate::lyrics_sidecar;
use crate::models::TrackMetadataUpdate;
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_TRACK_FILENAME_FORMAT: &str = "{trackNumber:02} - {title}";
pub const DEFAULT_ORGANIZE_PATH_FORMAT: &str =
    "{albumArtist}/{album}/{trackNumber:02} - {title}.{ext}";

pub fn default_organize_path_format() -> String {
    DEFAULT_ORGANIZE_PATH_FORMAT.to_string()
}

/// Clean a tag value into a single path segment. Names made only of dots (`.`, `..`,
/// `...`) become `Unknown` so a segment can never refer to the current or parent directory.
pub fn sanitize_filename(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch.is_control() {
            continue;
        }
        match ch {
            '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*' => continue,
            _ => out.push(ch),
        }
    }
    let trimmed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    // Windows also drops trailing dots and spaces, so ". ." is as dangerous as "..".
    if trimmed.chars().all(|c| c == '.' || c == ' ') {
        "Unknown".to_string()
    } else {
        trimmed
    }
}

fn sanitize_extension(ext: &str) -> String {
    let filtered: String = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    if filtered.is_empty() {
        "mp3".to_string()
    } else {
        filtered
    }
}

fn is_forbidden_path_segment(name: &str) -> bool {
    name == "." || name == ".."
}

fn is_windows_reserved_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    let stem = upper.split('.').next().unwrap_or(&upper);
    matches!(
        stem,
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn finalize_path_segment(segment: &str) -> String {
    let trimmed = segment.trim();
    if trimmed.is_empty() || is_forbidden_path_segment(trimmed) {
        return String::new();
    }

    let cleaned = clean_path_segment(trimmed);
    if cleaned.is_empty() || is_forbidden_path_segment(&cleaned) {
        return String::new();
    }

    if let Some((stem, ext)) = cleaned.rsplit_once('.') {
        if !ext.is_empty() && is_windows_reserved_name(stem) {
            return format!("{stem}_.{ext}");
        }
    } else if is_windows_reserved_name(&cleaned) {
        return format!("{cleaned}_");
    }

    cleaned
}

fn ensure_stays_under_media_folder(dest: &Path, media_folder: &Path) -> Result<(), String> {
    if !dest.starts_with(media_folder) {
        return Err(format!(
            "Organized path must stay inside the tracks folder: {}",
            dest.display()
        ));
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct OrganizeMetadata<'a> {
    pub title: &'a str,
    pub artist: Option<&'a str>,
    pub album: Option<&'a str>,
    pub album_artist: Option<&'a str>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub year: Option<i32>,
    pub genre: Option<&'a str>,
}

impl<'a> From<&'a TrackMetadataUpdate> for OrganizeMetadata<'a> {
    fn from(m: &'a TrackMetadataUpdate) -> Self {
        Self {
            title: &m.title,
            artist: m.artist.as_deref(),
            album: m.album.as_deref(),
            album_artist: m.album_artist.as_deref(),
            track_number: m.track_number,
            disc_number: m.disc_number,
            year: m.year,
            genre: m.genre.as_deref(),
        }
    }
}

pub fn default_track_filename_format() -> String {
    DEFAULT_TRACK_FILENAME_FORMAT.to_string()
}

/// Expand `{placeholders}` in `template`. When `ext` is set, `{ext}` resolves to the file extension.
fn expand_template(template: &str, meta: &OrganizeMetadata<'_>, ext: Option<&str>) -> String {
    let mut out = String::with_capacity(template.len() + 32);
    let bytes = template.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some((key, pad, end)) = parse_placeholder(&template[i..]) {
                let value = placeholder_value(key, pad, meta, ext);
                out.push_str(&value);
                i += end;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// Relative path under the tracks folder using `/` as the segment separator.
pub fn format_organize_relative_path(
    path_format: &str,
    meta: &OrganizeMetadata<'_>,
    ext: &str,
) -> String {
    let template = if path_format.trim().is_empty() {
        DEFAULT_ORGANIZE_PATH_FORMAT
    } else {
        path_format
    };

    expand_template(template, meta, Some(ext))
        .split(['/', '\\'])
        .filter(|s| !s.is_empty())
        .map(finalize_path_segment)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn clean_path_segment(segment: &str) -> String {
    clean_formatted_stem(segment.trim())
}

fn parse_placeholder(rest: &str) -> Option<(&str, Option<usize>, usize)> {
    let close = rest.find('}')?;
    let inner = &rest[1..close];
    let (key, pad) = if let Some((k, p)) = inner.split_once(':') {
        (k.trim(), p.trim().parse().ok())
    } else {
        (inner.trim(), None)
    };
    if key.is_empty() {
        return None;
    }
    Some((key, pad, close + 1))
}

fn placeholder_value(
    key: &str,
    pad: Option<usize>,
    meta: &OrganizeMetadata<'_>,
    ext: Option<&str>,
) -> String {
    match key {
        "title" => sanitize_filename(meta.title),
        "artist" => sanitize_filename(meta.artist.unwrap_or("Unknown Artist")),
        "album" => sanitize_filename(meta.album.unwrap_or("Unknown Album")),
        "albumArtist" => sanitize_filename(
            meta.album_artist
                .or(meta.artist)
                .unwrap_or("Unknown Artist"),
        ),
        "ext" => sanitize_extension(ext.unwrap_or("mp3")),
        "genre" => {
            let g = meta.genre.unwrap_or("");
            if g.is_empty() {
                String::new()
            } else {
                sanitize_filename(g)
            }
        }
        "year" => meta.year.map(|y| y.to_string()).unwrap_or_default(),
        "trackNumber" => format_optional_number(meta.track_number, pad),
        "discNumber" => format_optional_number(meta.disc_number, pad),
        _ => String::new(),
    }
}

fn format_optional_number(value: Option<i32>, pad: Option<usize>) -> String {
    let Some(n) = value else {
        return String::new();
    };
    match pad {
        Some(width) => format!("{n:0width$}"),
        None => n.to_string(),
    }
}

fn clean_formatted_stem(stem: &str) -> String {
    let mut s = stem.trim().to_string();
    while s.starts_with(" - ") {
        s = s[3..].trim_start().to_string();
    }
    while s.starts_with("- ") {
        s = s[2..].trim_start().to_string();
    }
    while s.ends_with(" -") || s.ends_with(" - ") {
        s = s
            .trim_end_matches(|c: char| c == ' ' || c == '-')
            .to_string();
    }
    sanitize_filename(&s)
}

pub fn build_organized_path(
    media_folder: &Path,
    source: &Path,
    meta: &OrganizeMetadata<'_>,
    path_format: &str,
) -> Result<PathBuf, String> {
    let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("mp3");

    let relative = format_organize_relative_path(path_format, meta, ext);
    if relative.is_empty() {
        return Err("Organization path format produced an empty path".to_string());
    }

    let mut dest = media_folder.to_path_buf();
    for segment in relative.split('/') {
        dest.push(segment);
    }
    ensure_stays_under_media_folder(&dest, media_folder)?;
    Ok(dest)
}

/// Pick a free path, appending ` (2)`, ` (3)`, … on collision.
///
/// When `allow_existing` is set (track replace), that path may be overwritten
/// instead of uniquified.
pub fn unique_path(dest: PathBuf, allow_existing: Option<&Path>) -> PathBuf {
    unique_path_by(dest, |candidate| {
        !candidate.exists() || allow_existing.is_some_and(|p| same_path(candidate, p))
    })
}

/// [`unique_path`] with the caller deciding which paths are free, e.g. a
/// planner that also has to avoid targets it has already handed out.
pub fn unique_path_by(dest: PathBuf, mut is_free: impl FnMut(&Path) -> bool) -> PathBuf {
    if is_free(&dest) {
        return dest;
    }

    let stem = dest
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file")
        .to_string();
    let ext = dest
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let parent = dest.parent().map(|p| p.to_path_buf()).unwrap_or_default();

    let mut n = 2;
    loop {
        let candidate = parent.join(format!("{stem} ({n}){ext}"));
        if is_free(&candidate) {
            return candidate;
        }
        n += 1;
        if n > 9999 {
            return dest;
        }
    }
}

/// True when `path` is the same as or nested under `media_folder`.
pub fn is_under_media_folder(path: &Path, media_folder: &Path) -> bool {
    let Ok(path) = path.canonicalize() else {
        return path.starts_with(media_folder);
    };
    let Ok(media) = media_folder.canonicalize() else {
        return path.starts_with(media_folder);
    };
    path.starts_with(&media)
}

pub(crate) fn same_path(a: &Path, b: &Path) -> bool {
    a.canonicalize()
        .and_then(|ac| b.canonicalize().map(|bc| ac == bc))
        .unwrap_or_else(|_| a == b)
}

/// Move audio file to `dest`.
pub fn move_track_file(
    from: &Path,
    dest: PathBuf,
    move_lyrics_sidecar: bool,
) -> Result<PathBuf, String> {
    if same_path(from, &dest) {
        return Ok(dest);
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create destination folder: {e}"))?;
    }

    let dest = unique_path(dest, None);
    fs_move::rename_or_copy_file(from, &dest)?;

    if move_lyrics_sidecar {
        lyrics_sidecar::move_sidecar(from, &dest);
    }

    Ok(dest)
}

/// Remove empty directories from `start` up to (but not including) `stop_at`.
pub fn prune_empty_dirs(start: &Path, stop_at: &Path) {
    // Compare like with like: both resolved when they can be (e.g. `/var` and
    // `/private/var` on macOS).
    let start_buf = start.canonicalize().unwrap_or_else(|_| start.to_path_buf());
    let Ok(stop) = stop_at.canonicalize() else {
        prune_empty_dirs_inner(start_buf, stop_at.to_path_buf());
        return;
    };
    prune_empty_dirs_inner(start_buf, stop);
}

fn prune_empty_dirs_inner(mut dir: PathBuf, stop_at: PathBuf) {
    loop {
        if dir == stop_at || !dir.starts_with(&stop_at) {
            break;
        }
        match fs::read_dir(&dir) {
            Ok(mut entries) => {
                if entries.next().is_some() {
                    break;
                }
            }
            Err(_) => break,
        }
        let parent = match dir.parent() {
            Some(p) => p.to_path_buf(),
            None => break,
        };
        if fs::remove_dir(&dir).is_err() {
            break;
        }
        dir = parent;
    }
}

/// Rename legacy app-data cached art when a library track path changes.
/// Library-relative `Artwork/…` paths are left unchanged (identity moves use
/// [`crate::artwork_organize`]).
pub fn migrate_art_cache(
    app_data_dir: &Path,
    old_file_path: &str,
    new_file_path: &str,
    current_art_path: Option<&str>,
) -> Result<Option<String>, String> {
    use crate::art_cache::{art_cache_dir, art_cache_key};

    if let Some(p) = current_art_path {
        let norm = p.replace('\\', "/");
        if norm.starts_with("Artwork/") || norm.contains("/Artwork/") {
            return Ok(Some(p.to_string()));
        }
    }

    let dir = art_cache_dir(app_data_dir);
    if !dir.is_dir() {
        return Ok(current_art_path.map(|s| s.to_string()));
    }

    let old_prefix = art_cache_key(old_file_path);
    let new_prefix = art_cache_key(new_file_path);
    if old_prefix == new_prefix {
        return Ok(current_art_path.map(|s| s.to_string()));
    }

    let mut migrated_ext: Option<String> = None;
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(&format!("{old_prefix}.")) {
            continue;
        }
        let ext = name
            .strip_prefix(&format!("{old_prefix}."))
            .unwrap_or("jpg")
            .to_string();
        let dest = dir.join(format!("{new_prefix}.{ext}"));
        if dest.exists() {
            let _ = fs::remove_file(&dest);
        }
        fs::rename(entry.path(), &dest)
            .map_err(|e| format!("failed to migrate cached art: {e}"))?;
        migrated_ext = Some(ext);
    }

    Ok(match migrated_ext {
        Some(ext) => Some(
            dir.join(format!("{new_prefix}.{ext}"))
                .to_string_lossy()
                .into_owned(),
        ),
        None => current_art_path.map(|s| s.to_string()),
    })
}

/// After metadata is written, move the file into Artist/Album layout when enabled.
pub fn relocate_track_after_metadata(
    media_folder: &str,
    path_format: &str,
    source_path: &Path,
    metadata: &TrackMetadataUpdate,
    move_lyrics_sidecar: bool,
) -> Result<Option<PathBuf>, String> {
    let media = Path::new(media_folder);
    if !is_under_media_folder(source_path, media) {
        return Ok(None);
    }

    let meta = OrganizeMetadata::from(metadata);
    let dest = build_organized_path(media, source_path, &meta, path_format)?;
    if same_path(source_path, &dest) {
        return Ok(None);
    }

    let old_parent = source_path.parent().map(|p| p.to_path_buf());
    let new_path = move_track_file(source_path, dest, move_lyrics_sidecar)?;
    if let Some(old_parent) = old_parent {
        match media.canonicalize() {
            Ok(media_canon) => prune_empty_dirs(&old_parent, &media_canon),
            Err(_) => prune_empty_dirs(&old_parent, media),
        }
    }

    Ok(Some(new_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn build_organized_path_supports_custom_layout() {
        let media = Path::new("/Music/Spiral Library/Tracks");
        let source = Path::new("/Music/Spiral Library/Tracks/track.mp3");
        let meta = OrganizeMetadata {
            title: "Example Song",
            artist: Some("Example Artist"),
            album: Some("Example Album"),
            album_artist: Some("Example Artist"),
            track_number: None,
            disc_number: None,
            year: Some(2024),
            genre: None,
        };
        let dest = build_organized_path(
            media,
            source,
            &meta,
            "{artist}/{year} - {album}/{title}.{ext}",
        )
        .unwrap();
        assert_eq!(
            dest,
            media
                .join("Example Artist")
                .join("2024 - Example Album")
                .join("Example Song.mp3")
        );
    }

    #[test]
    fn format_organize_relative_path_default() {
        let meta = OrganizeMetadata {
            title: "Song",
            artist: Some("Band"),
            album: Some("Album"),
            album_artist: None,
            track_number: Some(3),
            disc_number: None,
            year: None,
            genre: None,
        };
        assert_eq!(
            format_organize_relative_path(DEFAULT_ORGANIZE_PATH_FORMAT, &meta, "mp3"),
            "Band/Album/03 - Song.mp3"
        );
    }

    #[test]
    fn build_organized_path_prefers_album_artist_for_folder() {
        let media = Path::new("/Music/Spiral Library/Tracks");
        let source =
            Path::new("/Music/Spiral Library/Tracks/Unknown Artist/Unknown Album/track.mp3");
        let meta = OrganizeMetadata {
            title: "LOYALTY.",
            artist: Some("Kendrick Lamar / Rihanna"),
            album: Some("DAMN."),
            album_artist: Some("Kendrick Lamar"),
            track_number: Some(8),
            disc_number: None,
            year: None,
            genre: None,
        };
        let dest =
            build_organized_path(media, source, &meta, DEFAULT_ORGANIZE_PATH_FORMAT).unwrap();
        assert_eq!(
            dest,
            media
                .join("Kendrick Lamar")
                .join("DAMN.")
                .join("08 - LOYALTY..mp3")
        );
    }

    #[test]
    fn build_organized_path_uses_artist_album() {
        let media = Path::new("/Music/Spiral Library/Tracks");
        let source =
            Path::new("/Music/Spiral Library/Tracks/Unknown Artist/Unknown Album/track.mp3");
        let meta = OrganizeMetadata {
            title: "My Song",
            artist: Some("AC/DC"),
            album: Some("Back In Black"),
            album_artist: None,
            track_number: Some(1),
            disc_number: None,
            year: None,
            genre: None,
        };
        let dest =
            build_organized_path(media, source, &meta, DEFAULT_ORGANIZE_PATH_FORMAT).unwrap();
        assert_eq!(
            dest,
            media
                .join("ACDC")
                .join("Back In Black")
                .join("01 - My Song.mp3")
        );
    }

    #[test]
    fn move_track_file_moves_audio() {
        let dir = std::env::temp_dir().join(format!("spiral-organize-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let from = dir.join("old").join("song.mp3");
        fs::create_dir_all(from.parent().unwrap()).unwrap();
        let mut f = fs::File::create(&from).unwrap();
        writeln!(f, "audio").unwrap();

        let dest = dir
            .join("new")
            .join("Artist")
            .join("Album")
            .join("song.mp3");
        let moved = move_track_file(&from, dest, true).unwrap();
        assert!(moved.exists());
        assert!(!from.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn move_track_file_moves_sidecar() {
        let dir = std::env::temp_dir().join(format!("spiral-organize-lrc-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let from = dir.join("old").join("song.mp3");
        fs::create_dir_all(from.parent().unwrap()).unwrap();
        fs::File::create(&from).unwrap();
        fs::write(dir.join("old").join("song.lrc"), "[00:01.00] Moved").unwrap();

        let dest = dir
            .join("new")
            .join("Artist")
            .join("Album")
            .join("song.mp3");
        let moved = move_track_file(&from, dest, true).unwrap();
        assert!(dir
            .join("new")
            .join("Artist")
            .join("Album")
            .join("song.lrc")
            .exists());
        assert!(!dir.join("old").join("song.lrc").exists());
        assert!(moved.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn strips_windows_invalid_characters_from_metadata() {
        assert_eq!(sanitize_filename("Track: <Bad>?|*"), "Track Bad");
        for dots in [".", "..", "...", ". .", " .. ", "\u{0}..", "./.."] {
            assert_eq!(sanitize_filename(dots), "Unknown", "{dots:?}");
        }
        assert_eq!(sanitize_filename("St. Anger"), "St. Anger");
        assert_eq!(
            sanitize_filename("...And Justice for All"),
            "...And Justice for All"
        );
    }

    #[test]
    fn format_organize_strips_dot_dot_segments() {
        let meta = OrganizeMetadata {
            title: "Song",
            artist: Some("Artist"),
            album: Some("Album"),
            album_artist: Some("Artist"),
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
        };
        assert_eq!(
            format_organize_relative_path("{albumArtist}/../outside/{title}.{ext}", &meta, "mp3"),
            "Artist/outside/Song.mp3"
        );
    }

    #[test]
    fn reserved_windows_name_gets_suffix() {
        let meta = OrganizeMetadata {
            title: "CON",
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
        };
        assert_eq!(
            format_organize_relative_path("{title}.{ext}", &meta, "mp3"),
            "CON_.mp3"
        );
    }

    #[test]
    fn build_organized_path_stays_under_media_when_format_has_dot_dot() {
        let media = Path::new("/Music/Spiral Library/Tracks");
        let source = Path::new("/Music/Spiral Library/Tracks/track.mp3");
        let meta = OrganizeMetadata {
            title: "Song",
            artist: Some("Artist"),
            album: Some("Album"),
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
        };
        let dest = build_organized_path(media, source, &meta, "../../../etc/passwd/{title}.{ext}")
            .unwrap();
        assert!(dest.starts_with(media));
        assert_eq!(dest, media.join("etc").join("passwd").join("Song.mp3"));
    }

    #[test]
    fn unique_path_can_reuse_allowed_existing_file() {
        let dir = std::env::temp_dir().join(format!("spiral-unique-allow-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let existing = dir.join("My Song.mp3");
        fs::write(&existing, b"old").unwrap();

        assert_eq!(
            unique_path(existing.clone(), None),
            dir.join("My Song (2).mp3")
        );
        assert_eq!(unique_path(existing.clone(), Some(&existing)), existing);

        let _ = fs::remove_dir_all(&dir);
    }
}
