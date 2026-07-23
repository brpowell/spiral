use std::path::Path;

pub fn file_label(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.display().to_string())
}

pub fn format_missing_output(path: &Path) -> String {
    format!("Transcode output missing: {}", file_label(path))
}

pub fn format_wav_read_failure(path: &Path, detail: &str) -> String {
    format!("Failed to read decoded audio for {}: {detail}", file_label(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_missing_output_uses_file_name() {
        let message = format_missing_output(Path::new("/music/track.m4a"));
        assert!(message.contains("track.m4a"));
    }
}
