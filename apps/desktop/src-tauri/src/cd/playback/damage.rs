//! Tolerance for unreadable CD sectors (scratches, dirt, failing media).
//!
//! Reads are retried; sectors that stay unreadable are replaced with silence during playback and
//! counted, so one bad patch doesn't end the track. Ripping uses `strict` mode instead and fails
//! on the first unreadable sector, so a glitched file never lands in the library.
#![cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]

#[cfg(any(target_os = "macos", test))]
use std::io::{ErrorKind, Read, Seek, SeekFrom};
use std::sync::atomic::Ordering;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

/// Extra attempts after a failed read before a sector is declared unreadable.
pub const READ_RETRIES: u32 = 3;

/// Consecutive unreadable sectors (~2.7 s of audio) after which the drive is assumed gone or the
/// disc beyond saving, and playback stops with an error instead of playing silence forever.
pub const MAX_CONSECUTIVE_BAD_SECTORS: u32 = 200;

/// Prefix of the error a strict (rip) read returns for an unreadable sector. The frontend matches
/// on it to show a "damaged disc" message, so keep it in sync with `cdPlaybackFailure.ts`.
pub const UNREADABLE_SECTOR_PREFIX: &str = "Unreadable section of disc";

/// A single read slower than this counts as a stall against the rip's budget.
const RIP_SLOW_READ: Duration = Duration::from_secs(1);
/// Total time a rip may spend in stalled reads before the track is abandoned.
const RIP_STALL_BUDGET: Duration = Duration::from_secs(60);
/// One read blocked this long (the drive is stuck retrying) abandons the track immediately.
const RIP_HARD_STALL: Duration = Duration::from_secs(20);

/// Error for a rip abandoned because the drive stalled on a damaged area. Starts with
/// [`UNREADABLE_SECTOR_PREFIX`] so the frontend reports it as a damaged disc.
fn rip_stall_error() -> String {
    format!("{UNREADABLE_SECTOR_PREFIX}: the drive stalled while reading it")
}

/// Time budget for ripping one track from a damaged disc. Drives often don't report an error;
/// they block for seconds per read while retrying. The reader reports each read here, and the
/// caller watches from outside so a read that never returns can't hang the rip.
pub struct RipBudget {
    epoch: Instant,
    /// Milliseconds since `epoch` + 1 when the current read began; 0 when idle.
    since_ms: AtomicU64,
    stalled_ms: AtomicU64,
    cancelled: AtomicBool,
    slow_read: Duration,
    budget: Duration,
    hard_stall: Duration,
}

impl RipBudget {
    pub fn new() -> Self {
        Self::with_limits(RIP_SLOW_READ, RIP_STALL_BUDGET, RIP_HARD_STALL)
    }

    fn with_limits(slow_read: Duration, budget: Duration, hard_stall: Duration) -> Self {
        Self {
            epoch: Instant::now(),
            since_ms: AtomicU64::new(0),
            stalled_ms: AtomicU64::new(0),
            cancelled: AtomicBool::new(false),
            slow_read,
            budget,
            hard_stall,
        }
    }

    fn now_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64 + 1
    }

    /// Call before each read. Errors if the rip was abandoned while the previous read was stuck.
    pub fn begin_read(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err(rip_stall_error());
        }
        self.since_ms.store(self.now_ms(), Ordering::Release);
        Ok(())
    }

    /// Call after each read. Errors once stalled reads have used up the budget.
    pub fn end_read(&self) -> Result<(), String> {
        let began = self.since_ms.swap(0, Ordering::AcqRel);
        let took = Duration::from_millis(self.now_ms().saturating_sub(began));
        self.record_read(took)
    }

    fn record_read(&self, took: Duration) -> Result<(), String> {
        if took < self.slow_read {
            return Ok(());
        }
        eprintln!("cd rip: slow read {:.2}s", took.as_secs_f64());
        let total = self
            .stalled_ms
            .fetch_add(took.as_millis() as u64, Ordering::AcqRel)
            + took.as_millis() as u64;
        if Duration::from_millis(total) > self.budget {
            eprintln!(
                "cd rip: stall budget used up ({:.0}s); abandoning track",
                total as f64 / 1000.0
            );
            return Err(rip_stall_error());
        }
        Ok(())
    }

    fn blocked_for(&self) -> Option<Duration> {
        let since = self.since_ms.load(Ordering::Acquire);
        (since != 0).then(|| Duration::from_millis(self.now_ms().saturating_sub(since)))
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }
}

