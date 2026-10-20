//! Directory-walking item scanner over builtin / installed / linked zones.
//!
//! Items are discovered by scanning fixed type folders (`themes/`, `skins/`,
//! `visualizers/`, `sounds/`) under each managed zone root (builtin, installed). Each item
//! directory there is named `<publisherId>.<id>` and holds the type's manifest at its root.
//! Linked items are single folders listed in settings, with any name, anywhere.

use super::paths;
use super::{item_dir_name, item_type_folder, read_item_manifest, ItemManifest, PackZone};
use crate::activity_log::{self, LogLevel};
use crate::settings;
use spk_format::list_item_dirs;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// Matches frontend `LINKED_PACKS_CHANGED_EVENT` — menu / UI refresh after auto-unlink.
const LINKED_PACKS_CHANGED_EVENT: &str = "packs://linked-changed";

/// Serializes missing-path prune so parallel theme/skin/visualizer scans log once.
static LINKED_PATH_PRUNE_LOCK: Mutex<()> = Mutex::new(());

/// App semver used for `minAppVersion` checks (Cargo package version).
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// One item discovered by the scanner.
#[derive(Debug, Clone)]
pub struct ScannedContribution {
    pub zone: PackZone,
    pub r#type: String,
    pub publisher_id: String,
    /// Declared item id from the item manifest.
    pub local_id: String,
    /// `publisherId.type.id`.
    pub effective_id: String,
    pub version: String,
    pub name: String,
    /// Directory containing the item manifest.
    pub contribution_dir: PathBuf,
    pub manifest_path: PathBuf,
    pub mutable: bool,
}

#[derive(Debug, Clone)]
pub struct ScanWarning {
    pub message: String,
}

#[derive(Debug, Default, Clone)]
pub struct ScanResult {
    pub contributions: Vec<ScannedContribution>,
    pub warnings: Vec<ScanWarning>,
}

fn zone_priority(zone: PackZone) -> u8 {
    match zone {
        PackZone::Builtin => 0,
        PackZone::Installed => 1,
        PackZone::Linked => 2,
    }
}

/// Whether `incoming` should replace `existing` for the same effective id.
fn should_replace_contribution(
    existing: &ScannedContribution,
    incoming: &ScannedContribution,
) -> bool {
    let existing_priority = zone_priority(existing.zone);
    let incoming_priority = zone_priority(incoming.zone);
    match incoming_priority.cmp(&existing_priority) {
        Ordering::Greater => true,
        Ordering::Less => false,
        Ordering::Equal => !matches!(
            version_cmp(&incoming.version, &existing.version),
            Some(Ordering::Less)
        ),
    }
}

/// Compare permissive MAJOR.MINOR.PATCH semver (pre-release ignored for floor checks).
pub fn version_cmp(a: &str, b: &str) -> Option<Ordering> {
    fn parse_core(v: &str) -> Option<(u64, u64, u64)> {
        let core = v.split(['-', '+']).next().unwrap_or(v);
        let mut parts = core.split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next()?.parse().ok()?;
        let patch = parts.next()?.parse().ok()?;
        Some((major, minor, patch))
    }
    Some(parse_core(a)?.cmp(&parse_core(b)?))
}

pub fn meets_min_app_version(min_app_version: &str, current: &str) -> bool {
    match version_cmp(current, min_app_version) {
        Some(Ordering::Less) => false,
        Some(_) => true,
        None => false,
    }
}

/// Peek an item folder's effective id (`publisherId.type.id`) from its manifest.
pub(crate) fn peek_item_effective_id(item_dir: &Path) -> Result<String, String> {
    read_item_manifest(item_dir).map(|item| item.effective_id())
}

fn contribution_from_manifest(
    item: ItemManifest,
    dir: &Path,
    zone: PackZone,
) -> ScannedContribution {
    let manifest_filename =
        super::item_manifest_filename(&item.item_type).expect("manifest parsed for a known type");
    ScannedContribution {
        zone,
        effective_id: item.effective_id(),
        manifest_path: dir.join(manifest_filename),
        contribution_dir: dir.to_path_buf(),
        r#type: item.item_type,
        publisher_id: item.publisher_id,
        local_id: item.id,
        version: item.version,
        name: item.name,
        mutable: zone.is_editable(),
    }
}

