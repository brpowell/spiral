//! Directory-walking pack scanner over builtin / workshop / installed / linked zones.
//!
//! Contributions are discovered by scanning fixed type folders (`themes/`, `skins/`,
//! `visualizers/`). Each contribution manifest must declare an `id`.

use super::paths;
use super::{
    contribution_id_from_manifest_json, contribution_type_for_folder, effective_contribution_id,
    get_contribution_type_handler, pack_identity, parse_pack_manifest_json, PackManifest,
    PackZone, CONTRIBUTION_TYPE_FOLDERS, PACK_MANIFEST_FILENAME,
};
use crate::settings;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// App semver used for `minAppVersion` checks (Cargo package version).
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// One contribution discovered by the scanner.
#[derive(Debug, Clone)]
pub struct ScannedContribution {
    pub zone: PackZone,
    pub author_id: String,
    pub pack_id: String,
    #[allow(dead_code)] // Exposed for install/management UI
    pub pack_version: String,
    pub pack_name: String,
    pub pack_dir: PathBuf,
    /// Directory containing the contribution manifest.
    pub contribution_dir: PathBuf,
    pub manifest_path: PathBuf,
    pub r#type: String,
    /// Declared contribution id from the contribution manifest.
    pub local_id: String,
    pub effective_id: String,
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
        // Workshop and Linked share the authoring priority band (beat installed/builtin).
        // Pack-id collision between them is an error, not silent precedence.
        PackZone::Workshop | PackZone::Linked => 2,
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
        Ordering::Equal => {
            // Same zone (e.g. two installed versions): higher semver wins.
            match version_cmp(&incoming.pack_version, &existing.pack_version) {
                Some(Ordering::Greater) => true,
                Some(Ordering::Less) => false,
                _ => true,
            }
        }
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

/// Peek full pack identity (`authorId.packId`) from a pack root's `pack.json`.
pub(crate) fn peek_pack_identity(pack_dir: &Path) -> Result<String, String> {
    let pack = peek_pack_manifest(pack_dir)?;
    Ok(pack_identity(&pack.author_id, &pack.pack_id))
}

#[allow(dead_code)]
pub(crate) fn peek_pack_id(pack_dir: &Path) -> Result<String, String> {
    Ok(peek_pack_manifest(pack_dir)?.pack_id)
}

fn peek_pack_manifest(pack_dir: &Path) -> Result<PackManifest, String> {
    let manifest_path = pack_dir.join(PACK_MANIFEST_FILENAME);
    if !manifest_path.is_file() {
        return Err(format!(
            "pack directory is missing {PACK_MANIFEST_FILENAME}"
        ));
    }
    let contents = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("could not read {}: {e}", manifest_path.display()))?;
    parse_pack_manifest_json(&contents).map_err(|e| e.to_string())
}

pub(crate) fn scan_pack_dir(
    pack_dir: &Path,
    zone: PackZone,
    warnings: &mut Vec<ScanWarning>,
) -> Vec<ScannedContribution> {
    let manifest_path = pack_dir.join(PACK_MANIFEST_FILENAME);
    if !manifest_path.is_file() {
        return vec![];
    }

    let contents = match fs::read_to_string(&manifest_path) {
        Ok(c) => c,
        Err(e) => {
            warnings.push(ScanWarning {
                message: format!("could not read {}: {e}", manifest_path.display()),
            });
            return vec![];
        }
    };

    let pack = match parse_pack_manifest_json(&contents) {
        Ok(p) => p,
        Err(e) => {
            warnings.push(ScanWarning {
                message: format!("invalid pack at {}: {e}", pack_dir.display()),
            });
            return vec![];
        }
    };

    if let Some(min) = &pack.min_app_version {
        if !meets_min_app_version(min, app_version()) {
            warnings.push(ScanWarning {
                message: format!(
                    "pack \"{}\" requires minAppVersion {min} (app is {}); skipping",
                    pack.pack_id,
                    app_version()
                ),
            });
            return vec![];
        }
    }

    contributions_from_pack(&pack, pack_dir, zone, warnings)
}

