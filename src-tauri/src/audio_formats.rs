use std::path::Path;

pub const SUPPORTED_AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "aac", "wav", "m4a"];

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

/// Keep directories and supported audio files; drop unsupported files.
pub fn filter_library_import_paths(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|path| {
            let p = Path::new(path);
            if p.is_dir() {
                return true;
            }
            is_supported_audio_file(p)
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
}
