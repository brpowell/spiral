//! Sound packs: list, pick the active one, and resolve cues to audio files.
//!
//! A sound pack holds named sounds and an author-chosen map of cues to those
//! sounds. Skins and the app ask for a cue; the active pack supplies the sound, and
//! the built-in pack fills any cue the active pack leaves undefined.

use crate::activity_log::{self, LogLevel};
use crate::packs::{self, ScannedContribution};
use crate::settings;
use serde::Serialize;
use spk_format::{read_item_manifest, read_sound_manifest, resolve_preview_file, SoundManifest};
use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundPackSummary {
    /// Effective id: `authorId.sound.id`.
    pub id: String,
    pub name: String,
    pub author: String,
    pub author_id: String,
    pub description: String,
    pub version: String,
    pub is_builtin: bool,
    pub zone: packs::PackZone,
    pub preview_path: Option<String>,
    /// Sound ids in the pack's library.
    pub sound_ids: Vec<String>,
    /// Cue name → sound id.
    pub cues: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
struct LoadedSoundPack {
    summary: SoundPackSummary,
    dir: PathBuf,
    manifest: SoundManifest,
}

fn load_pack(contrib: &ScannedContribution) -> Result<LoadedSoundPack, String> {
    let manifest = read_sound_manifest(&contrib.manifest_path)?;
    let preview_path = read_item_manifest(&contrib.contribution_dir)
        .ok()
        .and_then(|item| resolve_preview_file(&contrib.contribution_dir, item.preview.as_deref()))
        .map(|p| p.to_string_lossy().into_owned());

    let summary = SoundPackSummary {
        id: contrib.effective_id.clone(),
        name: manifest.name.clone(),
        author: manifest.author.clone(),
        author_id: contrib.author_id.clone(),
        description: manifest.description.clone(),
        version: contrib.version.clone(),
        is_builtin: contrib.zone.is_builtin(),
        zone: contrib.zone,
        preview_path,
        sound_ids: manifest.sounds.keys().cloned().collect(),
        cues: manifest.cues.clone(),
    };
    Ok(LoadedSoundPack {
        summary,
        dir: contrib.contribution_dir.clone(),
        manifest,
    })
}

/// Visible (not hidden) sound packs, sorted by name.
fn list_loaded_packs(app: &AppHandle) -> Vec<LoadedSoundPack> {
    if let Err(e) = packs::ensure_packs_ready(app) {
        activity_log::log(
            LogLevel::Debug,
            "sound.load",
            format!("pack setup error: {e}"),
            None,
        );
    }

    let scan = packs::scan_contributions_of_type(app, "sound");
    for w in &scan.warnings {
        activity_log::log(LogLevel::Debug, "sound.load", w.message.clone(), None);
    }

    let hidden: HashSet<String> = settings::read_settings(app)
        .hidden_contribution_ids
        .into_iter()
        .collect();

    let mut loaded = Vec::new();
    for contrib in &scan.contributions {
        if hidden.contains(&contrib.effective_id) {
            continue;
        }
        match load_pack(contrib) {
            Ok(pack) => loaded.push(pack),
            Err(e) => activity_log::log(
                LogLevel::Debug,
                "sound.load",
                format!("sound pack {} skipped: {e}", contrib.effective_id),
                None,
            ),
        }
    }
    loaded.sort_by(|a, b| a.summary.name.cmp(&b.summary.name));
    loaded
}

/// Active pack id when it exists, else the default pack.
fn resolve_active_id(stored: &str, packs: &[LoadedSoundPack]) -> String {
    if packs.iter().any(|p| p.summary.id == stored) {
        return stored.to_string();
    }
    settings::DEFAULT_SOUND_PACK_ID.to_string()
}

/// Wav path of `sound_id` inside `pack`, when the file exists.
fn sound_path(pack: &LoadedSoundPack, sound_id: &str) -> Option<PathBuf> {
    let asset = pack.manifest.sounds.get(sound_id)?.trim();
    if asset.is_empty() || asset.contains("..") || asset.starts_with('/') || asset.starts_with('\\')
    {
        return None;
    }
    let path = pack.dir.join(asset);
    path.is_file().then_some(path)
}

/// File for `cue`: the active pack's sound, else the default pack's.
fn resolve_cue_path(packs: &[LoadedSoundPack], active_id: &str, cue: &str) -> Option<PathBuf> {
    let from = |id: &str| -> Option<PathBuf> {
        let pack = packs.iter().find(|p| p.summary.id == id)?;
        let sound_id = pack.manifest.cues.get(cue)?;
        sound_path(pack, sound_id)
    };
    from(active_id).or_else(|| from(settings::DEFAULT_SOUND_PACK_ID))
}

#[tauri::command]
pub fn list_sound_packs(app: AppHandle) -> Result<Vec<SoundPackSummary>, String> {
    Ok(list_loaded_packs(&app)
        .into_iter()
        .map(|p| p.summary)
        .collect())
}

#[tauri::command]
pub fn get_active_sound_pack_id(app: AppHandle) -> Result<String, String> {
    let mut app_settings = settings::read_settings(&app);
    let packs = list_loaded_packs(&app);
    let resolved = resolve_active_id(&app_settings.active_sound_pack, &packs);
    if resolved != app_settings.active_sound_pack {
        app_settings.active_sound_pack = resolved.clone();
        let _ = settings::write_settings(&app, &app_settings);
    }
    Ok(resolved)
}

#[tauri::command]
pub fn save_active_sound_pack_id(app: AppHandle, sound_pack_id: String) -> Result<(), String> {
    let mut app_settings = settings::read_settings(&app);
    app_settings.active_sound_pack = sound_pack_id;
    settings::write_settings(&app, &app_settings)
}

/// Wav path for a cue, from the active sound pack with the default pack as fallback.
/// `Ok(None)` when neither defines the cue.
#[tauri::command]
pub fn resolve_sound_cue(app: AppHandle, cue: String) -> Result<Option<String>, String> {
    let cue = cue.trim();
    if cue.is_empty() {
        return Ok(None);
    }
    let packs = list_loaded_packs(&app);
    let active = resolve_active_id(&settings::read_settings(&app).active_sound_pack, &packs);
    Ok(resolve_cue_path(&packs, &active, cue).map(|p| p.to_string_lossy().into_owned()))
}

/// Wav path of one sound in a specific pack, whether or not that pack is active
/// (previews, and any future context that addresses a sound directly).
#[tauri::command]
pub fn resolve_sound_pack_asset(
    app: AppHandle,
    sound_pack_id: String,
    sound_id: String,
) -> Result<Option<String>, String> {
    let packs = list_loaded_packs(&app);
    let Some(pack) = packs.iter().find(|p| p.summary.id == sound_pack_id.trim()) else {
        return Ok(None);
    };
    Ok(sound_path(pack, sound_id.trim()).map(|p| p.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packs::scan::scan_zone_root;
    use crate::packs::PackZone;
    use std::fs;

    fn pack(id: &str, sounds: &[(&str, bool)], cues: &[(&str, &str)]) -> LoadedSoundPack {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("spiral-sound-{id}-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let mut manifest = SoundManifest {
            id: id.into(),
            name: id.into(),
            author: String::new(),
            description: String::new(),
            sounds: BTreeMap::new(),
            cues: BTreeMap::new(),
        };
        for (sound, exists) in sounds {
            let file = format!("{sound}.wav");
            if *exists {
                fs::write(dir.join(&file), b"RIFF").unwrap();
            }
            manifest.sounds.insert(sound.to_string(), file);
        }
        for (cue, sound) in cues {
            manifest.cues.insert(cue.to_string(), sound.to_string());
        }
        LoadedSoundPack {
            summary: SoundPackSummary {
                id: format!("test.sound.{id}"),
                name: id.into(),
                author: String::new(),
                author_id: "test".into(),
                description: String::new(),
                version: "1.0.0".into(),
                is_builtin: false,
                zone: PackZone::Installed,
                preview_path: None,
                sound_ids: manifest.sounds.keys().cloned().collect(),
                cues: manifest.cues.clone(),
            },
            dir,
            manifest,
        }
    }

    fn default_pack() -> LoadedSoundPack {
        let mut p = pack(
            "default",
            &[("play", true), ("control", true)],
            &[("transportPlay", "play"), ("transportControl", "control")],
        );
        p.summary.id = settings::DEFAULT_SOUND_PACK_ID.to_string();
        p
    }

    #[test]
    fn active_pack_cue_wins_and_missing_cues_fall_back_to_default() {
        let custom = pack("custom", &[("boop", true)], &[("transportPlay", "boop")]);
        let packs = vec![default_pack(), custom.clone()];

        let play = resolve_cue_path(&packs, &custom.summary.id, "transportPlay").unwrap();
        assert!(play.ends_with("boop.wav"));

        // The custom pack does not define transportControl: default fills in.
        let control = resolve_cue_path(&packs, &custom.summary.id, "transportControl").unwrap();
        assert!(control.ends_with("control.wav"));

        // Unknown cues resolve to nothing.
        assert!(resolve_cue_path(&packs, &custom.summary.id, "nope").is_none());
    }

    #[test]
    fn missing_asset_file_falls_back_to_default() {
        let broken = pack("broken", &[("boop", false)], &[("transportPlay", "boop")]);
        let packs = vec![default_pack(), broken.clone()];
        let play = resolve_cue_path(&packs, &broken.summary.id, "transportPlay").unwrap();
        assert!(play.ends_with("play.wav"));
    }

    #[test]
    fn unknown_active_id_resolves_to_default() {
        let packs = vec![default_pack()];
        assert_eq!(
            resolve_active_id("gone.sound.pack", &packs),
            settings::DEFAULT_SOUND_PACK_ID
        );
        assert_eq!(
            resolve_active_id(settings::DEFAULT_SOUND_PACK_ID, &packs),
            settings::DEFAULT_SOUND_PACK_ID
        );
    }

    #[test]
    fn sounds_are_individually_addressable_and_traversal_is_rejected() {
        let mut p = pack("addr", &[("a", true)], &[]);
        assert!(sound_path(&p, "a").unwrap().ends_with("a.wav"));
        assert!(sound_path(&p, "missing").is_none());
        p.manifest.sounds.insert("evil".into(), "../a.wav".into());
        assert!(sound_path(&p, "evil").is_none());
    }

    #[test]
    fn builtin_default_pack_loads_and_defines_the_known_cues() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("packs/builtin");
        let mut warnings = Vec::new();
        let contribs = scan_zone_root(&root, PackZone::Builtin, &mut warnings);
        let loaded: Vec<_> = contribs
            .iter()
            .filter(|c| c.r#type == "sound")
            .map(|c| load_pack(c).expect("builtin sound pack loads"))
            .collect();
        assert_eq!(loaded.len(), 1);
        let default = &loaded[0];
        assert_eq!(default.summary.id, settings::DEFAULT_SOUND_PACK_ID);
        for cue in spk_format::KNOWN_SOUND_CUES {
            let resolved = resolve_cue_path(&loaded, &default.summary.id, cue);
            assert!(resolved.is_some(), "default pack must define {cue}");
        }
    }
}