fn contributions_from_pack(
    pack: &PackManifest,
    pack_dir: &Path,
    zone: PackZone,
    warnings: &mut Vec<ScanWarning>,
) -> Vec<ScannedContribution> {
    let mutable = zone.is_mutable();
    let mut out = Vec::new();
    let mut seen_type_local_ids: HashMap<String, PathBuf> = HashMap::new();
    let mut duplicate_hard_fail = false;

    for &(folder, contrib_type, manifest_filename) in CONTRIBUTION_TYPE_FOLDERS {
        if get_contribution_type_handler(contrib_type).is_none() {
            continue;
        }
        let type_root = pack_dir.join(folder);
        if !type_root.is_dir() {
            continue;
        }
        let entries = match fs::read_dir(&type_root) {
            Ok(e) => e,
            Err(e) => {
                warnings.push(ScanWarning {
                    message: format!(
                        "pack \"{}\": could not read {}/: {e}",
                        pack.pack_id, folder
                    ),
                });
                continue;
            }
        };
        for entry in entries.flatten() {
            let contribution_dir = entry.path();
            if !contribution_dir.is_dir() {
                continue;
            }
            // Ignore unknown nested noise; only folders with the expected manifest count.
            let manifest_path = contribution_dir.join(manifest_filename);
            if !manifest_path.is_file() {
                // Soft-skip empty/incomplete folders.
                continue;
            }
            let contents = match fs::read_to_string(&manifest_path) {
                Ok(c) => c,
                Err(e) => {
                    warnings.push(ScanWarning {
                        message: format!(
                            "pack \"{}\": could not read {}: {e}",
                            pack.pack_id,
                            manifest_path.display()
                        ),
                    });
                    continue;
                }
            };
            let local_id = match contribution_id_from_manifest_json(&contents) {
                Ok(id) => id,
                Err(e) => {
                    warnings.push(ScanWarning {
                        message: format!(
                            "pack \"{}\": {}: {}",
                            pack.pack_id,
                            manifest_path.display(),
                            e
                        ),
                    });
                    continue;
                }
            };

            let type_local_key = format!("{contrib_type}:{local_id}");
            if let Some(existing_path) = seen_type_local_ids.get(&type_local_key) {
                warnings.push(ScanWarning {
                    message: format!(
                        "pack \"{}\": duplicate {contrib_type} contribution id \"{local_id}\" at {} and {} — skipping pack",
                        pack.pack_id,
                        existing_path.display(),
                        manifest_path.display()
                    ),
                });
                duplicate_hard_fail = true;
                break;
            }
            seen_type_local_ids.insert(type_local_key, manifest_path.clone());

            out.push(ScannedContribution {
                zone,
                author_id: pack.author_id.clone(),
                pack_id: pack.pack_id.clone(),
                pack_version: pack.version.clone(),
                pack_name: pack.name.clone(),
                pack_dir: pack_dir.to_path_buf(),
                contribution_dir,
                manifest_path,
                r#type: contrib_type.to_string(),
                local_id: local_id.clone(),
                effective_id: effective_contribution_id(
                    &pack.author_id,
                    &pack.pack_id,
                    contrib_type,
                    &local_id,
                ),
                mutable,
            });
        }
        if duplicate_hard_fail {
            return vec![];
        }
    }

    // Warn about unknown top-level folders that look like type folders but aren't registered.
    if let Ok(entries) = fs::read_dir(pack_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            if contribution_type_for_folder(name).is_none()
                && matches!(name, "themes" | "skins" | "visualizers" | "renderers")
            {
                // Shouldn't happen given CONTRIBUTION_TYPE_FOLDERS, but keep symmetric.
                warnings.push(ScanWarning {
                    message: format!(
                        "pack \"{}\": unregistered type folder \"{name}/\" — skipping",
                        pack.pack_id
                    ),
                });
            }
        }
    }

    out
}

pub(crate) fn scan_zone_root(
    root: &Path,
    zone: PackZone,
    warnings: &mut Vec<ScanWarning>,
) -> Vec<ScannedContribution> {
    if !root.is_dir() {
        return vec![];
    }

    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(e) => {
            warnings.push(ScanWarning {
                message: format!(
                    "could not read {} zone at {}: {e}",
                    zone.as_str(),
                    root.display()
                ),
            });
            return vec![];
        }
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(scan_pack_dir(&path, zone, warnings));
        }
    }
    out
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

