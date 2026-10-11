use crate::activity_log::{self, LogLevel};
use crate::packs;
use crate::settings;
use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
struct SoundManifestFile {
    asset: String,
}

/// Resolve an installed sound contribution's wav path by effective id.
///
/// Returns `Ok(None)` when the id is unknown or the asset file is missing.
#[tauri::command]
pub fn resolve_sound_asset(app: AppHandle, sound_id: String) -> Result<Option<String>, String> {
    let trimmed = sound_id.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if let Err(e) = packs::ensure_packs_ready(&app) {
        activity_log::log(
            LogLevel::Debug,
            "sound.resolve",
            format!("pack setup error: {e}"),
            None,
        );
    }

    let scan = packs::scan_contributions_of_type(&app, "sound");
    for w in &scan.warnings {
        activity_log::log(LogLevel::Debug, "sound.resolve", w.message.clone(), None);
    }

    let hidden: HashSet<String> = settings::read_settings(&app)
        .hidden_contribution_ids
        .into_iter()
        .collect();

    let Some(contrib) = scan
        .contributions
        .iter()
        .find(|c| c.effective_id == trimmed && !hidden.contains(&c.effective_id))
    else {
        return Ok(None);
    };

    let contents = fs::read_to_string(&contrib.manifest_path).map_err(|e| {
        format!(
            "could not read sound {}: {e}",
            contrib.manifest_path.display()
        )
    })?;
    let file: SoundManifestFile = serde_json::from_str(&contents).map_err(|e| {
        format!(
            "{} is not valid sound JSON: {e}",
            contrib.manifest_path.display()
        )
    })?;

    let asset = file.asset.trim();
    if asset.is_empty() || asset.contains("..") || asset.starts_with('/') || asset.starts_with('\\')
    {
        return Ok(None);
    }

    let asset_path = contrib.contribution_dir.join(asset);
    if !asset_path.is_file() {
        return Ok(None);
    }

    Ok(Some(asset_path.to_string_lossy().into_owned()))
}
