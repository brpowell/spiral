use crate::lyrics_lrc;
use crate::lyrics_tags::{LyricsFormatHint, RawLyrics};
use crate::models::{LyricsFormat, TrackLyricsInput};
use std::fs;
use std::path::{Path, PathBuf};

/// Path to `{stem}.lrc` beside an audio file.
pub fn sidecar_path_for(audio_path: &Path) -> PathBuf {
    let parent = audio_path.parent().unwrap_or_else(|| Path::new(""));
    let stem = audio_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    parent.join(format!("{stem}.lrc"))
}

/// Read sibling `.lrc` lyrics when present.
pub fn read_lyrics_sidecar(audio_path: &Path) -> Option<RawLyrics> {
    let path = sidecar_path_for(audio_path);
    let text = fs::read_to_string(path).ok()?;
    let text = text.trim().to_string();
    if text.is_empty() {
        return None;
    }

    Some(RawLyrics {
        hint: LyricsFormatHint::LineSynced,
        text,
    })
}

/// Write, update, or remove `{stem}.lrc` beside the audio file.
pub fn sync_sidecar(
    audio_path: &Path,
    lyrics: Option<&TrackLyricsInput>,
) -> Result<(), String> {
    let path = sidecar_path_for(audio_path);

    if lyrics.is_some_and(|value| {
        value.format == LyricsFormat::LineSynced && !value.plain_text.trim().is_empty()
    }) {
        let lyrics = lyrics.expect("checked above");
        let mut content = lyrics_lrc::serialize_lrc(&lyrics.lines, 0);
        if !content.ends_with('\n') {
            content.push('\n');
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create sidecar directory: {e}"))?;
        }
        fs::write(&path, content).map_err(|e| format!("failed to write lyrics sidecar: {e}"))?;
        return Ok(());
    }

    if path.is_file() {
        fs::remove_file(&path).map_err(|e| format!("failed to remove lyrics sidecar: {e}"))?;
    }

    Ok(())
}

/// Remove sibling `.lrc` file when present.
pub fn remove_sidecar(audio_path: &Path) -> Result<(), String> {
    let path = sidecar_path_for(audio_path);
    if path.is_file() {
        fs::remove_file(&path).map_err(|e| format!("failed to remove lyrics sidecar: {e}"))?;
    }
    Ok(())
}

/// Move `{stem}.lrc` alongside an audio file when relocating tracks.
pub fn move_sidecar(from: &Path, dest: &Path) {
    let sidecar_from = sidecar_path_for(from);
    if !sidecar_from.is_file() {
        return;
    }

    let sidecar_to = sidecar_path_for(dest);
    if sidecar_to.exists() {
        if let Err(e) = fs::remove_file(&sidecar_to) {
            eprintln!("failed to remove existing lyrics sidecar: {e}");
            return;
        }
    }
    if let Some(parent) = sidecar_to.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Err(e) = crate::fs_move::rename_or_copy_file(&sidecar_from, &sidecar_to) {
        eprintln!("failed to move lyrics sidecar: {e}");
    }
}

