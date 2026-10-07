#!/usr/bin/env node
/**
 * Post-link patcher for the self-hash integrity guard.
 *
 *   node scripts/release/patch-guards.mjs <path-to-macho-binary>
 *
 * The Rust guard (src/selfcheck.rs) ships three 8-byte magic sentinels. This
 * step, run AFTER `tauri build` has produced (and ad-hoc signed) the binary:
 *   1. reads the __TEXT,__text section's file offset + size (via `otool -l`),
 *   2. computes FNV-1a-64 over those file bytes,
 *   3. overwrites the magics with {offset, len, hash} as little-endian u64,
 *   4. re-signs ad-hoc (the edit invalidated the signature; arm64 refuses to
 *      run an invalidly-signed binary).
 *
 * The sentinels live outside __text, so writing them does not change the bytes
 * being hashed (no fixpoint). On a clean build the guard's runtime hash equals
 * the value written here; a later code patch changes __text and trips it.
 *
 * macOS-only for now (uses otool/codesign); Linux/Windows guards come later.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x00000100000001b3n;
const MASK64 = (1n << 64n) - 1n;

// Must match src/selfcheck.rs exactly.
const MAGIC_OFF = 0xa17c55e30b9142f6n;
const MAGIC_LEN = 0xc4d219af73e85a0dn;
const MAGIC_SUMS = [0x6f38b1e09d4c27a5n, 0x2d5a9c14e7b06183n, 0xb8e147f20ca63d9en];
// Per-guard seeds (must match SEEDS in src/selfcheck.rs).
const SEEDS = [0x9e3779b185ebca87n, 0xd1b54a32d192ed03n, 0x16574b70a78c49e1n];

function die(msg) {
  console.error(`patch-guards: ${msg}`);
  process.exit(1);
}

function leBytes(v) {
  const b = Buffer.alloc(8);
  let x = v & MASK64;
  for (let i = 0; i < 8; i++) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

function fnv1a64(buf, seed) {
  let h = (FNV_OFFSET ^ seed) & MASK64;
  for (let i = 0; i < buf.length; i++) {
    h = (h ^ BigInt(buf[i])) & MASK64;
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

/** Parse `otool -l` for the __TEXT,__text section's file offset + size. */
function textSection(bin) {
  const out = execFileSync("otool", ["-l", bin], { encoding: "utf8" });
  const lines = out.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "sectname __text") {
      // The following lines include segname/addr/size/offset for this section.
      const win = lines.slice(i, i + 8).map((l) => l.trim());
      if (!win.some((l) => l === "segname __TEXT")) continue;
      const size = win.find((l) => l.startsWith("size "));
      const offset = win.find((l) => l.startsWith("offset "));
      if (!size || !offset) die("could not read __text size/offset");
      return {
        size: Number(BigInt(size.split(/\s+/)[1])),
        offset: Number(offset.split(/\s+/)[1]),
      };
    }
  }
  die("no __TEXT,__text section found");
}

/** Find the single occurrence of `magic` (LE) outside the __text range. */
function findSlot(buf, magic, text, label) {
  const needle = leBytes(magic);
  const first = buf.indexOf(needle);
  if (first < 0) die(`magic ${label} not found (guard not compiled in?)`);
  if (buf.indexOf(needle, first + 1) >= 0)
    die(`magic ${label} occurs more than once — pick a new magic`);
  if (first >= text.offset && first < text.offset + text.size)
    die(`magic ${label} lies inside __text — would corrupt code`);
  return first;
}

const bin = process.argv[2];
if (!bin) die("usage: patch-guards.mjs <binary>");

const buf = readFileSync(bin);

// Idempotency: if the OFF sentinel is gone the binary is already patched (e.g.
// an incremental `tauri build` that didn't relink) — skip rather than fail.
if (buf.indexOf(leBytes(MAGIC_OFF)) < 0) {
  console.log(
    "patch-guards: no guard sentinels found (already patched or guards absent) — skipping",
  );
  process.exit(0);
}

const text = textSection(bin);
if (text.offset + text.size > buf.length) die("__text extends past EOF");
const code = buf.subarray(text.offset, text.offset + text.size);

// Locate every slot first (fails loudly if the guard network isn't compiled in
// or a magic collides), then compute + write.
const offSlot = findSlot(buf, MAGIC_OFF, text, "OFF");
const lenSlot = findSlot(buf, MAGIC_LEN, text, "LEN");
const sumSlots = MAGIC_SUMS.map((m, i) => findSlot(buf, m, text, `SUM_${i + 1}`));

leBytes(BigInt(text.offset)).copy(buf, offSlot);
leBytes(BigInt(text.size)).copy(buf, lenSlot);
const hashes = SEEDS.map((seed) => fnv1a64(code, seed));
hashes.forEach((h, i) => leBytes(h).copy(buf, sumSlots[i]));
writeFileSync(bin, buf);

// Re-sign: the edit invalidated the signature; arm64 won't run an invalid one.
execFileSync("codesign", ["-f", "-s", "-", bin], { stdio: "inherit" });

console.log(
  `patch-guards: __text off=${text.offset} len=${text.size} ` +
    `guards=${hashes.length} ` +
    `fnv=[${hashes.map((h) => "0x" + h.toString(16).padStart(16, "0")).join(", ")}] ` +
    `→ re-signed ad-hoc`,
);
