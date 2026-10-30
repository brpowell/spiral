//! What the webview may reach on disk.
//!
//! Three groups of paths are in scope: app-owned folders (app data, cache, the
//! bundled items), the library (its root, tracks and artwork folders, and
//! linked item folders), and whatever the user picked or dropped this session.
//! The same set feeds the asset protocol scope and the checks in commands that
//! take a path from the frontend, so a script running in the webview can't use
//! either to read or copy files from elsewhere.
//!
//! Library folders can live anywhere, so they are added at runtime instead of
//! in `tauri.conf.json`. A folder stays in scope until the app quits, even if
//! the library moves away from it.

use crate::packs;
use crate::settings;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::RwLock;
use tauri::{AppHandle, Manager};

/// Prefix of the folders `zip_import` extracts into, directly inside the temp dir.
const ZIP_IMPORT_DIR_PREFIX: &str = "spiral-zip-import-";

#[derive(Default)]
pub struct PathScope(RwLock<ScopeSet>);

#[derive(Default)]
struct ScopeSet {
    dirs: Vec<PathBuf>,
    files: HashSet<PathBuf>,
    temp_dir: Option<PathBuf>,
}

impl ScopeSet {
    fn allow_dir(&mut self, dir: &Path) {
        for form in path_forms(dir) {
            if !self.dirs.contains(&form) {
                self.dirs.push(form);
            }
        }
    }

    fn allow_file(&mut self, file: &Path) {
        self.files.extend(path_forms(file));
    }

    fn contains(&self, path: &Path) -> bool {
        let Some(path) = resolve(path) else {
            return false;
        };
        self.files.contains(&path)
            || self.dirs.iter().any(|dir| path.starts_with(dir))
            || self
                .temp_dir
                .as_deref()
                .is_some_and(|temp| is_in_zip_import_dir(temp, &path))
    }
}

/// `path` as given and with symlinks resolved, so a check matches either spelling
/// (`/var` and `/private/var` on macOS). Empty when `path` is relative or has `..`.
pub(crate) fn path_forms(path: &Path) -> Vec<PathBuf> {
    if !is_plain_absolute(path) {
        return Vec::new();
    }
    let mut forms = vec![path.to_path_buf()];
    if let Some(resolved) = resolve(path) {
        if resolved != path {
            forms.push(resolved);
        }
    }
    forms
}

fn is_plain_absolute(path: &Path) -> bool {
    path.is_absolute()
        && path
            .components()
            .all(|c| !matches!(c, Component::ParentDir | Component::CurDir))
}

/// Resolve symlinks for the check. A path that doesn't exist yet resolves through
/// its parent, so `file_exists` can still answer for a missing library track.
fn resolve(path: &Path) -> Option<PathBuf> {
    if !is_plain_absolute(path) {
        return None;
    }
    if let Ok(canonical) = path.canonicalize() {
        return Some(canonical);
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => {
            let parent = parent
                .canonicalize()
                .unwrap_or_else(|_| parent.to_path_buf());
            Some(parent.join(name))
        }
        _ => Some(path.to_path_buf()),
    }
}

/// Inside `<temp>/spiral-zip-import-*/`, where zip imports are extracted.
fn is_in_zip_import_dir(temp: &Path, path: &Path) -> bool {
    let Ok(rest) = path.strip_prefix(temp) else {
        return false;
    };
    rest.components().nth(1).is_some()
        && rest
            .components()
            .next()
            .and_then(|c| match c {
                Component::Normal(name) => name.to_str(),
                _ => None,
            })
            .is_some_and(|name| name.starts_with(ZIP_IMPORT_DIR_PREFIX))
}

/// Register the scope and add the app and library folders. Call before any
/// window loads.
pub fn init(app: &AppHandle) {
    app.manage(PathScope::default());
    {
        let scope = app.state::<PathScope>();
        let mut set = scope.0.write().unwrap_or_else(|e| e.into_inner());
        set.temp_dir = std::env::temp_dir().canonicalize().ok();
    }

    let path = app.path();
    let app_dirs = [
        settings::app_data_dir(app).ok(),
        path.app_local_data_dir().ok(),
        path.app_cache_dir().ok(),
        Some(packs::builtin_packs_root(app)),
    ];
    for dir in app_dirs.into_iter().flatten() {
        allow_dir(app, &dir);
    }
    allow_library_dirs(app);
}

/// Add the configured library folders and linked item folders. Call again after
/// the library moves or an item folder is linked.
pub fn allow_library_dirs(app: &AppHandle) {
    let library = settings::resolved_library_settings(app);
    for dir in [
        &library.library_root,
        &library.media_folder,
        &library.artwork_folder,
    ] {
        allow_dir(app, Path::new(dir));
    }
    for linked in settings::read_settings(app).linked_item_paths {
        allow_dir(app, Path::new(linked.trim()));
    }
}

