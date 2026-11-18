//! Filesystem checks that can't hang the app.
//!
//! A music folder may sit on a network share (SMB, NFS). When the connection
//! drops, calls on it such as `is_dir`, `read_dir` or `open` can block for a
//! long time (or forever, on a hard NFS mount) instead of failing. Run on the
//! UI thread, or while holding the database lock, one such call freezes the
//! app. These helpers run the call on a helper thread and give up waiting
//! after a timeout.
//!
//! A probe that is still stuck is remembered per path: later checks of the
//! same path don't start another thread, they answer "stalled" at once (until
//! the stuck call returns, which is when the share is back). So polling a dead
//! share costs one stuck thread, not one per poll.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, LazyLock, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

/// How long a check that only reports on a folder (the offline badge) waits
/// for the filesystem.
#[cfg(not(test))]
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
#[cfg(test)]
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(1);

/// How long a check waits before a folder or file is about to be used: one
/// whose answer fails a scan, or flags tracks offline. Long enough for a
/// healthy share that's slow to answer (a NAS spinning its disks up), so it
/// isn't taken for a dead one. A dead share costs this once per drop: later
/// checks of the same path join the stuck one and answer at once.
#[cfg(not(test))]
pub const ACCESS_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(test)]
pub const ACCESS_TIMEOUT: Duration = Duration::from_secs(2);

/// What a bounded check found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Probed {
    Yes,
    No,
    /// The filesystem didn't answer in time: a network share that dropped.
    Stalled,
}

impl Probed {
    pub fn is_yes(self) -> bool {
        self == Probed::Yes
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Kind {
    Dir,
    File,
}

/// One check running on a helper thread, shared by every caller asking the
/// same question about the same path.
struct Probe {
    started: Instant,
    outcome: Mutex<Option<bool>>,
    done: Condvar,
}

type InFlight = HashMap<(Kind, PathBuf), Arc<Probe>>;

static IN_FLIGHT: LazyLock<Mutex<InFlight>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Ask `check(path)` on a helper thread, waiting at most `timeout` from when
/// the (possibly shared) probe started.
fn probe_with(
    kind: Kind,
    path: &Path,
    timeout: Duration,
    check: impl FnOnce(&Path) -> bool + Send + 'static,
) -> Probed {
    let probe = {
        let mut in_flight = lock(&IN_FLIGHT);
        let key = (kind, path.to_path_buf());
        match in_flight.get(&key) {
            Some(probe) => Arc::clone(probe),
            None => {
                let probe = Arc::new(Probe {
                    started: Instant::now(),
                    outcome: Mutex::new(None),
                    done: Condvar::new(),
                });
                let worker = Arc::clone(&probe);
                let owned = path.to_path_buf();
                let worker_key = key.clone();
                // Holding the map's lock across the spawn means the thread
                // can't remove its entry before it has been inserted.
                let spawned = thread::Builder::new()
                    .name("fs-probe".into())
                    .spawn(move || {
                        let result = check(&owned);
                        // Leave the map before answering: a caller that came
                        // after the answer must ask afresh, not be handed it.
                        {
                            let mut in_flight = lock(&IN_FLIGHT);
                            if in_flight
                                .get(&worker_key)
                                .is_some_and(|p| Arc::ptr_eq(p, &worker))
                            {
                                in_flight.remove(&worker_key);
                            }
                        }
                        *lock(&worker.outcome) = Some(result);
                        worker.done.notify_all();
                    });
                if spawned.is_err() {
                    return Probed::Stalled;
                }
                in_flight.insert(key, Arc::clone(&probe));
                probe
            }
        }
    };

    let remaining = timeout.saturating_sub(probe.started.elapsed());
    let (outcome, _) = probe
        .done
        .wait_timeout_while(lock(&probe.outcome), remaining, |outcome| outcome.is_none())
        .unwrap_or_else(|e| e.into_inner());
    match *outcome {
        Some(true) => Probed::Yes,
        Some(false) => Probed::No,
        None => Probed::Stalled,
    }
}

/// Whether an I/O error means a network share stopped answering (timed out,
/// host down, connection gone), rather than something wrong with the file.
pub fn is_network_failure(err: &std::io::Error) -> bool {
    use std::io::ErrorKind::*;
    matches!(
        err.kind(),
        TimedOut
            | HostUnreachable
            | NetworkUnreachable
            | NetworkDown
            | NotConnected
            | ConnectionReset
            | ConnectionAborted
            | StaleNetworkFileHandle
    ) || is_network_errno(err)
}

/// Codes the standard error kinds don't cover (`EHOSTDOWN` on macOS).
#[cfg(unix)]
fn is_network_errno(err: &std::io::Error) -> bool {
    matches!(err.raw_os_error(), Some(code) if code == libc::EHOSTDOWN || code == libc::ETIMEDOUT)
}

/// Windows reports these through the standard error kinds.
#[cfg(not(unix))]
fn is_network_errno(_err: &std::io::Error) -> bool {
    false
}

/// Whether `path` is a folder that can be listed, without waiting on a
/// stalled share. Listing, not just looking it up: a network share that
/// dropped can keep answering lookups from a cache while every read fails.
pub fn probe_dir(path: &Path) -> Probed {
    probe_dir_within(path, PROBE_TIMEOUT)
}

/// [`probe_dir`] before using the folder, waiting up to [`ACCESS_TIMEOUT`].
pub fn probe_dir_before_use(path: &Path) -> Probed {
    probe_dir_within(path, ACCESS_TIMEOUT)
}

pub fn probe_dir_within(path: &Path, timeout: Duration) -> Probed {
    probe_with(Kind::Dir, path, timeout, |p| std::fs::read_dir(p).is_ok())
}

/// Whether `path` is a regular file, without waiting on a stalled share for
/// longer than [`ACCESS_TIMEOUT`] (it's asked before playing the file).
pub fn probe_file(path: &Path) -> Probed {
    probe_with(Kind::File, path, ACCESS_TIMEOUT, |p| p.is_file())
}

/// `Path::is_dir` that reads a stalled share as "not a folder" after
/// [`PROBE_TIMEOUT`] rather than waiting on it.
pub fn is_dir(path: &Path) -> bool {
    probe_dir(path).is_yes()
}

/// [`probe_dir`] for several folders at once, so that stalled shares are
/// waited for together rather than one after another.
pub fn probe_dirs(paths: &[PathBuf]) -> Vec<Probed> {
    probe_dirs_within(paths, PROBE_TIMEOUT)
}

/// [`probe_dir_before_use`] for several folders at once.
pub fn probe_dirs_before_use(paths: &[PathBuf]) -> Vec<Probed> {
    probe_dirs_within(paths, ACCESS_TIMEOUT)
}

fn probe_dirs_within(paths: &[PathBuf], timeout: Duration) -> Vec<Probed> {
    thread::scope(|scope| {
        let handles: Vec<_> = paths
            .iter()
            .map(|path| scope.spawn(move || probe_dir_within(path, timeout)))
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap_or(Probed::Stalled))
            .collect()
    })
}

/// Run `work` on a helper thread and wait at most `timeout` for its result.
/// `None` means it didn't finish in time; it keeps running, and its result is
/// dropped when it does. For one-off steps (opening a file, starting a
/// watcher); use [`probe_dir`] or [`probe_file`] first so a path already known
/// to be stalled doesn't start another stuck thread.
pub fn run_within<T: Send + 'static>(
    timeout: Duration,
    work: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    thread::Builder::new()
        .name("fs-bounded".into())
        .spawn(move || {
            let _ = tx.send(work());
        })
        .ok()?;
    rx.recv_timeout(timeout).ok()
}

