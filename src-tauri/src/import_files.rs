use crate::library_organize::{self, OrganizeMetadata};
use crate::lyrics_sidecar;
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
    lyrics_sidecar_enabled: bool,
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
            disc_number: tags.disc_number,
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

    if lyrics_sidecar_enabled {
        lyrics_sidecar::copy_sidecar(source, &dest)?;
    }

    Ok(dest.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_organize::sanitize_filename;
    use std::io::Write;
    use std::path::PathBuf;

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
            true,
        )
        .unwrap();
        assert_eq!(result, source.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_mode_copies_sibling_lrc_when_enabled() {
        let dir = std::env::temp_dir().join(format!(
            "spiral-import-sidecar-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let source = dir.join("song.flac");
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac");
        fs::copy(src, &source).unwrap();
        {
            let mut f = fs::File::create(dir.join("song.lrc")).unwrap();
            writeln!(f, "[00:01.00] Hello").unwrap();
        }

        let media = dir.join("media");
        let result = prepare_import_file(
            source.to_str().unwrap(),
            "copy",
            false,
            media.to_str().unwrap(),
            library_organize::DEFAULT_ORGANIZE_PATH_FORMAT,
            true,
        )
        .unwrap();

        let dest = PathBuf::from(&result);
        assert!(dest.is_file());
        let dest_sidecar = lyrics_sidecar::sidecar_path_for(&dest);
        assert!(dest_sidecar.is_file());
        let text = fs::read_to_string(&dest_sidecar).unwrap();
        assert!(text.contains("Hello"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_mode_skips_sidecar_when_disabled() {
        let dir = std::env::temp_dir().join(format!(
            "spiral-import-sidecar-off-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let source = dir.join("song.flac");
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac");
        fs::copy(src, &source).unwrap();
        {
            let mut f = fs::File::create(dir.join("song.lrc")).unwrap();
            writeln!(f, "[00:01.00] Hello").unwrap();
        }

        let media = dir.join("media");
        let result = prepare_import_file(
            source.to_str().unwrap(),
            "copy",
            false,
            media.to_str().unwrap(),
            library_organize::DEFAULT_ORGANIZE_PATH_FORMAT,
            false,
        )
        .unwrap();

        let dest = PathBuf::from(&result);
        assert!(dest.is_file());
        assert!(!lyrics_sidecar::sidecar_path_for(&dest).exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_mode_with_organize_keeps_sidecar_beside_dest() {
        let dir = std::env::temp_dir().join(format!(
            "spiral-import-sidecar-org-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let source = dir.join("song.flac");
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac");
        fs::copy(&src, &source).unwrap();
        {
            use metaflac::Tag as FlacTag;
            let mut tag = FlacTag::read_from_path(&source).unwrap();
            tag.set_vorbis("TITLE", vec!["Organize Me"]);
            tag.set_vorbis("ARTIST", vec!["Tester"]);
            tag.set_vorbis("ALBUM", vec!["Demo"]);
            tag.save().unwrap();
        }
        {
            let mut f = fs::File::create(dir.join("song.lrc")).unwrap();
            writeln!(f, "[00:01.00] Organized").unwrap();
        }

        let media = dir.join("media");
        let result = prepare_import_file(
            source.to_str().unwrap(),
            "copy",
            true,
            media.to_str().unwrap(),
            library_organize::DEFAULT_ORGANIZE_PATH_FORMAT,
            true,
        )
        .unwrap();

        let dest = PathBuf::from(&result);
        assert!(dest.is_file());
        let dest_sidecar = lyrics_sidecar::sidecar_path_for(&dest);
        assert!(
            dest_sidecar.is_file(),
            "expected sidecar at {}",
            dest_sidecar.display()
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
