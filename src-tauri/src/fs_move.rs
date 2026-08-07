//! Same-volume rename with copy+remove fallback for cross-device moves (EXDEV).

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

/// Prefer `rename`; on cross-device (e.g. `/tmp` → library) fall back to copy + remove.
pub fn rename_or_copy_file(from: &Path, to: &Path) -> Result<(), String> {
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(err) if is_cross_device_rename_error(&err) => {
            fs::copy(from, to).map_err(|e| {
                format!(
                    "failed to copy {} → {}: {e}",
                    from.display(),
                    to.display()
                )
            })?;
            fs::remove_file(from).map_err(|e| {
                format!(
                    "failed to remove source after cross-device copy {}: {e}",
                    from.display()
                )
            })?;
            Ok(())
        }
        Err(err) => Err(format!("failed to move file: {err}")),
    }
}

fn is_cross_device_rename_error(err: &std::io::Error) -> bool {
    err.kind() == ErrorKind::CrossesDevices
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn detects_crosses_devices_kind() {
        assert!(is_cross_device_rename_error(&std::io::Error::from(
            ErrorKind::CrossesDevices
        )));
        assert!(!is_cross_device_rename_error(&std::io::Error::from(
            ErrorKind::PermissionDenied
        )));
    }

    #[test]
    fn rename_or_copy_file_same_volume() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("spiral-fs-move-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let from = dir.join("from").join("song.m4a");
        let to = dir.join("to").join("song.m4a");
        fs::create_dir_all(from.parent().unwrap()).unwrap();
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        fs::write(&from, b"aac-bytes").unwrap();

        rename_or_copy_file(&from, &to).unwrap();
        assert!(to.is_file());
        assert!(!from.exists());
        assert_eq!(fs::read(&to).unwrap(), b"aac-bytes");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_or_copy_file_across_temp_and_home() {
        // On Linux, `/tmp` is often tmpfs and distinct from the project/home disk.
        // When it is, this exercises the EXDEV copy+remove fallback that convert hits.
        let from = std::env::temp_dir().join(format!(
            "spiral-exdev-from-{}-{}.m4a",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        if let Err(err) = fs::write(&from, b"cross-device") {
            eprintln!(
                "skipping cross-device move test: cannot write {}: {err}",
                from.display()
            );
            return;
        }
        let to_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("spiral-exdev-test");
        let _ = fs::create_dir_all(&to_dir);
        let to = to_dir.join(format!("exdev-to-{}.m4a", std::process::id()));
        let _ = fs::remove_file(&to);

        rename_or_copy_file(&from, &to).unwrap();
        assert!(to.is_file());
        assert!(!from.exists());
        assert_eq!(fs::read(&to).unwrap(), b"cross-device");

        let _ = fs::remove_file(&to);
        let _ = fs::remove_dir(&to_dir);
    }
}