pub fn allow_dir(app: &AppHandle, dir: &Path) {
    let forms = path_forms(dir);
    if forms.is_empty() {
        return;
    }
    if let Some(scope) = app.try_state::<PathScope>() {
        scope
            .0
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .allow_dir(dir);
    }
    for form in forms {
        if let Err(err) = app.asset_protocol_scope().allow_directory(&form, true) {
            eprintln!("asset scope: {err}");
        }
    }
}

pub fn allow_file(app: &AppHandle, file: &Path) {
    let forms = path_forms(file);
    if forms.is_empty() {
        return;
    }
    if let Some(scope) = app.try_state::<PathScope>() {
        scope
            .0
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .allow_file(file);
    }
    for form in forms {
        if let Err(err) = app.asset_protocol_scope().allow_file(&form) {
            eprintln!("asset scope: {err}");
        }
    }
}

/// Add paths the user chose in a picker or dropped on a window. Folders are
/// added whole, since their files are imported next.
pub fn allow_user_paths<P: AsRef<Path>>(app: &AppHandle, paths: &[P]) {
    for path in paths {
        let path = path.as_ref();
        if path.is_dir() {
            allow_dir(app, path);
        } else {
            allow_file(app, path);
        }
    }
}

pub fn is_allowed(app: &AppHandle, path: &Path) -> bool {
    app.try_state::<PathScope>().is_some_and(|scope| {
        scope
            .0
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .contains(path)
    })
}

/// `Err` unless `path` is in scope. For commands that take a path from the webview.
pub fn ensure_allowed(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if is_allowed(app, &path) {
        Ok(path)
    } else {
        Err(outside_scope_error(&path))
    }
}

pub fn outside_scope_error(path: &Path) -> String {
    format!(
        "path is outside the library and the files you picked: {}",
        path.display()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("spiral-path-scope-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn allows_paths_under_a_dir() {
        let root = temp_root("dir");
        fs::create_dir_all(root.join("library/Artwork")).unwrap();
        fs::write(root.join("library/Artwork/front.jpg"), b"x").unwrap();
        fs::write(root.join("secret.txt"), b"x").unwrap();

        let mut set = ScopeSet::default();
        set.allow_dir(&root.join("library"));

        assert!(set.contains(&root.join("library/Artwork/front.jpg")));
        // Missing files under the dir still match (file_exists for a moved track).
        assert!(set.contains(&root.join("library/Tracks/gone.mp3")));
        assert!(!set.contains(&root.join("secret.txt")));
        assert!(!set.contains(&root.join("library-other/a.jpg")));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_dot_dot_and_relative_paths() {
        let root = temp_root("dotdot");
        fs::create_dir_all(root.join("library")).unwrap();
        fs::write(root.join("secret.txt"), b"x").unwrap();

        let mut set = ScopeSet::default();
        set.allow_dir(&root.join("library"));

        assert!(!set.contains(&root.join("library/../secret.txt")));
        assert!(!set.contains(Path::new("library/a.jpg")));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn allows_only_the_picked_file() {
        let root = temp_root("file");
        fs::write(root.join("cover.jpg"), b"x").unwrap();
        fs::write(root.join("other.jpg"), b"x").unwrap();

        let mut set = ScopeSet::default();
        set.allow_file(&root.join("cover.jpg"));

        assert!(set.contains(&root.join("cover.jpg")));
        assert!(!set.contains(&root.join("other.jpg")));
        assert!(!set.contains(&root));

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_out_of_an_allowed_dir() {
        let root = temp_root("symlink");
        fs::create_dir_all(root.join("library")).unwrap();
        fs::write(root.join("secret.txt"), b"x").unwrap();
        std::os::unix::fs::symlink(root.join("secret.txt"), root.join("library/link.jpg")).unwrap();

        let mut set = ScopeSet::default();
        set.allow_dir(&root.join("library"));

        assert!(!set.contains(&root.join("library/link.jpg")));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn allows_files_inside_zip_import_dirs_only() {
        let temp = Path::new("/tmp-test");
        assert!(is_in_zip_import_dir(
            temp,
            Path::new("/tmp-test/spiral-zip-import-abc/disc/01.mp3")
        ));
        assert!(!is_in_zip_import_dir(
            temp,
            Path::new("/tmp-test/spiral-zip-import-abc")
        ));
        assert!(!is_in_zip_import_dir(
            temp,
            Path::new("/tmp-test/other/spiral-zip-import-abc/01.mp3")
        ));
        assert!(!is_in_zip_import_dir(
            temp,
            Path::new("/tmp-test/secret.txt")
        ));
    }
}
