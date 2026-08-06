//! Linux optical device node watch for the CD monitor.
#![cfg(target_os = "linux")]

use std::path::Path;
use std::sync::mpsc::Sender;
use std::thread;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use super::MonitorWake;

fn is_sr_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|name| {
            name.starts_with("sr")
                && name.len() > 2
                && name[2..].chars().all(|c| c.is_ascii_digit())
        })
}

fn event_mentions_sr(event: &notify::Event) -> bool {
    event.paths.iter().any(|p| is_sr_path(p))
}

/// Watch `/dev` for create/remove of `sr*` nodes and wake the CD monitor.
pub fn start_volume_events(tx: Sender<MonitorWake>) -> Result<(), String> {
    thread::Builder::new()
        .name("cd-device-events".into())
        .spawn(move || {
            if let Err(err) = run_dev_watch(tx) {
                eprintln!("cd monitor: linux device events failed: {err}");
            }
        })
        .map_err(|err| format!("Failed to start CD device event thread: {err}"))?;
    Ok(())
}

fn run_dev_watch(tx: Sender<MonitorWake>) -> Result<(), String> {
    let (event_tx, event_rx) = std::sync::mpsc::channel();
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            let _ = event_tx.send(res);
        },
        notify::Config::default(),
    )
    .map_err(|err| format!("Failed to create /dev watcher: {err}"))?;

    watcher
        .watch(Path::new("/dev"), RecursiveMode::NonRecursive)
        .map_err(|err| format!("Failed to watch /dev: {err}"))?;

    // Keep the watcher alive for the thread lifetime.
    let _watcher = watcher;

    while let Ok(res) = event_rx.recv() {
        match res {
            Ok(event) => {
                if event_mentions_sr(&event) {
                    let _ = tx.send(MonitorWake::DeviceStatusChanged);
                }
            }
            Err(err) => {
                eprintln!("cd monitor: /dev watch error: {err}");
            }
        }
    }
    Ok(())
}