/// Scan one item directory. `folder_type` is the type implied by the containing type
/// folder (absent for linked items, which live anywhere).
pub(crate) fn scan_item_dir(
    dir: &Path,
    folder_type: Option<&str>,
    zone: PackZone,
    warnings: &mut Vec<ScanWarning>,
) -> Option<ScannedContribution> {
    let item = match read_item_manifest(dir) {
        Ok(item) => item,
        Err(e) => {
            warnings.push(ScanWarning {
                message: format!("invalid item at {}: {e}", dir.display()),
            });
            return None;
        }
    };

    if let Some(expected) = folder_type {
        if item.item_type != expected {
            warnings.push(ScanWarning {
                message: format!(
                    "{} is a {} but sits in the {} folder; skipping",
                    dir.display(),
                    item.item_type,
                    item_type_folder(expected).unwrap_or("?")
                ),
            });
            return None;
        }
        let expected_dir = item_dir_name(&item.publisher_id, &item.id);
        let actual = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if actual != expected_dir {
            warnings.push(ScanWarning {
                message: format!(
                    "{} should be named \"{expected_dir}\" to match its publisherId and id; skipping",
                    dir.display()
                ),
            });
            return None;
        }
    }

    if let Some(min) = &item.min_app_version {
        if !meets_min_app_version(min, app_version()) {
            warnings.push(ScanWarning {
                message: format!(
                    "{} \"{}\" requires minAppVersion {min} (app is {}); skipping",
                    item.item_type,
                    item.id,
                    app_version()
                ),
            });
            return None;
        }
    }

    Some(contribution_from_manifest(item, dir, zone))
}

pub(crate) fn scan_zone_root(
    root: &Path,
    zone: PackZone,
    warnings: &mut Vec<ScanWarning>,
) -> Vec<ScannedContribution> {
    if !root.is_dir() {
        return vec![];
    }
    list_item_dirs(root)
        .into_iter()
        .filter_map(|(ty, dir)| scan_item_dir(&dir, Some(ty), zone, warnings))
        .collect()
}

fn merge_contribution(
    by_id: &mut HashMap<String, ScannedContribution>,
    contrib: ScannedContribution,
) {
    match by_id.get(&contrib.effective_id) {
        Some(existing) if !should_replace_contribution(existing, &contrib) => {}
        _ => {
            by_id.insert(contrib.effective_id.clone(), contrib);
        }
    }
}

/// Drop linked item paths that are missing (or not directories) from settings.
/// Logs each removal once as an activity-log warning so scans do not keep retrying.
fn prune_missing_linked_item_paths(app: &AppHandle) {
    let _guard = LINKED_PATH_PRUNE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let mut app_settings = settings::read_settings(app);
    let mut removed: Vec<String> = Vec::new();
    app_settings.linked_item_paths.retain(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return true;
        }
        if PathBuf::from(trimmed).is_dir() {
            true
        } else {
            removed.push(trimmed.to_string());
            false
        }
    });

    if removed.is_empty() {
        return;
    }

    if let Err(e) = settings::write_settings(app, &app_settings) {
        activity_log::log(
            LogLevel::Error,
            "pack.scan",
            format!("failed to unlink missing linked item paths: {e}"),
            None,
        );
        return;
    }

    for path in &removed {
        activity_log::log(
            LogLevel::Warn,
            "pack.scan",
            format!("Linked item path not found or not a directory; unlinked: {path}"),
            Some(serde_json::json!({ "path": path })),
        );
    }

    let _ = app.emit(LINKED_PACKS_CHANGED_EVENT, ());
}

/// Items installed under `installed/`, ignoring zone priority. A linked item with the
/// same effective id does not hide the installed copy here, so registry updates still see it.
pub fn list_installed_items(app: &AppHandle) -> Vec<ScannedContribution> {
    let Ok(root) = paths::installed_packs_root(app) else {
        return Vec::new();
    };
    scan_zone_root(&root, PackZone::Installed, &mut Vec::new())
}

