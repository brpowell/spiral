//! Resolve a network-location URI a Linux file manager's drag-drop or picker
//! handed over (`smb://…`, `sftp://…`, …) to the real local path backing it,
//! trying each way a Linux desktop exposes one:
//!
//! - GVFS (GNOME): its FUSE bridge (`gvfsd-fuse`), when it has the share
//!   mounted, exposes it under `$XDG_RUNTIME_DIR/gvfs/<scheme>-share:server=
//!   <host>,share=<share>/…` — found by that naming convention.
//! - KIO (KDE): `kio-fuse`'s mount directory is named randomly per session, so
//!   there's no convention to match; instead, its `org.kde.KIOFuse.VFS`
//!   session D-Bus service is asked to mount the URL (the same thing KIO
//!   itself does internally), which mounts it on demand if it wasn't already
//!   and reports back the local path.
//!
//! Tauri's own URI decoding (inside its `wry` dependency) only strips a
//! `file://` prefix and percent-decodes what's left; any other scheme passes
//! through unchanged, which is what reaches this module.

use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use std::time::Duration;

#[cfg(target_os = "linux")]
const NETWORK_SCHEMES: &[&str] = &["smb", "sftp", "ftp", "dav", "davs", "afp", "nfs"];

/// How long to wait for kio-fuse to mount a share before giving up; it can
/// genuinely take a few seconds (DNS lookup, auth, …), but must stay bounded
/// since this runs on the import path for every dropped network file.
#[cfg(target_os = "linux")]
const KIO_FUSE_TIMEOUT: Duration = Duration::from_secs(5);

/// `path` unchanged, unless it is a network-location URI that resolves to a
/// real, existing local path; then, that local path.
#[cfg(target_os = "linux")]
pub fn resolve_dropped_path(path: &str) -> PathBuf {
    if let Some(resolved) = resolve_via_gvfs(path).filter(|p| p.exists()) {
        return resolved;
    }
    if let Some(resolved) = resolve_via_kio_fuse(path).filter(|p| p.exists()) {
        return resolved;
    }
    PathBuf::from(path)
}

#[cfg(not(target_os = "linux"))]
pub fn resolve_dropped_path(path: &str) -> PathBuf {
    PathBuf::from(path)
}

// --- GVFS (GNOME) ---

#[cfg(target_os = "linux")]
fn resolve_via_gvfs(path: &str) -> Option<PathBuf> {
    let root = std::env::var_os("XDG_RUNTIME_DIR").map(|dir| PathBuf::from(dir).join("gvfs"))?;
    resolve_gvfs_uri(path, &root)
}

