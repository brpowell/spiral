use crate::library_organize::{self, OrganizeMetadata};
use crate::metadata_reader::{self, read_basic_tags};
use std::fs;
use std::path::{Path, PathBuf};

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
            .unwrap_or_else(|| metadata_reader::filename_title(source));
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