impl Default for RipBudget {
    fn default() -> Self {
        Self::new()
    }
}

/// Run a track read on a worker thread and wait for it, giving up if one read blocks past the
/// hard-stall limit. The stuck worker can't be interrupted; it is detached and exits on its own
/// when the drive finally returns.
pub fn run_budgeted<T: Send + 'static>(
    budget: Arc<RipBudget>,
    job: impl FnOnce(&RipBudget) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    let worker_budget = Arc::clone(&budget);
    std::thread::Builder::new()
        .name("cd-rip-read".into())
        .spawn(move || {
            let _ = tx.send(job(&worker_budget));
        })
        .map_err(|err| format!("Failed to start CD read thread: {err}"))?;
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if budget.blocked_for().is_some_and(|b| b > budget.hard_stall) {
                    eprintln!("cd rip: read blocked past the limit; abandoning track");
                    budget.cancel();
                    return Err(rip_stall_error());
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("CD read thread ended unexpectedly".into());
            }
        }
    }
}

/// Running tally of unreadable sectors for one track.
pub struct SectorDamage {
    total: Arc<AtomicU32>,
    consecutive: u32,
    #[cfg(any(target_os = "windows", target_os = "linux", test))]
    strict: bool,
}

impl SectorDamage {
    /// `strict` makes the first unreadable sector an error (ripping); otherwise it is silenced.
    pub fn new(strict: bool) -> Self {
        #[cfg(not(any(target_os = "windows", target_os = "linux", test)))]
        let _ = strict;
        Self {
            total: Arc::new(AtomicU32::new(0)),
            consecutive: 0,
            #[cfg(any(target_os = "windows", target_os = "linux", test))]
            strict,
        }
    }

    /// Shared counter the playback engine polls to tell the UI about damage.
    pub fn counter(&self) -> Arc<AtomicU32> {
        Arc::clone(&self.total)
    }

    #[cfg(test)]
    pub fn total(&self) -> u32 {
        self.total.load(Ordering::Relaxed)
    }

    /// A sector read cleanly; the run of bad sectors (if any) is over.
    pub fn record_good(&mut self) {
        self.consecutive = 0;
    }

    /// A sector was unreadable and is being silenced. Returns `true` once the run of bad sectors
    /// is long enough that the drive should be considered gone.
    pub fn record_bad(&mut self) -> bool {
        self.total.fetch_add(1, Ordering::Relaxed);
        self.consecutive += 1;
        self.consecutive > MAX_CONSECUTIVE_BAD_SECTORS
    }
}

/// Read `count` sectors starting at `start_lba` into `buf`, riding out bad sectors.
///
/// `read(lba, count, buf)` is the raw platform read and returns the bytes it filled. A failed bulk
/// read is retried, then redone one sector at a time so a single bad sector doesn't cost its
/// neighbours. Unreadable sectors become silence (or an error in strict mode).
#[cfg(any(target_os = "windows", target_os = "linux", test))]
pub fn read_sectors_resilient(
    damage: &mut SectorDamage,
    start_lba: u32,
    count: u32,
    buf: &mut [u8],
    sector_bytes: usize,
    mut read: impl FnMut(u32, u32, &mut [u8]) -> Result<usize, String>,
) -> Result<usize, String> {
    let need = count as usize * sector_bytes;
    let mut last_err = String::new();

    for _ in 0..=READ_RETRIES {
        match read(start_lba, count, &mut buf[..need]) {
            Ok(filled) => {
                damage.record_good();
                return Ok(filled);
            }
            Err(err) => last_err = err,
        }
    }

    // Bulk read kept failing: isolate the bad sector(s).
    for i in 0..count {
        let lba = start_lba + i;
        let slot = &mut buf[i as usize * sector_bytes..(i as usize + 1) * sector_bytes];
        let mut readable = false;
        for _ in 0..=READ_RETRIES {
            match read(lba, 1, slot) {
                Ok(_) => {
                    readable = true;
                    break;
                }
                Err(err) => last_err = err,
            }
        }
        if readable {
            damage.record_good();
            continue;
        }
        if damage.strict {
            return Err(format!(
                "{UNREADABLE_SECTOR_PREFIX} (sector {lba}): {last_err}"
            ));
        }
        slot.fill(0);
        if damage.record_bad() {
            return Err(format!("Failed to read CD audio data: {last_err}"));
        }
    }
    Ok(need)
}