/// A folder or file that reads as stalled, as on a dropped network share,
/// until dropped. For tests of code that must not wait on one.
#[cfg(test)]
pub struct Stalled {
    key: (Kind, PathBuf),
    probe: Arc<Probe>,
}

#[cfg(test)]
pub fn stall_dir(path: &Path) -> Stalled {
    stall(Kind::Dir, path)
}

#[cfg(test)]
pub fn stall_file(path: &Path) -> Stalled {
    stall(Kind::File, path)
}

#[cfg(test)]
fn stall(kind: Kind, path: &Path) -> Stalled {
    // Already stuck for longer than any caller waits, so callers don't wait.
    let started = Instant::now()
        .checked_sub(ACCESS_TIMEOUT.max(PROBE_TIMEOUT) * 2)
        .unwrap_or_else(Instant::now);
    let probe = Arc::new(Probe {
        started,
        outcome: Mutex::new(None),
        done: Condvar::new(),
    });
    let key = (kind, path.to_path_buf());
    lock(&IN_FLIGHT).insert(key.clone(), Arc::clone(&probe));
    Stalled { key, probe }
}

#[cfg(test)]
impl Drop for Stalled {
    fn drop(&mut self) {
        lock(&IN_FLIGHT).remove(&self.key);
        *lock(&self.probe.outcome) = Some(false);
        self.probe.done.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn unique(name: &str) -> PathBuf {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        std::env::temp_dir().join(format!(
            "spiral-fs-probe-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn reports_folders_files_and_missing_paths() {
        let dir = unique("basic");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.mp3");
        std::fs::write(&file, b"x").unwrap();

        assert_eq!(probe_dir(&dir), Probed::Yes);
        assert_eq!(probe_dir(&file), Probed::No);
        assert_eq!(probe_file(&file), Probed::Yes);
        assert_eq!(probe_file(&dir.join("nope.mp3")), Probed::No);
        assert!(is_dir(&dir));
        assert!(!is_dir(&dir.join("nope")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn network_errors_are_told_apart_from_file_errors() {
        use std::io::{Error, ErrorKind};
        assert!(is_network_failure(&Error::from(ErrorKind::TimedOut)));
        #[cfg(unix)]
        {
            assert!(is_network_failure(&Error::from_raw_os_error(
                libc::ETIMEDOUT
            )));
            assert!(is_network_failure(&Error::from_raw_os_error(
                libc::EHOSTDOWN
            )));
        }
        assert!(is_network_failure(&Error::from(ErrorKind::NotConnected)));
        assert!(!is_network_failure(&Error::from(ErrorKind::NotFound)));
        assert!(!is_network_failure(&Error::from(
            ErrorKind::PermissionDenied
        )));
    }

    #[test]
    fn probe_dirs_keeps_the_order_of_its_paths() {
        let dir = unique("many");
        std::fs::create_dir_all(&dir).unwrap();
        let missing = dir.join("missing");
        let answers = probe_dirs(&[dir.clone(), missing, dir.clone()]);
        assert_eq!(answers, [Probed::Yes, Probed::No, Probed::Yes]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A check that never returns in time (a dead share) is reported as
    /// stalled within the timeout, and asking again doesn't wait again or
    /// start a second stuck thread.
    #[test]
    fn a_stalled_check_times_out_once_and_then_answers_at_once() {
        let path = unique("stalled");
        let started = AtomicUsize::new(0);
        let started = Arc::new(started);
        let release = Arc::new((Mutex::new(false), Condvar::new()));

        let stuck = {
            let started = Arc::clone(&started);
            let release = Arc::clone(&release);
            move |_: &Path| {
                started.fetch_add(1, Ordering::SeqCst);
                let (flag, cv) = &*release;
                let _open = cv
                    .wait_while(lock(flag), |open| !*open)
                    .unwrap_or_else(|e| e.into_inner());
                true
            }
        };

        let timeout = Duration::from_millis(150);
        let t0 = Instant::now();
        assert_eq!(
            probe_with(Kind::Dir, &path, timeout, stuck.clone()),
            Probed::Stalled
        );
        assert!(t0.elapsed() >= timeout && t0.elapsed() < Duration::from_secs(2));

        // Known to be stalled: no second wait, and no second thread.
        let t1 = Instant::now();
        let other = Arc::clone(&started);
        assert_eq!(
            probe_with(Kind::Dir, &path, timeout, move |_: &Path| {
                other.fetch_add(100, Ordering::SeqCst);
                true
            }),
            Probed::Stalled
        );
        assert!(t1.elapsed() < Duration::from_millis(100));
        assert_eq!(started.load(Ordering::SeqCst), 1);

        // The share comes back: the stuck call returns and the path recovers.
        {
            let (flag, cv) = &*release;
            *lock(flag) = true;
            cv.notify_all();
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while lock(&IN_FLIGHT).contains_key(&(Kind::Dir, path.clone())) {
            assert!(Instant::now() < deadline, "probe never finished");
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            probe_with(Kind::Dir, &path, timeout, |_: &Path| true),
            Probed::Yes
        );
    }

    #[test]
    fn a_simulated_stall_answers_at_once_and_ends_when_dropped() {
        let dir = unique("simulated");
        std::fs::create_dir_all(&dir).unwrap();
        let stall = stall_dir(&dir);
        let t0 = Instant::now();
        assert_eq!(probe_dir(&dir), Probed::Stalled);
        assert!(!is_dir(&dir));
        assert!(t0.elapsed() < Duration::from_millis(200));
        drop(stall);
        assert_eq!(probe_dir(&dir), Probed::Yes);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A slow folder is reported as stalled to a caller that only reports on
    /// it, while one about to use it, joining the same check, waits longer and
    /// gets the answer.
    #[test]
    fn a_slow_folder_is_waited_for_longer_before_use() {
        let path = unique("slow");
        let slow = |_: &Path| {
            thread::sleep(Duration::from_millis(400));
            true
        };
        let short = Duration::from_millis(100);
        let long = Duration::from_secs(2);
        let path2 = path.clone();
        let reporter = thread::spawn(move || probe_with(Kind::Dir, &path2, short, slow));
        let deadline = Instant::now() + Duration::from_secs(5);
        while !lock(&IN_FLIGHT).contains_key(&(Kind::Dir, path.clone())) {
            assert!(Instant::now() < deadline, "probe never started");
            thread::sleep(Duration::from_millis(1));
        }
        // Joins the running check rather than starting its own.
        let patient = probe_with(Kind::Dir, &path, long, |_: &Path| false);
        assert_eq!(reporter.join().unwrap(), Probed::Stalled);
        assert_eq!(patient, Probed::Yes);
    }

    #[test]
    fn run_within_returns_the_result_or_gives_up() {
        assert_eq!(run_within(Duration::from_secs(2), || 7), Some(7));
        let t0 = Instant::now();
        let slow = run_within(Duration::from_millis(100), || {
            thread::sleep(Duration::from_millis(600));
            7
        });
        assert_eq!(slow, None);
        assert!(t0.elapsed() < Duration::from_millis(500));
    }
}
