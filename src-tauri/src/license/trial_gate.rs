//! Trial library size gate — cap free libraries until a verified card unlocks.
//!
//! Cap metric: persisted SQLite `tracks` rows (library track rows). Playlist
//! membership, pending import rows, and replace/upsert of an existing
//! `file_path` do not count as growth.

use super::runtime::load_license_snapshot_at;
use super::{LicenseStatus, TRIAL_LIBRARY_TRACK_CAP};
use crate::db;
use crate::settings;
use chrono::Utc;
use rusqlite::Connection;
use std::path::Path;
use tauri::AppHandle;

/// Stable error prefix so the UI can detect trial-cap failures.
const TRIAL_LIBRARY_CAP_ERROR_CODE: &str = "trial_library_cap";

/// Purchase / install CTA destination (checkout may still be stubbed in PoC).
const TRIAL_PURCHASE_URL: &str = "https://spiralpowered.com";

/// True when license status lifts the free-trial library cap.
fn license_unlocks_library(status: LicenseStatus) -> bool {
    matches!(
        status,
        LicenseStatus::Provisional
            | LicenseStatus::ReadyToFinalize
            | LicenseStatus::Licensed
    )
}

fn trial_cap_error_message() -> String {
    format!(
        "{TRIAL_LIBRARY_CAP_ERROR_CODE}: Free trial is limited to a library of \
         {TRIAL_LIBRARY_TRACK_CAP} tracks. Purchase Spiral at {TRIAL_PURCHASE_URL} \
         or install a Spiral Card (Spiral → Spiral Card…)."
    )
}

/// Pure gate used by commands and unit tests.
///
/// - Unlocked licenses always allow.
/// - Paths already in the library may upsert without growing the count.
/// - Trial + at/over cap blocks new rows.
fn check_trial_library_add(
    status: LicenseStatus,
    track_count: u32,
    path_already_in_library: bool,
) -> Result<(), String> {
    if license_unlocks_library(status) || path_already_in_library {
        return Ok(());
    }
    if track_count >= TRIAL_LIBRARY_TRACK_CAP {
        return Err(trial_cap_error_message());
    }
    Ok(())
}

/// Authoritative gate: re-reads the installed card from disk (no cached state).
pub fn assert_can_add_library_track(
    app: &AppHandle,
    conn: &Connection,
    file_path: &str,
) -> Result<(), String> {
    let status = load_license_status_for_gate(app)?;
    let exists = db::track_exists_by_file_path(conn, file_path).map_err(|e| e.to_string())?;
    let count = db::count_tracks(conn).map_err(|e| e.to_string())?;
    check_trial_library_add(status, count, exists)
}

fn load_license_status_for_gate(app: &AppHandle) -> Result<LicenseStatus, String> {
    let path = settings::app_data_dir(app)?
        .join("license")
        .join("registration.spcard");
    Ok(status_from_registration_path(&path))
}

fn status_from_registration_path(path: &Path) -> LicenseStatus {
    load_license_snapshot_at(path, Utc::now()).status
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::license::{
        mint_spcard, serialize_spcard, signing_key_from_bytes, LicenseChannel, LicenseSku,
        PRODUCT_ID_SPIRAL,
    };
    use crate::models::TrackInput;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    const POC_PRIVATE_KEY: &[u8; 32] =
        include_bytes!("../../../docs/license/poc-keys/ed25519-private.raw");

    fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "{}-{}-{}-{}",
            prefix,
            std::process::id(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_input(path: &str) -> TrackInput {
        TrackInput {
            title: "Song".into(),
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            album_artist: None,
            track_number: Some(1),
            total_tracks: None,
            disc_number: None,
            total_discs: None,
            year: None,
            genre: None,
            duration_seconds: Some(120.0),
            sample_rate: None,
            bitrate: None,
            codec: None,
            file_path: path.into(),
            art_path: None,
            rating: None,
            lyrics: None,
        }
    }

    #[test]
    fn unlocked_statuses_lift_cap() {
        for status in [
            LicenseStatus::Provisional,
            LicenseStatus::ReadyToFinalize,
            LicenseStatus::Licensed,
        ] {
            assert!(check_trial_library_add(status, 10_000, false).is_ok());
        }
    }

    #[test]
    fn trial_allows_under_cap() {
        assert!(check_trial_library_add(
            LicenseStatus::Trial,
            TRIAL_LIBRARY_TRACK_CAP - 1,
            false
        )
        .is_ok());
    }

    #[test]
    fn trial_blocks_at_cap() {
        let err = check_trial_library_add(
            LicenseStatus::Trial,
            TRIAL_LIBRARY_TRACK_CAP,
            false,
        )
        .unwrap_err();
        assert!(err.starts_with(TRIAL_LIBRARY_CAP_ERROR_CODE));
        assert!(err.contains(&format!("{TRIAL_LIBRARY_TRACK_CAP} tracks")));
        assert!(err.contains(TRIAL_PURCHASE_URL));
    }

    #[test]
    fn trial_allows_upsert_at_cap() {
        assert!(check_trial_library_add(
            LicenseStatus::Trial,
            TRIAL_LIBRARY_TRACK_CAP,
            true
        )
        .is_ok());
    }

    #[test]
    fn count_and_exists_helpers_match_gate_inputs() {
        let dir = unique_temp_dir("spiral-trial-gate-db");
        let db_path = dir.join("library.db");
        let conn = db::open(&db_path).unwrap();

        assert_eq!(db::count_tracks(&conn).unwrap(), 0);
        assert!(!db::track_exists_by_file_path(&conn, "/a.mp3").unwrap());

        for i in 0..TRIAL_LIBRARY_TRACK_CAP {
            db::save_track(&conn, &sample_input(&format!("/track-{i}.mp3"))).unwrap();
        }
        assert_eq!(db::count_tracks(&conn).unwrap(), TRIAL_LIBRARY_TRACK_CAP);
        assert!(db::track_exists_by_file_path(&conn, "/track-0.mp3").unwrap());

        assert!(check_trial_library_add(
            LicenseStatus::Trial,
            db::count_tracks(&conn).unwrap(),
            false
        )
        .is_err());
        assert!(check_trial_library_add(
            LicenseStatus::Trial,
            db::count_tracks(&conn).unwrap(),
            db::track_exists_by_file_path(&conn, "/track-0.mp3").unwrap()
        )
        .is_ok());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn installing_card_lifts_gate_without_restart() {
        let dir = unique_temp_dir("spiral-trial-gate-card");
        let license_dir = dir.join("license");
        fs::create_dir_all(&license_dir).unwrap();
        let path = license_dir.join("registration.spcard");

        assert_eq!(
            status_from_registration_path(&path),
            LicenseStatus::Trial
        );
        assert!(check_trial_library_add(
            status_from_registration_path(&path),
            TRIAL_LIBRARY_TRACK_CAP,
            false
        )
        .is_err());

        let key = signing_key_from_bytes(POC_PRIVATE_KEY).unwrap();
        let card = mint_spcard(
            &key,
            PRODUCT_ID_SPIRAL,
            LicenseSku::Standard,
            "poc-mid-session-unlock",
            LicenseChannel::Direct,
            "2026-07-25T12:00:00Z",
            Some("2026-08-08T12:00:00Z".into()),
        )
        .unwrap();
        fs::write(&path, serialize_spcard(&card).unwrap()).unwrap();

        let status = status_from_registration_path(&path);
        assert_eq!(status, LicenseStatus::Provisional);
        assert!(check_trial_library_add(status, TRIAL_LIBRARY_TRACK_CAP, false).is_ok());

        let _ = fs::remove_dir_all(&dir);
    }
}
