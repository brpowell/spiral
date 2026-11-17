//! Tolerance for unreadable CD sectors (scratches, dirt, failing media).
//!
//! Reads are retried; sectors that stay unreadable are replaced with silence during playback and
//! counted, so one bad patch doesn't end the track. Ripping uses `strict` mode instead and fails
//! on the first unreadable sector, so a glitched file never lands in the library.
#![cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]

#[cfg(any(target_os = "macos", test))]
use std::io::{ErrorKind, Read, Seek, SeekFrom};
use std::sync::atomic::AtomicU32;
use std::sync::atomic::Ordering;
use std::sync::Arc;

/// Extra attempts after a failed read before a sector is declared unreadable.
pub const READ_RETRIES: u32 = 3;

/// Consecutive unreadable sectors (~2.7 s of audio) after which the drive is assumed gone or the
/// disc beyond saving, and playback stops with an error instead of playing silence forever.
pub const MAX_CONSECUTIVE_BAD_SECTORS: u32 = 200;

/// Prefix of the error a strict (rip) read returns for an unreadable sector. The frontend matches
/// on it to show a "damaged disc" message, so keep it in sync with `cdPlaybackFailure.ts`.
pub const UNREADABLE_SECTOR_PREFIX: &str = "Unreadable section of disc";

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