/// Scan all pack zones. On effective-id collision, higher-priority zone wins
/// (workshop/linked > installed > builtin). Linked vs workshop pack identity collision
/// is a soft-fail warning (linked path skipped), not silent override.
pub fn scan_all_packs(app: &AppHandle) -> ScanResult {
    let mut warnings = Vec::new();
    let mut by_id: HashMap<String, ScannedContribution> = HashMap::new();
    let mut workshop_pack_identities: HashSet<String> = HashSet::new();

    let zones = [
        (PackZone::Builtin, paths::builtin_packs_root(app)),
        (
            PackZone::Installed,
            paths::installed_packs_root(app).unwrap_or_default(),
        ),
        (
            PackZone::Workshop,
            paths::workshop_packs_root(app).unwrap_or_default(),
        ),
    ];

    // Scan lowest priority first so higher priority overwrites.
    for (zone, root) in zones {
        if root.as_os_str().is_empty() {
            continue;
        }
        for contrib in scan_zone_root(&root, zone, &mut warnings) {
            if zone == PackZone::Workshop {
                workshop_pack_identities.insert(pack_identity(&contrib.author_id, &contrib.pack_id));
            }
            merge_contribution(&mut by_id, contrib);
        }
    }

    let linked_paths = settings::read_settings(app).linked_pack_paths;
    for raw in linked_paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = PathBuf::from(trimmed);
        if !path.is_dir() {
            warnings.push(ScanWarning {
                message: format!("linked pack path not found or not a directory: {trimmed}"),
            });
            continue;
        }
        if !path.join(PACK_MANIFEST_FILENAME).is_file() {
            warnings.push(ScanWarning {
                message: format!(
                    "linked pack path is missing {PACK_MANIFEST_FILENAME}: {trimmed}"
                ),
            });
            continue;
        }

        let identity = match peek_pack_identity(&path) {
            Ok(id) => id,
            Err(e) => {
                warnings.push(ScanWarning {
                    message: format!("linked pack at {trimmed}: {e}"),
                });
                continue;
            }
        };

        if workshop_pack_identities.contains(&identity) {
            warnings.push(ScanWarning {
                message: format!(
                    "linked pack \"{identity}\" collides with a workshop pack (path: {trimmed}); skipping linked path"
                ),
            });
            continue;
        }

        for contrib in scan_pack_dir(&path, PackZone::Linked, &mut warnings) {
            merge_contribution(&mut by_id, contrib);
        }
    }

    let mut contributions: Vec<_> = by_id.into_values().collect();
    contributions.sort_by(|a, b| {
        a.r#type
            .cmp(&b.r#type)
            .then_with(|| a.pack_name.cmp(&b.pack_name))
            .then_with(|| a.effective_id.cmp(&b.effective_id))
    });

    ScanResult {
        contributions,
        warnings,
    }
}

