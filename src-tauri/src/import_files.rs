use crate::library_organize::{self, OrganizeMetadata};
use id3::{Tag, TagLike};
use metaflac::Tag as FlacTag;
use mp4ameta::Tag as Mp4Tag;
use std::fs;
use std::path::{Path, PathBuf};

const ARTIST_JOIN_DELIMITER: &str = " / ";

#[derive(Debug, Default)]
struct BasicTags {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    album_artist: Option<String>,
    track_number: Option<i32>,
}

fn join_tag_values<'a, I>(values: I) -> Option<String>
where
    I: IntoIterator<Item = &'a str>,
{
    let parts: Vec<String> = values
        .into_iter()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(ARTIST_JOIN_DELIMITER))
    }
}

fn audio_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

fn filename_title(path: &Path) -> String {
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown Track");
    name.to_string()
}

fn read_basic_tags(path: &Path) -> BasicTags {
    let ext = match audio_extension(path) {
        Some(e) => e,
        None => return BasicTags::default(),
    };

    let mut tags = BasicTags::default();

    match ext.as_str() {
        "mp3" => {
            if let Ok(tag) = Tag::read_from_path(path) {
                tags.title = tag.title().map(|s| s.to_string());
                tags.artist = tag.artist().map(|s| s.to_string());
                tags.album = tag.album().map(|s| s.to_string());
                tags.album_artist = tag.album_artist().map(|s| s.to_string());
                tags.track_number = tag.track().map(|n| n as i32);
            }
        }
        "flac" => {
            if let Ok(tag) = FlacTag::read_from_path(path) {
                if let Some(mut v) = tag.get_vorbis("TITLE") {
                    tags.title = v.next().map(|s| s.to_string());
                }
                if let Some(v) = tag.get_vorbis("ARTIST") {
                    tags.artist = join_tag_values(v);
                }
                if let Some(mut v) = tag.get_vorbis("ALBUM") {
                    tags.album = v.next().map(|s| s.to_string());
                }
                if let Some(v) = tag.get_vorbis("ALBUMARTIST") {
                    tags.album_artist = join_tag_values(v);
                }
                if let Some(mut v) = tag.get_vorbis("TRACKNUMBER") {
                    tags.track_number = v
                        .next()
                        .and_then(|s| s.split('/').next())
                        .and_then(|s| s.parse().ok());
                }
            }
        }
        "m4a" | "aac" | "mp4" => {
            if let Ok(tag) = Mp4Tag::read_from_path(path) {
                tags.title = tag.title().map(|s| s.to_string());
                tags.artist = tag.artist().map(|s| s.to_string());
                tags.album = tag.album().map(|s| s.to_string());
                tags.album_artist = tag.album_artist().map(|s| s.to_string());
                tags.track_number = tag.track_number().map(|n| n as i32);
            }
        }
        _ => {}
    }

    tags
}

fn build_flat_copy_path(media_folder: &Path, source: &Path) -> PathBuf {
    let file_name = source
        .file_name()
        .map(|n| n.to_owned())
        .unwrap_or_else(|| std::ffi::OsStr::new("track.mp3").to_owned());
    media_folder.join(file_name)
}

pub fn prepare_import_file(
    source_path: &str,
    mode: &str,
    auto_organize: bool,
    media_folder: &str,
    organize_path_format: &str,
) -> Result<String, String> {
    let source = Path::new(source_path);
    if !source.is_file() {
        return Err(format!("Source is not a file: {source_path}"));
    }

    if mode == "reference" {
        return Ok(source_path.to_string());
    }

    if mode != "copy" {
        return Err(format!("Invalid import mode: {mode}"));
    }

    let media = Path::new(media_folder);
    fs::create_dir_all(media).map_err(|e| format!("failed to create media folder: {e}"))?;

    let tags = read_basic_tags(source);
    let dest = if auto_organize {
        let title = tags
            .title
            .clone()
            .unwrap_or_else(|| filename_title(source));
        let meta = OrganizeMetadata {
            title: title.as_str(),
            artist: tags.artist.as_deref(),
            album: tags.album.as_deref(),
            album_artist: tags.album_artist.as_deref(),
            track_number: tags.track_number,
            disc_number: None,
            year: None,
            genre: None,
        };
        library_organize::build_organized_path(media, source, &meta, organize_path_format)?
    } else {
        build_flat_copy_path(media, source)
    };

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create destination folder: {e}"))?;
    }

    let dest = library_organize::unique_path(dest);
    fs::copy(source, &dest).map_err(|e| format!("failed to copy file: {e}"))?;

    Ok(dest.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_organize::sanitize_filename;
    use std::io::Write;

    #[test]
    fn join_tag_values_joins_artists() {
        assert_eq!(
            join_tag_values(["A", " B "]),
            Some("A / B".to_string())
        );
        assert_eq!(join_tag_values::<[&str; 0]>([]), None);
    }

    #[test]
    fn sanitize_strips_path_separators() {
        assert_eq!(sanitize_filename("AC/DC"), "ACDC");
        assert_eq!(sanitize_filename("  hello   world  "), "hello world");
        assert_eq!(sanitize_filename(""), "Unknown");
    }

    #[test]
    fn reference_mode_returns_source() {
        let dir = std::env::temp_dir().join(format!("spiral-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let source = dir.join("song.mp3");
        {
            let mut f = fs::File::create(&source).unwrap();
            writeln!(f, "test").unwrap();
        }
        let media = dir.join("media");
        let result = prepare_import_file(
            source.to_str().unwrap(),
            "reference",
            true,
            media.to_str().unwrap(),
            library_organize::DEFAULT_ORGANIZE_PATH_FORMAT,
        )
        .unwrap();
        assert_eq!(result, source.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);
    }
}