/// Copy sibling `.lrc` next to a newly copied audio file when present.
pub fn copy_sidecar(from: &Path, dest: &Path) -> Result<(), String> {
    let sidecar_from = sidecar_path_for(from);
    if !sidecar_from.is_file() {
        return Ok(());
    }

    let sidecar_to = sidecar_path_for(dest);
    if let Some(parent) = sidecar_to.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create sidecar directory: {e}"))?;
    }
    fs::copy(&sidecar_from, &sidecar_to)
        .map_err(|e| format!("failed to copy lyrics sidecar: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{LyricsLine, LyricsSource};
    use std::io::Write;

    fn sample_line_synced_input() -> TrackLyricsInput {
        TrackLyricsInput {
            format: LyricsFormat::LineSynced,
            source: Some(LyricsSource::Manual),
            lines: vec![LyricsLine {
                text: "Synced line".to_string(),
                start_ms: Some(5_000),
                end_ms: None,
                words: None,
            }],
            plain_text: "Synced line".to_string(),
        }
    }

    #[test]
    fn sidecar_path_uses_audio_stem() {
        let path = sidecar_path_for(Path::new("/music/album/song.flac"));
        assert_eq!(path, PathBuf::from("/music/album/song.lrc"));
    }

    #[test]
    fn read_lyrics_sidecar_returns_parsed_lrc_text() {
        let dir = std::env::temp_dir().join(format!("spiral-sidecar-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("track.mp3");
        let sidecar = dir.join("track.lrc");
        let mut file = fs::File::create(&sidecar).unwrap();
        writeln!(file, "[00:05.00] Sidecar line").unwrap();

        let raw = read_lyrics_sidecar(&audio).expect("sidecar lyrics");
        assert_eq!(raw.hint, LyricsFormatHint::LineSynced);
        assert!(raw.text.contains("Sidecar line"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sync_sidecar_writes_line_synced_lrc() {
        let dir = std::env::temp_dir().join(format!("spiral-sidecar-write-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("track.flac");
        fs::File::create(&audio).unwrap();

        let input = sample_line_synced_input();
        sync_sidecar(&audio, Some(&input)).expect("write sidecar");

        let sidecar = dir.join("track.lrc");
        let text = fs::read_to_string(sidecar).expect("read sidecar");
        assert!(text.contains("[00:05.00] Synced line"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sync_sidecar_removes_on_plain_or_clear() {
        let dir = std::env::temp_dir().join(format!("spiral-sidecar-remove-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("track.flac");
        fs::File::create(&audio).unwrap();
        let sidecar = dir.join("track.lrc");
        fs::write(&sidecar, "[00:01.00] Old").unwrap();

        sync_sidecar(&audio, None).expect("remove sidecar");
        assert!(!sidecar.exists());

        fs::write(&sidecar, "[00:01.00] Old").unwrap();
        let plain = TrackLyricsInput {
            format: LyricsFormat::Plain,
            source: Some(LyricsSource::Manual),
            lines: vec![LyricsLine {
                text: "Plain only".to_string(),
                start_ms: None,
                end_ms: None,
                words: None,
            }],
            plain_text: "Plain only".to_string(),
        };
        sync_sidecar(&audio, Some(&plain)).expect("remove plain sidecar");
        assert!(!sidecar.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn remove_sidecar_deletes_sibling_lrc() {
        let dir = std::env::temp_dir().join(format!("spiral-sidecar-delete-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("track.flac");
        fs::File::create(&audio).unwrap();
        let sidecar = dir.join("track.lrc");
        fs::write(&sidecar, "[00:01.00] Gone").unwrap();

        remove_sidecar(&audio).expect("remove sidecar");
        assert!(!sidecar.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn move_sidecar_follows_audio_file() {
        let dir = std::env::temp_dir().join(format!("spiral-sidecar-move-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let from = dir.join("old").join("song.mp3");
        fs::create_dir_all(from.parent().unwrap()).unwrap();
        fs::File::create(&from).unwrap();
        let sidecar_from = dir.join("old").join("song.lrc");
        fs::write(&sidecar_from, "[00:01.00] Moved").unwrap();

        let dest = dir.join("new").join("song.mp3");
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        move_sidecar(&from, &dest);

        assert!(!sidecar_from.exists());
        assert_eq!(
            fs::read_to_string(dir.join("new").join("song.lrc")).unwrap(),
            "[00:01.00] Moved"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_sidecar_duplicates_sibling_lrc() {
        let dir = std::env::temp_dir().join(format!("spiral-sidecar-copy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let from = dir.join("src").join("song.mp3");
        fs::create_dir_all(from.parent().unwrap()).unwrap();
        fs::File::create(&from).unwrap();
        fs::write(dir.join("src").join("song.lrc"), "[00:01.00] Copied\n").unwrap();

        let dest = dir.join("dest").join("song.mp3");
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        copy_sidecar(&from, &dest).expect("copy sidecar");

        let dest_sidecar = sidecar_path_for(&dest);
        assert!(dest_sidecar.is_file());
        assert_eq!(
            fs::read_to_string(&dest_sidecar).unwrap().trim(),
            "[00:01.00] Copied"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