pub fn scan_contributions_of_type(app: &AppHandle, contrib_type: &str) -> ScanResult {
    let mut result = scan_all_packs(app);
    result
        .contributions
        .retain(|c| c.r#type == contrib_type);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn min_app_version_floor() {
        assert!(meets_min_app_version("0.1.0", "0.1.0"));
        assert!(meets_min_app_version("0.1.0", "1.0.0"));
        assert!(!meets_min_app_version("2.0.0", "1.0.0"));
        assert!(!meets_min_app_version("not-semver", "1.0.0"));
    }

    #[test]
    fn scan_builtin_packs_from_manifest_dir() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("packs/builtin");
        let mut warnings = Vec::new();
        let contribs = scan_zone_root(&root, PackZone::Builtin, &mut warnings);
        for w in &warnings {
            eprintln!("scan warning: {}", w.message);
        }
        let themes: Vec<_> = contribs.iter().filter(|c| c.r#type == "theme").collect();
        let skins: Vec<_> = contribs.iter().filter(|c| c.r#type == "skin").collect();
        let viz: Vec<_> = contribs.iter().filter(|c| c.r#type == "visualizer").collect();
        assert!(themes
            .iter()
            .any(|c| c.effective_id == "spiral.core.theme.obsidian"));
        assert!(skins
            .iter()
            .any(|c| c.effective_id == "spiral.core.skin.vanilla"));
        assert!(viz.iter().any(|c| c.effective_id == "spiral.core.visualizer.bars"));
        assert_eq!(themes.len(), 5, "expected 5 builtin themes");
        assert_eq!(skins.len(), 1, "expected 1 builtin skin in core");
        assert_eq!(viz.len(), 4, "expected 4 builtin visualizers");
        let renderers: Vec<_> = contribs.iter().filter(|c| c.r#type == "renderer").collect();
        assert!(renderers
            .iter()
            .any(|c| c.effective_id == "spiral.core.renderer.wave"));
        assert_eq!(renderers.len(), 4, "expected 4 builtin renderers");
    }

    #[test]
    fn workshop_wins_on_id_collision() {
        let mut by_id: HashMap<String, ScannedContribution> = HashMap::new();
        let builtin = ScannedContribution {
            zone: PackZone::Builtin,
            author_id: "spiral".into(),
            pack_id: "core".into(),
            pack_version: "1.0.0".into(),
            pack_name: "Core".into(),
            pack_dir: PathBuf::from("/builtin/core"),
            contribution_dir: PathBuf::from("/builtin/core/themes/obsidian"),
            manifest_path: PathBuf::from("/builtin/core/themes/obsidian/theme.json"),
            r#type: "theme".into(),
            local_id: "obsidian".into(),
            effective_id: "spiral.core.theme.obsidian".into(),
            mutable: false,
        };
        let workshop = ScannedContribution {
            zone: PackZone::Workshop,
            author_id: "spiral".into(),
            pack_id: "core".into(),
            pack_version: "0.0.0".into(),
            pack_name: "Obsidian Draft".into(),
            pack_dir: PathBuf::from("/workshop/core"),
            contribution_dir: PathBuf::from("/workshop/core/themes/obsidian"),
            manifest_path: PathBuf::from("/workshop/core/themes/obsidian/theme.json"),
            r#type: "theme".into(),
            local_id: "obsidian".into(),
            effective_id: "spiral.core.theme.obsidian".into(),
            mutable: true,
        };

        for contrib in [builtin, workshop] {
            merge_contribution(&mut by_id, contrib);
        }

        assert_eq!(by_id["spiral.core.theme.obsidian"].zone, PackZone::Workshop);
        assert!(by_id["spiral.core.theme.obsidian"].mutable);
    }

    #[test]
    fn linked_beats_installed_on_id_collision() {
        let mut by_id: HashMap<String, ScannedContribution> = HashMap::new();
        let installed = ScannedContribution {
            zone: PackZone::Installed,
            author_id: "bryan".into(),
            pack_id: "demo".into(),
            pack_version: "1.0.0".into(),
            pack_name: "Demo".into(),
            pack_dir: PathBuf::from("/installed/demo@1.0.0"),
            contribution_dir: PathBuf::from("/installed/demo@1.0.0/themes/theme"),
            manifest_path: PathBuf::from("/installed/demo@1.0.0/themes/theme/theme.json"),
            r#type: "theme".into(),
            local_id: "theme".into(),
            effective_id: "bryan.demo.theme.theme".into(),
            mutable: false,
        };
        let linked = ScannedContribution {
            zone: PackZone::Linked,
            author_id: "bryan".into(),
            pack_id: "demo".into(),
            pack_version: "0.0.1".into(),
            pack_name: "Demo Linked".into(),
            pack_dir: PathBuf::from("/repos/demo"),
            contribution_dir: PathBuf::from("/repos/demo/themes/theme"),
            manifest_path: PathBuf::from("/repos/demo/themes/theme/theme.json"),
            r#type: "theme".into(),
            local_id: "theme".into(),
            effective_id: "bryan.demo.theme.theme".into(),
            mutable: true,
        };

        for contrib in [installed, linked] {
            merge_contribution(&mut by_id, contrib);
        }

        assert_eq!(by_id["bryan.demo.theme.theme"].zone, PackZone::Linked);
        assert!(by_id["bryan.demo.theme.theme"].mutable);
    }

    #[test]
    fn newer_installed_version_wins_within_zone() {
        let mut by_id: HashMap<String, ScannedContribution> = HashMap::new();
        let older = ScannedContribution {
            zone: PackZone::Installed,
            author_id: "bryan".into(),
            pack_id: "midnight-drive".into(),
            pack_version: "1.0.0".into(),
            pack_name: "Midnight Drive".into(),
            pack_dir: PathBuf::from("/installed/midnight-drive@1.0.0"),
            contribution_dir: PathBuf::from("/installed/midnight-drive@1.0.0/themes/theme"),
            manifest_path: PathBuf::from(
                "/installed/midnight-drive@1.0.0/themes/theme/theme.json",
            ),
            r#type: "theme".into(),
            local_id: "theme".into(),
            effective_id: "bryan.midnight-drive.theme.theme".into(),
            mutable: false,
        };
        let newer = ScannedContribution {
            zone: PackZone::Installed,
            author_id: "bryan".into(),
            pack_id: "midnight-drive".into(),
            pack_version: "1.1.0".into(),
            pack_name: "Midnight Drive".into(),
            pack_dir: PathBuf::from("/installed/midnight-drive@1.1.0"),
            contribution_dir: PathBuf::from("/installed/midnight-drive@1.1.0/themes/theme"),
            manifest_path: PathBuf::from(
                "/installed/midnight-drive@1.1.0/themes/theme/theme.json",
            ),
            r#type: "theme".into(),
            local_id: "theme".into(),
            effective_id: "bryan.midnight-drive.theme.theme".into(),
            mutable: false,
        };

        for contrib in [older, newer] {
            merge_contribution(&mut by_id, contrib);
        }

        assert_eq!(by_id["bryan.midnight-drive.theme.theme"].pack_version, "1.1.0");
    }
}
