//! Self-hash integrity guard (anti-tamper Layer 1).
//!
//! Off the startup path, this hashes a region of its own on-disk
//! `__TEXT,__text` and compares it against a value embedded at build time by
//! `scripts/release/patch-guards.mjs`. A mismatch means the code was modified
//! after the build (e.g. a patched license branch); the guard raises the tamper
//! score ([`crate::tamper`]), which the reversible decay behaviors read. It
//! never blocks, exits, or enforces anything — detection and response are
//! deliberately decoupled (see `docs/anti-tamper.md`).
//!
//! The three slots below hold distinct magic sentinels until the post-link
//! patcher overwrites them with the real `__text` file offset, length, and
//! FNV-1a-64 hash. An unpatched build (dev, or a release not run through the
//! patcher) still carries the magics and is skipped — so it never
//! false-positives. `read_volatile` at each use site forces an actual load of
//! the patched value rather than letting the compiler fold in the magic.

// Several functions here are compiled in every build but only *called* in
// release / `tamper-test` builds — the detector runs only where decay can
// matter (see `spawn`), so dev/test builds would otherwise flag them unused.
// Correctness is covered by review, the release build, and the tamper-test
// suite rather than by this lint.
#![allow(dead_code)]

use crate::tamper;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::ptr::read_volatile;

// Shared code-region location (full __TEXT,__text), patched post-link. `#[used]`
// keeps them; the values are arbitrary high-entropy magics the patcher scans for.
#[used]
static G_OFF: u64 = 0xA17C_55E3_0B91_42F6;
#[used]
static G_LEN: u64 = 0xC4D2_19AF_73E8_5A0D;

// Per-guard expected hashes (one per seed), patched post-link. Scattered,
// distinct magics. Because every guard hashes the WHOLE code region, each
// guard's decision + the accumulator are themselves covered by every other
// guard: patching one guard's branch changes __text and trips the others, so an
// attacker must neutralise all N at once (or recompute all N keyed hashes).
#[used]
static G_SUM_1: u64 = 0x6F38_B1E0_9D4C_27A5;
#[used]
static G_SUM_2: u64 = 0x2D5A_9C14_E7B0_6183;
#[used]
static G_SUM_3: u64 = 0xB8E1_47F2_0CA6_3D9E;

const MAGIC_OFF: u64 = 0xA17C_55E3_0B91_42F6;
const MAGIC_LEN: u64 = 0xC4D2_19AF_73E8_5A0D;

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

// Per-guard seeds (compile-time; duplicated in scripts/release/patch-guards.mjs).
// Each guard mixes its seed into the FNV init so guards over the same region
// yield DIFFERENT expected hashes — a single recomputed value won't satisfy all.
const SEEDS: [u64; 3] = [
    0x9E37_79B1_85EB_CA87,
    0xD1B5_4A32_D192_ED03,
    0x1657_4B70_A78C_49E1,
];

/// The per-guard expected-hash slots, paired with their seeds via index.
fn expected_slot(i: usize) -> &'static u64 {
    match i {
        0 => &G_SUM_1,
        1 => &G_SUM_2,
        _ => &G_SUM_3,
    }
}

/// Added to the tamper score for each guard that confirms a mismatch.
const WEIGHT: u32 = 1000;

#[inline(never)]
fn slot(s: &u64) -> u64 {
    // SAFETY: `s` points at a live `'static u64`; a volatile read observes the
    // value the patcher wrote instead of a constant-folded magic.
    unsafe { read_volatile(s) }
}

fn hash_exe_region(off: u64, len: u64, seed: u64) -> Option<u64> {
    let exe = std::env::current_exe().ok()?;
    let mut f = File::open(&exe).ok()?;
    f.seek(SeekFrom::Start(off)).ok()?;
    let mut remaining = len;
    let mut buf = [0u8; 64 * 1024];
    let mut hash = FNV_OFFSET ^ seed;
    while remaining > 0 {
        let want = remaining.min(buf.len() as u64) as usize;
        let n = f.read(&mut buf[..want]).ok()?;
        if n == 0 {
            return None; // truncated: fail open rather than false-positive
        }
        for &b in &buf[..n] {
            hash ^= u64::from(b);
            hash = hash.wrapping_mul(FNV_PRIME);
        }
        remaining -= n as u64;
    }
    Some(hash)
}