/// Scan all zones. On effective-id collision, higher-priority zone wins
/// (linked > installed > builtin). Every user-owned item is a linked path, including the ones
/// created in the Library's `Packs` folder.
pub fn scan_all_items(app: &AppHandle) -> ScanResult {
    let mut warnings = Vec::new();
    let mut by_id: HashMap<String, ScannedContribution> = HashMap::new();

    prune_missing_linked_item_paths(app);

    let zones = [
        (PackZone::Builtin, paths::builtin_packs_root(app)),
        (
            PackZone::Installed,
            paths::installed_packs_root(app).unwrap_or_default(),
        ),
    ];

    // Scan lowest priority first so higher priority overwrites.
    for (zone, root) in zones {
        if root.as_os_str().is_empty() {
            continue;
        }
        for contrib in scan_zone_root(&root, zone, &mut warnings) {
            merge_contribution(&mut by_id, contrib);
        }
    }

    for raw in settings::read_settings(app).linked_item_paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = PathBuf::from(trimmed);
        // Pruned above; skip quietly if a failed write left a stale entry.
        if !path.is_dir() {
            continue;
        }
        let Some(contrib) = scan_item_dir(&path, None, PackZone::Linked, &mut warnings) else {
            continue;
        };
        merge_contribution(&mut by_id, contrib);
    }

    let mut contributions: Vec<_> = by_id.into_values().collect();
    contributions.sort_by(|a, b| {
        a.r#type
            .cmp(&b.r#type)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.effective_id.cmp(&b.effective_id))
    });

    ScanResult {
        contributions,
        warnings,
    }
}

