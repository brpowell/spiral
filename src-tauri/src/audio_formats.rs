use std::path::Path;

pub const SUPPORTED_AUDIO_EXTENSIONS: &[&str] =
    &["mp3", "flac", "aac", "wav", "m4a", "mp4", "ogg", "opus"];

const BLOCKED_AUDIO_EXTENSIONS: &[&str] = &["m4p"];

pub fn is_supported_audio_file(path: &Path) -> bool {
    let ext = match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => ext.to_ascii_lowercase(),
        None => return false,
    };

    if BLOCKED_AUDIO_EXTENSIONS.contains(&ext.as_str()) {
        return false;
    }

    SUPPORTED_AUDIO_EXTENSIONS.contains(&ext.as_str())
}

pub fn is_zip_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
}

/// Keep directories, zip archives, and supported audio files; drop unsupported files.
pub fn filter_library_import_paths(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|path| {
            let p = Path::new(path);
            if p.is_dir() {
                return true;
            }
            is_zip_file(p) || is_supported_audio_file(p)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_m4p() {
        assert!(!is_supported_audio_file(Path::new("/music/song.m4p")));
    }

    #[test]
    fn accepts_m4a() {
        assert!(is_supported_audio_file(Path::new("/music/song.m4a")));
    }

    #[test]
    fn accepts_mp4() {
        assert!(is_supported_audio_file(Path::new("/music/song.mp4")));
    }

    #[test]
    fn accepts_ogg_and_opus() {
        assert!(is_supported_audio_file(Path::new("/music/song.ogg")));
        assert!(is_supported_audio_file(Path::new("/music/song.opus")));
    }

    #[test]
    fn accepts_zip_archives() {
        assert!(is_zip_file(Path::new("/imports/album.ZIP")));
    }
}
