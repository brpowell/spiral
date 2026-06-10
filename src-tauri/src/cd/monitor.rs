use crate::cd::events::{self, MonitorWake};
use crate::cd::platform;
use crate::cd::types::CdDrive;
use std::collections::HashMap;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const CD_DISC_CHANGED_EVENT: &str = "cd-disc-changed";
/// Let the UI finish loading before the first background refresh.
const INITIAL_POLL_DELAY: Duration = Duration::from_secs(3);
/// Base loop tick — cheap drive list only unless a probe is due or an event fired.
const TICK_INTERVAL: Duration = Duration::from_secs(15);
/// Fallback presence probe interval when volume events are unavailable or missed.
const FALLBACK_PRESENCE_PROBE_INTERVAL: Duration = Duration::from_secs(60);
/// Coalesce rapid mount/unmount notifications before refreshing drive state.
const EVENT_DEBOUNCE: Duration = Duration::from_millis(400);

static MONITOR_WAKE_TX: LazyLock<Mutex<Option<std::sync::mpsc::Sender<MonitorWake>>>> =
    LazyLock::new(|| Mutex::new(None));

struct MonitorState {
    last_drive_list_sig: String,
    last_emitted_sig: String,
    last_presence_probe: Instant,
    known_has_disc: HashMap<String, bool>,
}

impl MonitorState {
    fn new() -> Self {
        Self {
            last_drive_list_sig: String::new(),
            last_emitted_sig: String::new(),
            last_presence_probe: Instant::now() - FALLBACK_PRESENCE_PROBE_INTERVAL,
            known_has_disc: HashMap::new(),
        }
    }
}

fn drive_list_signature(drives: &[CdDrive]) -> String {
    drives
        .iter()
        .map(|drive| format!("{}:{}", drive.id, drive.name))
        .collect::<Vec<_>>()
        .join("|")
}

fn full_signature(drives: &[CdDrive]) -> String {
    drives
        .iter()
        .map(|drive| format!("{}:{}:{}", drive.id, drive.name, drive.has_disc))
        .collect::<Vec<_>>()
        .join("|")
}

fn apply_presence_probes(drives: &mut [CdDrive], state: &mut MonitorState) {
    for drive in drives.iter_mut() {
        if platform::should_skip_monitor_probe(&drive.id) {
            drive.has_disc = platform::cached_disc_presence(&drive.id)
                .or_else(|| state.known_has_disc.get(&drive.id).copied())
                .unwrap_or(drive.has_disc);
            continue;
        }

        match platform::probe_disc_presence_try(&drive.id) {
            Some(Ok(has_disc)) => drive.has_disc = has_disc,
            Some(Err(err)) => {
                eprintln!("cd monitor: probe {} failed: {err}", drive.id);
                drive.has_disc = platform::cached_disc_presence(&drive.id)
                    .or_else(|| state.known_has_disc.get(&drive.id).copied())
                    .unwrap_or(false);
            }
            None => {
                drive.has_disc = platform::cached_disc_presence(&drive.id)
                    .or_else(|| state.known_has_disc.get(&drive.id).copied())
                    .unwrap_or(false);
            }
        }
    }

    state.known_has_disc = drives
        .iter()
        .map(|drive| (drive.id.clone(), drive.has_disc))
        .collect();
    state.last_presence_probe = Instant::now();
}

fn apply_wake(wake: &MonitorWake) {
    match wake {
        MonitorWake::VolumeMounted { path } => platform::note_volume_mounted(path),
        MonitorWake::VolumeUnmounted { path } => platform::note_volume_unmounted(path),
        MonitorWake::DeviceStatusChanged => platform::note_device_status_changed(),
    }
}

fn drain_and_apply_wakes(
    rx: &std::sync::mpsc::Receiver<MonitorWake>,
    first: MonitorWake,
) {
    apply_wake(&first);
    while let Ok(wake) = rx.try_recv() {
        apply_wake(&wake);
    }
}

fn refresh_drives(
    state: &Arc<Mutex<MonitorState>>,
    force_presence_probe: bool,
) -> Option<Vec<CdDrive>> {
    if platform::is_drive_busy() {
        return None;
    }

    let mut drives = match platform::list_drives_try()? {
        Ok(drives) => drives,
        Err(err) => {
            eprintln!("cd monitor: list_drives failed: {err}");
            return None;
        }
    };

    let mut guard = state.lock().expect("cd monitor state poisoned");
    let list_sig = drive_list_signature(&drives);
    let list_changed = guard.last_drive_list_sig != list_sig;
    if list_changed {
        guard.last_drive_list_sig = list_sig;
    }

    let fallback_due = guard.last_presence_probe.elapsed() >= FALLBACK_PRESENCE_PROBE_INTERVAL;
    let should_probe_presence = force_presence_probe || list_changed || fallback_due;

    if should_probe_presence {
        apply_presence_probes(&mut drives, &mut guard);
    } else {
        for drive in &mut drives {
            drive.has_disc = platform::cached_disc_presence(&drive.id)
                .or_else(|| guard.known_has_disc.get(&drive.id).copied())
                .unwrap_or(false);
        }
    }

    Some(drives)
}

fn emit_if_changed(app: &AppHandle, state: &Arc<Mutex<MonitorState>>, drives: Vec<CdDrive>) {
    let signature = full_signature(&drives);
    let changed = {
        let mut guard = state.lock().expect("cd monitor state poisoned");
        let changed = guard.last_emitted_sig != signature;
        if changed {
            guard.last_emitted_sig = signature;
        }
        changed
    };

    if changed {
        let payload = CdDiscChangedPayload { drives };
        if let Err(err) = app.emit(CD_DISC_CHANGED_EVENT, payload) {
            eprintln!("cd monitor: emit failed: {err}");
        }
    }
}

pub fn start_monitor(app: AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel();
    *MONITOR_WAKE_TX
        .lock()
        .expect("monitor wake tx poisoned") = Some(tx.clone());

    if let Err(err) = events::start_volume_events(tx) {
        eprintln!("cd monitor: volume events failed: {err}");
    }

    let state = Arc::new(Mutex::new(MonitorState::new()));

    thread::spawn(move || {
        thread::sleep(INITIAL_POLL_DELAY);

        loop {
            let force_presence_probe = match rx.recv_timeout(TICK_INTERVAL) {
                Ok(wake) => {
                    thread::sleep(EVENT_DEBOUNCE);
                    drain_and_apply_wakes(&rx, wake);
                    true
                }
                Err(RecvTimeoutError::Timeout) => false,
                Err(RecvTimeoutError::Disconnected) => false,
            };

            if let Some(drives) = refresh_drives(&state, force_presence_probe) {
                emit_if_changed(&app, &state, drives);
            }
        }
    });
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CdDiscChangedPayload {
    drives: Vec<CdDrive>,
}
