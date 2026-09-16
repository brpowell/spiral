//! Cross-platform advisory exclusive file lock (no extra crate).
//!
//! Unix: `flock(LOCK_EX)`. Windows: `LockFileEx` exclusive.
//! Released when the [`File`] is dropped (handle closed).

use std::fs::File;
use std::io;

/// Block until an exclusive advisory lock is held on `file`.
pub fn lock_exclusive(file: &File) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
        if rc == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::Storage::FileSystem::{LockFileEx, LOCKFILE_EXCLUSIVE_LOCK};
        use windows::Win32::System::IO::OVERLAPPED;

        // Lock the whole file (length = u64::MAX via two u32 parts).
        let mut overlapped = OVERLAPPED::default();
        unsafe {
            LockFileEx(
                HANDLE(file.as_raw_handle()),
                LOCKFILE_EXCLUSIVE_LOCK,
                0,
                u32::MAX,
                u32::MAX,
                &mut overlapped,
            )
        }
        .map_err(|e| io::Error::from_raw_os_error(e.code().0))
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = file;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "advisory file locks are not supported on this platform",
        ))
    }
}
