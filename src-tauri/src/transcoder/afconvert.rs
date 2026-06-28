use std::path::Path;
use std::process::Command;

use super::error;

const DECODE_TO_WAV_ARGS: &[&str] = &["-f", "WAVE", "-d", "LEI16", "-c", "2"];

pub fn run(source: &Path, dest: &Path, args: &[&str]) -> Result<(), String> {
    let mut command = Command::new("afconvert");
    command.arg(source).arg(dest);
    for arg in args {
        command.arg(arg);
    }

    let output = command
        .output()
        .map_err(|err| format!("Failed to run afconvert: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(error::format_afconvert_failure(source, &stderr));
    }

    if !dest.is_file() {
        return Err(error::format_missing_output(dest));
    }

    Ok(())
}

pub fn decode_to_wav(source: &Path, dest_wav: &Path) -> Result<(), String> {
    run(source, dest_wav, DECODE_TO_WAV_ARGS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_to_wav_uses_stereo_pcm_wave() {
        assert_eq!(
            DECODE_TO_WAV_ARGS,
            &["-f", "WAVE", "-d", "LEI16", "-c", "2"]
        );
    }
}