/// `path` as `<scheme>://[user@]host[:port]/[share/[rest...]]`, resolved
/// against the GVFS FUSE mounts under `mount_root`.
#[cfg(target_os = "linux")]
fn resolve_gvfs_uri(path: &str, mount_root: &Path) -> Option<PathBuf> {
    let (scheme, rest) = path.split_once("://")?;
    if !NETWORK_SCHEMES.contains(&scheme) {
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

    let mut resolved = find_gvfs_mount_dir(mount_root, scheme, host, share)?;
    if !file_rest.is_empty() {
        resolved.push(file_rest);
    }
    Some(resolved)
}

/// The entry directly under `root` named `<scheme>-share:server=<host>[,share=<share>]…`
/// — GVFS's own naming convention for a FUSE-mounted share — matched
/// case-insensitively since server/share names aren't case sensitive on SMB.
#[cfg(target_os = "linux")]
fn find_gvfs_mount_dir(root: &Path, scheme: &str, host: &str, share: &str) -> Option<PathBuf> {
    let prefix = format!("{scheme}-share:");
    for entry in fs::read_dir(root).ok()?.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(params) = name.strip_prefix(&prefix) else {
            continue;
        };
        if gvfs_mount_params_match(params, host, share) {
            return Some(entry.path());
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn gvfs_mount_params_match(params: &str, host: &str, share: &str) -> bool {
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

// --- KIO (KDE) ---

/// Asks kio-fuse to mount `path` (mounting it on demand if it wasn't already)
/// over the same session D-Bus `org.kde.KIOFuse.VFS` service KIO itself uses
/// for this, and returns the local path it reports back. `None` when the
/// scheme isn't one kio-fuse handles, the service can't be reached (not a KDE
/// session, or kio-fuse isn't installed), or the request doesn't finish
/// within [`KIO_FUSE_TIMEOUT`] — a dead or unreachable share can otherwise
/// hang the call far longer than an import should wait.
#[cfg(target_os = "linux")]
fn resolve_via_kio_fuse(path: &str) -> Option<PathBuf> {
    let (scheme, _) = path.split_once("://")?;
    if !NETWORK_SCHEMES.contains(&scheme) {
        return None;
    }
    let url = path.to_string();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(mount_via_kio_fuse(&url));
    });
    rx.recv_timeout(KIO_FUSE_TIMEOUT).ok().flatten()
}

#[cfg(target_os = "linux")]
fn mount_via_kio_fuse(url: &str) -> Option<PathBuf> {
    let connection = zbus::blocking::Connection::session().ok()?;
    let reply = connection
        .call_method(
            Some("org.kde.KIOFuse"),
            "/org/kde/KIOFuse",
            Some("org.kde.KIOFuse.VFS"),
            "mountUrl",
            &(url,),
        )
        .ok()?;
    let local_path: String = reply.body().deserialize().ok()?;
    Some(PathBuf::from(local_path))
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("spiral-network-uri-{name}-{}", std::process::id()));
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

        let resolved = resolve_gvfs_uri("smb://nas.local/Music/Artist/Song.mp3", &root)
            .expect("should resolve");
        assert_eq!(resolved, mount.join("Artist/Song.mp3"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn matches_server_and_share_case_insensitively() {
        let root = temp_root("case");
        let mount = root.join("smb-share:server=NAS.local,share=MUSIC");
        fs::create_dir_all(&mount).unwrap();

        let resolved =
            resolve_gvfs_uri("smb://nas.local/music/track.mp3", &root).expect("should resolve");
        assert_eq!(resolved, mount.join("track.mp3"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn decodes_percent_encoded_segments() {
        let root = temp_root("percent");
        let mount = root.join("smb-share:server=nas.local,share=Music");
        fs::create_dir_all(&mount).unwrap();

        let resolved = resolve_gvfs_uri("smb://nas.local/Music/My%20Song.mp3", &root).unwrap();
        assert_eq!(resolved, mount.join("My Song.mp3"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn strips_userinfo_and_port_from_the_host() {
        let root = temp_root("userinfo");
        let mount = root.join("smb-share:server=nas.local,share=Music");
        fs::create_dir_all(&mount).unwrap();

        let resolved = resolve_gvfs_uri("smb://me@nas.local:445/Music/track.mp3", &root).unwrap();
        assert_eq!(resolved, mount.join("track.mp3"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn returns_none_for_an_unmounted_share() {
        let root = temp_root("unmounted");
        assert!(resolve_gvfs_uri("smb://nas.local/Music/track.mp3", &root).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn returns_none_for_non_network_schemes() {
        let root = temp_root("other-scheme");
        assert!(resolve_gvfs_uri("https://example.com/track.mp3", &root).is_none());
        assert!(resolve_gvfs_uri("/already/a/local/path.mp3", &root).is_none());
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
        // Neither GVFS (no matching mount) nor kio-fuse (service absent, or
        // present but this host doesn't exist) can resolve this.
        assert_eq!(
            resolve_dropped_path("smb://nowhere.invalid/share/track.mp3"),
            PathBuf::from("smb://nowhere.invalid/share/track.mp3")
        );
    }

    #[test]
    fn resolve_via_kio_fuse_returns_none_for_non_network_schemes() {
        assert!(resolve_via_kio_fuse("https://example.com/track.mp3").is_none());
        assert!(resolve_via_kio_fuse("/already/a/local/path.mp3").is_none());
    }
}
