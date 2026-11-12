//! Resolve a network-location URI a Linux file manager's drag-drop or picker
//! handed over (`smb://…`, `sftp://…`, …) to the real path GVFS mounted it at.
//!
//! Tauri's own URI decoding (inside its `wry` dependency) only strips a
//! `file://` prefix and percent-decodes what's left; any other scheme passes
//! through unchanged. When GVFS's FUSE bridge (`gvfsd-fuse`, on by default on
//! GNOME; not every desktop runs it) has the share mounted, the real path
//! sits under `$XDG_RUNTIME_DIR/gvfs/<scheme>-share:server=<host>,share=<share>/…`
//! — this module finds it by that naming convention, so those drops resolve
//! like any other path instead of being silently rejected as out of scope.

use std::fs;
use std::path::{Path, PathBuf};

#[cfg(target_os = "linux")]
const GVFS_SCHEMES: &[&str] = &["smb", "sftp", "ftp", "dav", "davs", "afp", "nfs"];

/// `path` unchanged, unless it is a GVFS-mountable URI that resolves to a
/// real, existing path under the FUSE bridge; then, that real path.
#[cfg(target_os = "linux")]
pub fn resolve_dropped_path(path: &str) -> PathBuf {
    let resolved = std::env::var_os("XDG_RUNTIME_DIR")
        .map(|dir| PathBuf::from(dir).join("gvfs"))
        .and_then(|root| resolve_uri(path, &root));
    match resolved {
        Some(resolved) if resolved.exists() => resolved,
        _ => PathBuf::from(path),
    }
}

#[cfg(not(target_os = "linux"))]
pub fn resolve_dropped_path(path: &str) -> PathBuf {
    PathBuf::from(path)
}

/// `path` as `<scheme>://[user@]host[:port]/[share/[rest...]]`, resolved
/// against the GVFS FUSE mounts under `mount_root`.
#[cfg(target_os = "linux")]
fn resolve_uri(path: &str, mount_root: &Path) -> Option<PathBuf> {
    let (scheme, rest) = path.split_once("://")?;
    if !GVFS_SCHEMES.contains(&scheme) {
        return None;
    }
    let decoded = percent_decode(rest);
    let mut parts = decoded.splitn(2, '/');
    let authority = parts.next()?;
    let share_and_rest = parts.next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host);
    let (share, file_rest) = share_and_rest
        .split_once('/')
        .unwrap_or((share_and_rest, ""));

    let mut resolved = find_mount_dir(mount_root, scheme, host, share)?;
    if !file_rest.is_empty() {
        resolved.push(file_rest);
    }
    Some(resolved)
}

/// The entry directly under `root` named `<scheme>-share:server=<host>[,share=<share>]…`
/// — GVFS's own naming convention for a FUSE-mounted share — matched
/// case-insensitively since server/share names aren't case sensitive on SMB.
#[cfg(target_os = "linux")]
fn find_mount_dir(root: &Path, scheme: &str, host: &str, share: &str) -> Option<PathBuf> {
    let prefix = format!("{scheme}-share:");
    for entry in fs::read_dir(root).ok()?.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(params) = name.strip_prefix(&prefix) else {
            continue;
        };
        if mount_params_match(params, host, share) {
            return Some(entry.path());
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn mount_params_match(params: &str, host: &str, share: &str) -> bool {
    let mut server_matches = false;
    let mut share_matches = share.is_empty();
    for param in params.split(',') {
        if let Some(value) = param.strip_prefix("server=") {
            server_matches = value.eq_ignore_ascii_case(host);
        } else if let Some(value) = param.strip_prefix("share=") {
            share_matches = value.eq_ignore_ascii_case(share);
        }
    }
    server_matches && share_matches
}

/// `%XX` escapes decoded back to bytes; invalid UTF-8 falls back lossily,
/// since a GVFS mount name is expected to be plain text either way.
#[cfg(target_os = "linux")]
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("spiral-gvfs-uri-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn resolves_smb_uri_to_its_gvfs_mount() {
        let root = temp_root("smb");
        let mount = root.join("smb-share:server=nas.local,share=Music");
        fs::create_dir_all(mount.join("Artist")).unwrap();
        fs::write(mount.join("Artist/Song.mp3"), b"x").unwrap();

        let resolved =
            resolve_uri("smb://nas.local/Music/Artist/Song.mp3", &root).expect("should resolve");
        assert_eq!(resolved, mount.join("Artist/Song.mp3"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn matches_server_and_share_case_insensitively() {
        let root = temp_root("case");
        let mount = root.join("smb-share:server=NAS.local,share=MUSIC");
        fs::create_dir_all(&mount).unwrap();

        let resolved =
            resolve_uri("smb://nas.local/music/track.mp3", &root).expect("should resolve");
        assert_eq!(resolved, mount.join("track.mp3"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn decodes_percent_encoded_segments() {
        let root = temp_root("percent");
        let mount = root.join("smb-share:server=nas.local,share=Music");
        fs::create_dir_all(&mount).unwrap();

        let resolved = resolve_uri("smb://nas.local/Music/My%20Song.mp3", &root).unwrap();
        assert_eq!(resolved, mount.join("My Song.mp3"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn strips_userinfo_and_port_from_the_host() {
        let root = temp_root("userinfo");
        let mount = root.join("smb-share:server=nas.local,share=Music");
        fs::create_dir_all(&mount).unwrap();

        let resolved = resolve_uri("smb://me@nas.local:445/Music/track.mp3", &root).unwrap();
        assert_eq!(resolved, mount.join("track.mp3"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn returns_none_for_an_unmounted_share() {
        let root = temp_root("unmounted");
        assert!(resolve_uri("smb://nas.local/Music/track.mp3", &root).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn returns_none_for_non_gvfs_schemes() {
        let root = temp_root("other-scheme");
        assert!(resolve_uri("https://example.com/track.mp3", &root).is_none());
        assert!(resolve_uri("/already/a/local/path.mp3", &root).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_dropped_path_leaves_a_plain_path_unchanged() {
        assert_eq!(
            resolve_dropped_path("/home/user/Music/track.mp3"),
            PathBuf::from("/home/user/Music/track.mp3")
        );
    }

    #[test]
    fn resolve_dropped_path_falls_back_when_unresolvable() {
        assert_eq!(
            resolve_dropped_path("smb://nowhere.invalid/share/track.mp3"),
            PathBuf::from("smb://nowhere.invalid/share/track.mp3")
        );
    }
}