pub fn scan_contributions_of_type(app: &AppHandle, contrib_type: &str) -> ScanResult {
    let mut result = scan_all_items(app);
    result.contributions.retain(|c| c.r#type == contrib_type);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packs::effective_item_id;
    use std::fs;

    fn contrib(zone: PackZone, version: &str, dir: &str) -> ScannedContribution {
        ScannedContribution {
            zone,
            r#type: "theme".into(),
            publisher_id: "bryan".into(),
            local_id: "demo".into(),
            effective_id: effective_item_id("bryan", "theme", "demo"),
            version: version.into(),
            name: "Demo".into(),
            contribution_dir: PathBuf::from(dir),
            manifest_path: PathBuf::from(dir).join("theme.json"),
            mutable: zone.is_editable(),
        }
    }

    fn temp_root(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("spiral-scan-{label}-{nanos}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write_theme(dir: &Path, author: &str, id: &str, version: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join("theme.json"),
            serde_json::json!({
                "id": id,
                "publisherId": author,
                "version": version,
                "name": format!("Theme {id}"),
                "tokens": {}
            })
            .to_string(),
        )
        .unwrap();
    }

    #[test]
    fn min_app_version_floor() {
        assert!(meets_min_app_version("0.1.0", "0.1.0"));
        assert!(meets_min_app_version("0.1.0", "1.0.0"));
        assert!(!meets_min_app_version("2.0.0", "1.0.0"));
        assert!(!meets_min_app_version("not-semver", "1.0.0"));
    }

    #[test]
    fn scan_builtin_items_from_manifest_dir() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("packs/builtin");
        let mut warnings = Vec::new();
        let items = scan_zone_root(&root, PackZone::Builtin, &mut warnings);
        for w in &warnings {
            eprintln!("scan warning: {}", w.message);
        }
        assert!(warnings.is_empty(), "builtin items must scan clean");
        let of_type = |ty: &str| items.iter().filter(|c| c.r#type == ty).collect::<Vec<_>>();
        let has = |ty: &str, id: &str| of_type(ty).iter().any(|c| c.effective_id == id);
        assert!(has("theme", "spiral.theme.obsidian"));
        assert!(has("theme", "spiral.theme.sprig"));
        assert!(has("skin", "spiral.skin.vanilla"));
        assert!(has("visualizer", "spiral.visualizer.bars"));
        assert!(has("visualizer", "spiral.visualizer.dream-cube"));
        assert!(has("sound", "spiral.sound.default"));
        assert_eq!(of_type("theme").len(), 8, "expected 8 builtin themes");
        assert_eq!(of_type("skin").len(), 1, "expected 1 builtin skin");
        assert_eq!(
            of_type("visualizer").len(),
            6,
            "expected 6 builtin visualizers"
        );
        assert_eq!(of_type("sound").len(), 1, "expected 1 builtin sound pack");
    }

    #[test]
    fn every_builtin_item_passes_install_validation() {
        // Builtins are never installed, so nothing else holds them to the install rules.
        // A rule stricter than what the app itself ships (or authors) breaks export.
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("packs/builtin");
        for (_, dir) in list_item_dirs(&root) {
            crate::packs::install::validate_item_for_install(&dir)
                .unwrap_or_else(|e| panic!("builtin {} should validate: {e}", dir.display()));
        }
    }

    #[test]
    fn library_item_wins_over_builtin() {
        let mut by_id = HashMap::new();
        for c in [
            contrib(PackZone::Builtin, "1.0.0", "/builtin/themes/bryan.demo"),
            contrib(
                PackZone::Linked,
                "0.0.0",
                "/library/Packs/themes/bryan.demo",
            ),
        ] {
            merge_contribution(&mut by_id, c);
        }
        let winner = &by_id["bryan.theme.demo"];
        assert_eq!(winner.zone, PackZone::Linked);
        assert!(winner.mutable);
    }

    #[test]
    fn linked_beats_installed() {
        let mut by_id = HashMap::new();
        for c in [
            contrib(PackZone::Installed, "1.0.0", "/installed/themes/bryan.demo"),
            contrib(PackZone::Linked, "0.0.1", "/repos/demo"),
        ] {
            merge_contribution(&mut by_id, c);
        }
        assert_eq!(by_id["bryan.theme.demo"].zone, PackZone::Linked);
    }

    #[test]
    fn newer_version_wins_within_zone() {
        let mut by_id = HashMap::new();
        for c in [
            contrib(PackZone::Linked, "1.1.0", "/a"),
            contrib(PackZone::Linked, "1.0.0", "/b"),
        ] {
            merge_contribution(&mut by_id, c);
        }
        assert_eq!(by_id["bryan.theme.demo"].version, "1.1.0");
    }

    #[test]
    fn scan_zone_root_reads_items_and_warns_on_misplaced() {
        let root = temp_root("zone");
        write_theme(&root.join("themes/bryan.good"), "bryan", "good", "1.0.0");
        // Wrong directory name.
        write_theme(
            &root.join("themes/whatever"),
            "bryan",
            "named-wrong",
            "1.0.0",
        );
        // Theme sitting in the skins folder.
        write_theme(&root.join("skins/bryan.lost"), "bryan", "lost", "1.0.0");

        let mut warnings = Vec::new();
        let items = scan_zone_root(&root, PackZone::Installed, &mut warnings);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].effective_id, "bryan.theme.good");
        assert_eq!(items[0].name, "Theme good");
        assert_eq!(warnings.len(), 2, "{warnings:?}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_item_dir_skips_items_needing_a_newer_app() {
        let root = temp_root("minapp");
        let dir = root.join("themes/bryan.future");
        write_theme(&dir, "bryan", "future", "1.0.0");
        let manifest = fs::read_to_string(dir.join("theme.json")).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        value["minAppVersion"] = "999.0.0".into();
        fs::write(dir.join("theme.json"), value.to_string()).unwrap();

        let mut warnings = Vec::new();
        assert!(scan_item_dir(&dir, Some("theme"), PackZone::Installed, &mut warnings).is_none());
        assert!(warnings[0].message.contains("minAppVersion"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn linked_item_dir_may_have_any_name() {
        let root = temp_root("linked");
        let dir = root.join("my-repo");
        write_theme(&dir, "bryan", "linked", "0.1.0");
        let mut warnings = Vec::new();
        let item = scan_item_dir(&dir, None, PackZone::Linked, &mut warnings).unwrap();
        assert_eq!(item.effective_id, "bryan.theme.linked");
        assert!(item.mutable);
        assert!(warnings.is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
