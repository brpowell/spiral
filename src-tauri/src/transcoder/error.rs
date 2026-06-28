use std::path::Path;

pub fn file_label(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.display().to_string())
}

pub fn format_afconvert_failure(source: &Path, stderr: &str) -> String {
    let label = file_label(source);
    let detail = clean_afconvert_stderr(stderr);

    if detail.contains("AudioFileOpenURL failed") {
        return format!(
            "Could not read {label}. The file may be missing, corrupt, or in an unsupported format."
        );
    }

    if detail.is_empty() {
        return format!("Transcode failed for {label}.");
    }

    format!("Transcode failed for {label}: {detail}")
}

pub fn format_missing_output(path: &Path) -> String {
    format!("Transcode output missing: {}", file_label(path))
}

pub fn format_wav_read_failure(path: &Path, detail: &str) -> String {
    format!("Failed to read decoded audio for {}: {detail}", file_label(path))
}

fn clean_afconvert_stderr(stderr: &str) -> String {
    stderr
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| line.strip_prefix("Error:").unwrap_or(line).trim())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_afconvert_failure_strips_error_prefix() {
        let message = format_afconvert_failure(
            Path::new("/music/track.m4a"),
            "Error: ExtAudioFileSetProperty ('cfmt') failed ('fmt?')\n",
        );
        assert!(message.contains("track.m4a"));
        assert!(!message.contains("Error:"));
        assert!(message.contains("cfmt"));
    }

    #[test]
    fn format_afconvert_failure_describes_unopenable_file() {
        let message = format_afconvert_failure(
            Path::new("/music/track.m4a"),
            "Fail: AudioFileOpenURL failed\n",
        );
        assert!(message.contains("Could not read track.m4a"));
    }
}
