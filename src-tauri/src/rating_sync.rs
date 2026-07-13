use crate::activity_log::{self, LogLevel};
use crate::metadata_backup;
use crate::metadata_writer::MetadataWriteError;
use crate::rating_tags;
use crate::settings;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

const DEBOUNCE_MS: u64 = 500;
const RETRY_DELAY_MS: u64 = 2_000;

static GENERATION: AtomicU64 = AtomicU64::new(0);

struct PendingWrite {
    file_path: PathBuf,
    canonical: u8,
    generation: u64,
}

struct RatingSyncInner {
    pending: HashMap<i64, PendingWrite>,
}

#[derive(Clone)]
pub struct RatingSync(Arc<Mutex<RatingSyncInner>>);

impl RatingSync {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(RatingSyncInner {
            pending: HashMap::new(),
        })))
    }

    /// Drop pending tag writes (e.g. after library relocation) and invalidate
    /// in-flight debounce generations so they no longer write old paths.
    pub fn clear_pending(&self) {
        GENERATION.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut guard) = self.0.lock() {
            guard.pending.clear();
        }
    }
}

pub fn schedule_rating_file_write(
    app: AppHandle,
    sync: &RatingSync,
    track_id: i64,
    file_path: String,
    canonical: u8,
) {
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    {
        let mut guard = sync.0.lock().expect("rating sync mutex poisoned");
        guard.pending.insert(
            track_id,
            PendingWrite {
                file_path: PathBuf::from(file_path),
                canonical,
                generation,
            },
        );
    }

    let sync = sync.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(DEBOUNCE_MS));

        let write = {
            let mut guard = sync.0.lock().expect("rating sync mutex poisoned");
            match guard.pending.get(&track_id) {
                Some(pending) if pending.generation == generation => {
                    guard.pending.remove(&track_id)
                }
                _ => None,
            }
        };

        let Some(write) = write else {
            return;
        };

        run_file_write(&app, track_id, &write.file_path, write.canonical, false);
    });
}

fn run_file_write(
    app: &AppHandle,
    track_id: i64,
    file_path: &PathBuf,
    canonical: u8,
    is_retry: bool,
) {
    let backup_config = settings::metadata_backup_config(app);
    let result = rating_tags::write_rating_to_file(file_path, canonical, &backup_config);

    match result {
        Ok(()) => {}
        Err(MetadataWriteError::UnsupportedFormat(_)) => {}
        Err(err) => {
            let message = err.to_message();
            activity_log::log(
                LogLevel::Warn,
                "rating.sync",
                if is_retry {
                    format!("Rating file sync failed after retry for track {track_id}")
                } else {
                    format!("Rating file sync failed for track {track_id}")
                },
                Some(serde_json::json!({
                    "trackId": track_id,
                    "filePath": file_path,
                    "canonical": canonical,
                    "error": message,
                    "retry": is_retry,
                })),
            );

            if !is_retry {
                let app = app.clone();
                let file_path = file_path.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(RETRY_DELAY_MS));
                    run_file_write(&app, track_id, &file_path, canonical, true);
                });
            }
        }
    }

    if let Some(parent) = file_path.parent() {
        if let Err(err) = metadata_backup::cleanup_backups_in_dir(parent, &backup_config) {
            eprintln!("rating sync backup cleanup: {err}");
        }
    }
}