/// One guard (index `i`): `true` if its keyed hash of the code region matches
/// its expected value, or the build is unpatched / unreadable (fail open —
/// never false-positive). `false` only on a confirmed mismatch. `#[inline]` so
/// the decision is duplicated at each call site rather than a single branch.
#[inline(always)]
fn guard_ok(i: usize) -> bool {
    let off = slot(&G_OFF);
    let len = slot(&G_LEN);
    if off == MAGIC_OFF || len == MAGIC_LEN {
        return true; // unpatched build — leave it alone
    }
    let expected = slot(expected_slot(i));
    match hash_exe_region(off, len, SEEDS[i]) {
        Some(actual) => actual == expected,
        None => true,
    }
}

/// `true` if every guard in the network verifies (or the build is unpatched).
pub fn verify() -> bool {
    (0..SEEDS.len()).all(guard_ok)
}

/// The patched `__TEXT,__text` file offset and length, or `None` on an
/// unpatched build (dev / not run through `patch-guards`). The integrity-keyed
/// frontend derives its decryption key from exactly this region, so a clean
/// build reproduces the key the patcher used and a patched binary does not.
pub fn text_region() -> Option<(u64, u64)> {
    let off = slot(&G_OFF);
    let len = slot(&G_LEN);
    if off == MAGIC_OFF || len == MAGIC_LEN {
        return None; // unpatched — no stable region to key off
    }
    Some((off, len))
}

/// Run every guard once, raising the tamper score for each confirmed mismatch.
/// Running all guards (rather than short-circuiting) means a patch is counted
/// by every guard that covers it.
pub fn run_once() {
    for i in 0..SEEDS.len() {
        if !guard_ok(i) {
            tamper::raise(WEIGHT);
        }
    }
}

/// True iff a debugger/tracer is attached to this process. Fails OPEN (returns
/// false) on any error, so it can never false-positive a legitimate user.
#[cfg(target_os = "macos")]
fn being_traced() -> bool {
    // sysctl(KERN_PROC, pid) → kinfo_proc; P_TRACED lives in kp_proc.p_flag.
    // Layout constants verified empirically against the SDK headers on arm64
    // (sizeof kinfo_proc = 648, offsetof kp_proc.p_flag = 32, P_TRACED = 0x800)
    // and bounds-checked below; anything unexpected fails open.
    const CTL_KERN: i32 = 1;
    const KERN_PROC: i32 = 14;
    const KERN_PROC_PID: i32 = 1;
    const KINFO_SIZE: usize = 648;
    const P_FLAG_OFFSET: usize = 32;

    let mut mib = [CTL_KERN, KERN_PROC, KERN_PROC_PID, unsafe {
        libc::getpid()
    }];
    let mut buf = [0u8; KINFO_SIZE];
    let mut len = buf.len();
    // SAFETY: standard sysctl call; buffer and lengths are sized to kinfo_proc.
    let rc = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as u32,
            buf.as_mut_ptr().cast(),
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc != 0 || len < P_FLAG_OFFSET + 4 {
        return false;
    }
    let p_flag = u32::from_ne_bytes(buf[P_FLAG_OFFSET..P_FLAG_OFFSET + 4].try_into().unwrap());
    traced_from_flag(p_flag)
}

#[cfg(not(target_os = "macos"))]
fn being_traced() -> bool {
    false
}

#[inline]
fn traced_from_flag(p_flag: u32) -> bool {
    const P_TRACED: u32 = 0x800;
    p_flag & P_TRACED != 0
}

/// One detection tick: a debugger attached at any time feeds the accumulator,
/// so the app decays *during* a dynamic-analysis session rather than failing
/// cleanly — the lldb-watchpoint attack becomes self-defeating.
fn trace_check() {
    if being_traced() {
        tamper::raise(WEIGHT);
    }
}

/// Independent detector (doesn't route through `sysctl`, so defeating the
/// `P_TRACED` check doesn't defeat this): time a tight arithmetic loop that
/// normally runs in microseconds. Under instruction-level debugging
/// (single-stepping, or dense software/hardware breakpoints) each instruction
/// incurs a debugger round-trip, inflating it by orders of magnitude.
///
/// FP-safe by construction: we take the MIN of several runs (so scheduler
/// preemption spikes don't count — at least one run is uninterrupted) and flag
/// only an absurd, debugger-grade slowdown (>20 ms for ~thousands of cheap
/// ops, which is ~microseconds normally — a >1000x margin over even a slow VM).
fn single_step_suspected() -> bool {
    use std::time::Instant;
    const REPS: usize = 5;
    const ITERS: u64 = 2000;
    const THRESHOLD_NANOS: u128 = 20_000_000; // 20 ms

    let mut best = u128::MAX;
    for _ in 0..REPS {
        let start = Instant::now();
        let mut x: u64 = 0x9e37_79b9_7f4a_7c15;
        for i in 0..ITERS {
            x = x
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(i | 1);
            std::hint::black_box(x);
        }
        std::hint::black_box(x);
        best = best.min(start.elapsed().as_nanos());
    }
    best > THRESHOLD_NANOS
}