/// Read exactly `buf.len()` bytes at `pos`, re-seeking and retrying on I/O errors.
/// An unexpected EOF is not retried: it means the file ended, not that the media is bad.
#[cfg(any(target_os = "macos", test))]
pub fn read_exact_at_with_retry<R: Read + Seek>(
    reader: &mut R,
    pos: u64,
    buf: &mut [u8],
) -> std::io::Result<()> {
    let mut last = None;
    for _ in 0..=READ_RETRIES {
        match reader
            .seek(SeekFrom::Start(pos))
            .and_then(|_| reader.read_exact(buf))
        {
            Ok(()) => return Ok(()),
            Err(err) if err.kind() == ErrorKind::UnexpectedEof => return Err(err),
            Err(err) => last = Some(err),
        }
    }
    Err(last.expect("at least one attempt"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Cursor};

    const SECTOR: usize = 4;

    /// Bytes of sector `lba` in the fake disc: every byte is `lba + 1`.
    fn good(lba: u32) -> u8 {
        lba as u8 + 1
    }

    fn fake_read<'a>(
        bad: &'static [u32],
        flaky_once: &'static [u32],
        seen_flaky: &'a mut Vec<u32>,
    ) -> impl FnMut(u32, u32, &mut [u8]) -> Result<usize, String> + 'a {
        move |lba, count, buf| {
            for i in 0..count {
                let s = lba + i;
                if bad.contains(&s) {
                    return Err(format!("medium error at {s}"));
                }
                if flaky_once.contains(&s) && !seen_flaky.contains(&s) {
                    seen_flaky.push(s);
                    return Err(format!("transient error at {s}"));
                }
            }
            for i in 0..count as usize {
                buf[i * SECTOR..(i + 1) * SECTOR].fill(good(lba + i as u32));
            }
            Ok(count as usize * SECTOR)
        }
    }

    #[test]
    fn stalled_reads_use_up_the_budget() {
        let budget = RipBudget::with_limits(
            Duration::from_millis(10),
            Duration::from_millis(100),
            Duration::from_secs(5),
        );
        // Fast reads never count.
        assert!(budget.record_read(Duration::from_millis(5)).is_ok());
        // Slow ones add up until the budget is exceeded.
        assert!(budget.record_read(Duration::from_millis(60)).is_ok());
        let err = budget
            .record_read(Duration::from_millis(60))
            .expect_err("over budget");
        assert!(err.starts_with(UNREADABLE_SECTOR_PREFIX), "{err}");
    }

    #[test]
    fn a_blocked_read_is_abandoned_without_waiting_for_it() {
        let budget = Arc::new(RipBudget::with_limits(
            Duration::from_secs(1),
            Duration::from_secs(60),
            Duration::from_millis(250),
        ));
        let began = Instant::now();
        let err = run_budgeted(budget, |b| {
            b.begin_read()?;
            std::thread::sleep(Duration::from_secs(3)); // drive hangs in the read
            b.end_read()?;
            Ok(())
        })
        .expect_err("abandoned");
        assert!(err.starts_with(UNREADABLE_SECTOR_PREFIX), "{err}");
        assert!(
            began.elapsed() < Duration::from_secs(2),
            "{:?}",
            began.elapsed()
        );
    }

    #[test]
    fn a_healthy_read_returns_its_result() {
        let budget = Arc::new(RipBudget::new());
        let out = run_budgeted(budget, |b| {
            b.begin_read()?;
            b.end_read()?;
            Ok(42)
        })
        .expect("ok");
        assert_eq!(out, 42);
    }

    #[test]
    fn clean_read_passes_through() {
        let mut damage = SectorDamage::new(false);
        let mut buf = vec![0u8; 3 * SECTOR];
        let mut seen = Vec::new();
        let n = read_sectors_resilient(
            &mut damage,
            10,
            3,
            &mut buf,
            SECTOR,
            fake_read(&[], &[], &mut seen),
        )
        .expect("read");
        assert_eq!(n, 3 * SECTOR);
        assert_eq!(damage.total(), 0);
        assert_eq!(buf[0], good(10));
    }

    #[test]
    fn transient_error_is_retried_without_damage() {
        let mut damage = SectorDamage::new(false);
        let mut buf = vec![0u8; 3 * SECTOR];
        let mut seen = Vec::new();
        read_sectors_resilient(
            &mut damage,
            10,
            3,
            &mut buf,
            SECTOR,
            fake_read(&[], &[11], &mut seen),
        )
        .expect("read");
        assert_eq!(damage.total(), 0);
        assert_eq!(buf[SECTOR], good(11));
    }

    #[test]
    fn unreadable_sector_becomes_silence_and_neighbours_survive() {
        let mut damage = SectorDamage::new(false);
        let mut buf = vec![0xAAu8; 3 * SECTOR];
        let mut seen = Vec::new();
        let n = read_sectors_resilient(
            &mut damage,
            10,
            3,
            &mut buf,
            SECTOR,
            fake_read(&[11], &[], &mut seen),
        )
        .expect("read");
        assert_eq!(n, 3 * SECTOR);
        assert_eq!(damage.total(), 1);
        assert!(buf[..SECTOR].iter().all(|&b| b == good(10)));
        assert!(buf[SECTOR..2 * SECTOR].iter().all(|&b| b == 0));
        assert!(buf[2 * SECTOR..].iter().all(|&b| b == good(12)));
    }

    #[test]
    fn strict_mode_fails_on_unreadable_sector() {
        let mut damage = SectorDamage::new(true);
        let mut buf = vec![0u8; 3 * SECTOR];
        let mut seen = Vec::new();
        let err = read_sectors_resilient(
            &mut damage,
            10,
            3,
            &mut buf,
            SECTOR,
            fake_read(&[11], &[], &mut seen),
        )
        .expect_err("strict read fails");
        assert!(err.starts_with(UNREADABLE_SECTOR_PREFIX), "{err}");
    }

    #[test]
    fn a_long_dead_run_gives_up() {
        let mut damage = SectorDamage::new(false);
        let mut buf = vec![0u8; SECTOR];
        let mut result = Ok(0);
        for lba in 0..=MAX_CONSECUTIVE_BAD_SECTORS {
            result = read_sectors_resilient(&mut damage, lba, 1, &mut buf, SECTOR, |_, _, _| {
                Err("no disc".to_string())
            });
            if result.is_err() {
                break;
            }
        }
        let err = result.expect_err("gives up");
        assert!(err.starts_with("Failed to read CD audio data"), "{err}");
    }

    /// Reader whose first `fail_times` reads error, then serves `data`.
    struct Flaky {
        inner: Cursor<Vec<u8>>,
        fail_times: u32,
    }

    impl Read for Flaky {
        fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
            if self.fail_times > 0 {
                self.fail_times -= 1;
                return Err(io::Error::other("medium error"));
            }
            self.inner.read(out)
        }
    }

    impl Seek for Flaky {
        fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
            self.inner.seek(pos)
        }
    }

    #[test]
    fn file_read_retries_transient_errors() {
        let mut reader = Flaky {
            inner: Cursor::new(vec![1, 2, 3, 4]),
            fail_times: 2,
        };
        let mut buf = [0u8; 2];
        read_exact_at_with_retry(&mut reader, 1, &mut buf).expect("recovers");
        assert_eq!(buf, [2, 3]);
    }

    #[test]
    fn file_read_gives_up_after_retries() {
        let mut reader = Flaky {
            inner: Cursor::new(vec![1, 2, 3, 4]),
            fail_times: 100,
        };
        let mut buf = [0u8; 2];
        assert!(read_exact_at_with_retry(&mut reader, 0, &mut buf).is_err());
    }

    #[test]
    fn file_read_does_not_retry_eof() {
        let mut reader = Flaky {
            inner: Cursor::new(vec![1, 2]),
            fail_times: 0,
        };
        let mut buf = [0u8; 4];
        let err = read_exact_at_with_retry(&mut reader, 0, &mut buf).expect_err("eof");
        assert_eq!(err.kind(), ErrorKind::UnexpectedEof);
    }
}