/// One timing tick: flags instruction-level debugging into the accumulator.
fn timing_check() {
    if single_step_suspected() {
        tamper::raise(WEIGHT);
    }
}

/// Cheap time-based jitter (no RNG dep): `base + [0, span)` ms.
fn jitter_ms(base: u64, span: u64) -> u64 {
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| u64::from(d.subsec_nanos()))
        .unwrap_or(0);
    base + (n % span.max(1))
}

/// Time-distributed detector: an immediate self-hash + debugger check at
/// startup, then a jittered loop that re-checks for a tracer every tick and
/// re-hashes the code occasionally. Spreading the reads across time and sites
/// buries the signal a single watchpoint would key on, and catches a debugger
/// or a runtime patch that appears after launch.
fn detection_loop() {
    run_once();
    trace_check();
    timing_check();
    let mut tick: u64 = 0;
    loop {
        std::thread::sleep(std::time::Duration::from_millis(jitter_ms(10_000, 20_000)));
        tick = tick.wrapping_add(1);
        trace_check();
        timing_check();
        if tick % 8 == 0 {
            run_once();
        }
    }
}

/// Headless dynamic self-test (QA / `tamper-test` only): run each real detector
/// once and report (debugger-attached?, single-step-slow?, guards-intact?,
/// resulting score). Lets a dynamic test confirm — under an actual debugger —
/// that Spiral's detectors fire and feed the accumulator, without launching the
/// GUI. Returns `(traced, timing_slow, guards_ok, score)`.
#[cfg(feature = "tamper-test")]
pub fn dynamic_probe() -> (bool, bool, bool, u32) {
    let traced = being_traced();
    let timing_slow = single_step_suspected();
    let guards_ok = verify();
    if traced {
        tamper::raise(WEIGHT);
    }
    if timing_slow {
        tamper::raise(WEIGHT);
    }
    (traced, timing_slow, guards_ok, tamper::score())
}

/// Start the detector off the startup path so it never blocks launch. Only in
/// builds where decay can matter (release, or the `tamper-test` QA feature) —
/// dev builds pay nothing and are never affected by an attached debugger.
pub fn spawn() {
    #[cfg(any(not(debug_assertions), feature = "tamper-test"))]
    {
        std::thread::spawn(detection_loop);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unpatched_build_verifies_fail_open() {
        // In-tree test binaries are never run through the patcher, so the magics
        // survive and verify() must fail open (true) — i.e. never false-positive.
        assert!(verify());
    }

    #[test]
    fn trace_flag_extraction() {
        // Deterministic check of the P_TRACED bit logic, independent of whether
        // the test process is actually traced. 0x4004 = this process untraced
        // (observed); 0x4804 = same with P_TRACED (0x800) set.
        assert!(!traced_from_flag(0x4004));
        assert!(traced_from_flag(0x4804));
        assert!(!traced_from_flag(0));
    }

    #[test]
    fn timing_check_quiet_without_a_debugger() {
        // Not single-stepped in CI → the tight loop runs in microseconds, far
        // under the 20 ms threshold, so this must not fire (no false positive).
        assert!(!single_step_suspected());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn not_traced_under_normal_test_run() {
        // cargo test is not run under a debugger in CI; fail-open guarantees
        // this never panics regardless.
        assert!(!being_traced());
    }

    #[test]
    fn fnv_matches_reference_vector() {
        // Cross-checks the constants against a known FNV-1a-64 vector so the
        // Rust and patcher implementations cannot silently diverge. FNV-1a-64
        // of "a" = 0xaf63dc4c8601ec8c.
        let mut h = FNV_OFFSET;
        for &b in b"a" {
            h ^= u64::from(b);
            h = h.wrapping_mul(FNV_PRIME);
        }
        assert_eq!(h, 0xaf63_dc4c_8601_ec8c);
    }
}
