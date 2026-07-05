#!/usr/bin/env python3
"""
gifnorm.py -- normalize animated-GIF frame timing for cross-renderer consistency.

WHY THIS EXISTS
---------------
Classic Windows Media Player skins routinely encode GIF frame delays *below* the
browser "minimum frame delay" clamp. GIF stores each frame's delay in centiseconds
(1/100 s). Web browsers silently refuse to honor very short delays: a stored delay
of 0 or 1 centisecond is bumped up to 10 centiseconds (100 ms). A literal GIF
decoder -- like a custom skin engine -- honors the raw value instead.

Result: the *same* asset plays at the right speed in a browser and far too fast in
the app (all-1cs files), or plays smoothly in the app but snaps at the end in a
browser (mixed 0cs / 2cs files). Either way the two renderers disagree.

WHAT THIS DOES
--------------
- REPORT (default): scans files/folders and flags any GIF whose encoded timing
  would render differently in a browser vs a literal decoder.
- NORMALIZE (--write): rewrites the timing so every renderer agrees. It patches
  ONLY the 2 delay bytes inside each frame's Graphics Control Extension, so pixels,
  palettes, transparency, and frame-disposal data stay byte-for-byte identical.

MODES
-----
  browser (default) : bake the browser's clamp into the file. Any delay below the
                      floor becomes the clamp target (default 100 ms); everything
                      else is kept. Player output == what you already see in-browser.
  floor             : raise any sub-floor delay up to a minimum (default 20 ms) but
                      DON'T force the 100 ms jump. Preserves the author's relative
                      timing while killing the "too fast" blink.
  uniform           : force one delay on every frame (--delay-ms).

Optionally sets the loop count (--loop; 0 = infinite) for e.g. hover states that
should repeat while hovered.
"""

import argparse
import os
import sys


# ----------------------------- GIF structure walk -----------------------------

def walk(data: bytes) -> dict:
    """Parse a GIF's block structure. Returns byte offsets we may patch, without
    touching any image data. Raises ValueError on anything that isn't a GIF we
    can safely reason about."""
    n = len(data)
    if data[:3] != b"GIF":
        raise ValueError("not a GIF (bad magic)")

    packed = data[10]
    pos = 13
    if packed & 0x80:                       # skip global color table
        pos += 3 * (2 << (packed & 0x07))

    first_graphic = None                    # where to splice a loop ext, if needed
    gce_delay_offsets = []                  # offset of the delay low-byte per frame
    image_count = 0
    loop_count = None
    loop_count_off = None

    def read_subblocks(p):
        while True:
            if p >= n:
                raise ValueError("truncated sub-block stream")
            sz = data[p]; p += 1
            if sz == 0:
                break
            p += sz
        return p

    while pos < n:
        b = data[pos]
        if b == 0x3B:                       # trailer
            break
        elif b == 0x21:                     # extension introducer
            label = data[pos + 1]
            if label == 0xF9:               # graphics control extension
                if first_graphic is None:
                    first_graphic = pos
                bsize = data[pos + 2]       # always 4
                gce_delay_offsets.append(pos + 4)   # [packed][lo][hi][transp]
                pos = pos + 3 + bsize + 1   # + block terminator
            elif label == 0xFF:             # application extension
                bsize = data[pos + 2]
                app_id = bytes(data[pos + 3:pos + 3 + bsize])
                p = pos + 3 + bsize
                if app_id.startswith(b"NETSCAPE") and data[p] == 0x03 and data[p + 1] == 0x01:
                    loop_count_off = p + 2
                    loop_count = data[p + 2] | (data[p + 3] << 8)
                pos = read_subblocks(p)
            else:                           # comment / plain-text / other
                pos = read_subblocks(pos + 2)
        elif b == 0x2C:                     # image descriptor = one frame
            if first_graphic is None:
                first_graphic = pos
            image_count += 1
            lp = data[pos + 9]
            p = pos + 10
            if lp & 0x80:                   # skip local color table
                p += 3 * (2 << (lp & 0x07))
            p += 1                          # LZW minimum code size
            pos = read_subblocks(p)
        else:
            raise ValueError(f"unexpected byte 0x{b:02x} at offset {pos}")

    return {
        "gce_delay_offsets": gce_delay_offsets,
        "image_count": image_count,
        "loop_count": loop_count,
        "loop_count_off": loop_count_off,
        "first_graphic": first_graphic if first_graphic is not None else n,
    }


def delays_cs(data: bytes, struct: dict) -> list:
    """Encoded delay of each timed frame, in centiseconds."""
    return [data[o] | (data[o + 1] << 8) for o in struct["gce_delay_offsets"]]


# ----------------------------- timing model -----------------------------

def browser_effective_cs(cs: int, floor_cs: int, clamp_cs: int) -> int:
    """What a browser actually renders a given encoded delay as."""
    return clamp_cs if cs < floor_cs else cs


def target_cs(cs: int, mode: str, floor_cs: int, clamp_cs: int,
              min_cs: int, uniform_cs: int) -> int:
    if mode == "browser":
        return browser_effective_cs(cs, floor_cs, clamp_cs)
    if mode == "floor":
        return max(cs, min_cs)
    if mode == "uniform":
        return uniform_cs
    raise ValueError(mode)


# ----------------------------- apply -----------------------------

def apply(data: bytes, struct: dict, mode: str, floor_cs: int, clamp_cs: int,
          min_cs: int, uniform_cs: int, set_loop):
    out = bytearray(data)
    frame_changes = 0

    for off in struct["gce_delay_offsets"]:
        cur = out[off] | (out[off + 1] << 8)
        new = target_cs(cur, mode, floor_cs, clamp_cs, min_cs, uniform_cs)
        if new != cur:
            out[off] = new & 0xFF
            out[off + 1] = (new >> 8) & 0xFF
            frame_changes += 1

    loop_changed = False
    if set_loop is not None:
        if struct["loop_count_off"] is not None:            # patch existing
            o = struct["loop_count_off"]
            if (out[o] | (out[o + 1] << 8)) != set_loop:
                out[o] = set_loop & 0xFF
                out[o + 1] = (set_loop >> 8) & 0xFF
                loop_changed = True
        else:                                               # splice one in
            ext = (bytes([0x21, 0xFF, 0x0B]) + b"NETSCAPE2.0"
                   + bytes([0x03, 0x01, set_loop & 0xFF, (set_loop >> 8) & 0xFF, 0x00]))
            ip = struct["first_graphic"]                    # before frame 1
            out[ip:ip] = ext
            loop_changed = True

    return bytes(out), frame_changes, loop_changed


# ----------------------------- reporting -----------------------------

def runs(seq):
    """Compress a list into (value, count) runs for readable printing."""
    out = []
    for v in seq:
        if out and out[-1][0] == v:
            out[-1][1] += 1
        else:
            out.append([v, 1])
    return [(v, c) for v, c in out]


def analyze(path, data, floor_cs, clamp_cs):
    struct = walk(data)
    cs = delays_cs(data, struct)
    literal_ms = sum(c * 10 for c in cs)
    browser_ms = sum(browser_effective_cs(c, floor_cs, clamp_cs) * 10 for c in cs)
    mismatch = literal_ms != browser_ms
    untimed = struct["image_count"] - len(cs)
    return struct, cs, literal_ms, browser_ms, mismatch, untimed


def print_report(path, struct, cs, literal_ms, browser_ms, mismatch, untimed):
    r = ", ".join(f"{v*10}ms x{c}" for v, c in runs(cs))
    loop = struct["loop_count"]
    loop_s = ("plays once" if loop is None else
              "loops forever" if loop == 0 else f"loops {loop}x")
    print(f"  {os.path.basename(path)}")
    print(f"    frames: {len(cs)}   {loop_s}")
    print(f"    delays: {r}")
    if untimed > 0:
        print(f"    NOTE: {untimed} frame(s) have no timing block (decoder-dependent)")
    if mismatch:
        print(f"    MISMATCH  browser ~{browser_ms}ms  vs  literal decoder {literal_ms}ms")
    else:
        print(f"    ok        {literal_ms}ms in every renderer")


# ----------------------------- CLI -----------------------------

def gather(paths, recursive):
    files = []
    for p in paths:
        if os.path.isdir(p):
            if recursive:
                for root, _, names in os.walk(p):
                    files += [os.path.join(root, f) for f in names
                              if f.lower().endswith(".gif")]
            else:
                files += [os.path.join(p, f) for f in sorted(os.listdir(p))
                          if f.lower().endswith(".gif")]
        else:
            files.append(p)
    return files


def out_path(src, args):
    if args.in_place:
        return src
    if args.out:
        os.makedirs(args.out, exist_ok=True)
        return os.path.join(args.out, os.path.basename(src))
    root, ext = os.path.splitext(src)
    return f"{root}{args.suffix}{ext}"


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Report and normalize animated-GIF frame timing so browsers "
                    "and literal decoders (skin engines) render identically.")
    ap.add_argument("paths", nargs="+", help="GIF files and/or folders")
    ap.add_argument("-r", "--recursive", action="store_true",
                    help="recurse into folders")
    ap.add_argument("--write", action="store_true",
                    help="apply normalization (default is report-only)")
    ap.add_argument("--mode", choices=["browser", "floor", "uniform"],
                    default="browser",
                    help="normalization strategy (default: browser)")
    ap.add_argument("--floor-ms", type=int, default=20,
                    help="delays below this are treated as sub-floor (default 20)")
    ap.add_argument("--clamp-ms", type=int, default=100,
                    help="browser mode: what sub-floor delays become (default 100)")
    ap.add_argument("--min-ms", type=int, default=20,
                    help="floor mode: minimum delay to raise to (default 20)")
    ap.add_argument("--delay-ms", type=int, default=100,
                    help="uniform mode: delay for every frame (default 100)")
    ap.add_argument("--loop", type=int, default=None, metavar="N",
                    help="set loop count; 0 = infinite (default: leave unchanged)")
    ap.add_argument("--in-place", action="store_true",
                    help="overwrite originals (default writes *.normalized.gif)")
    ap.add_argument("--out", metavar="DIR", help="write outputs into DIR")
    ap.add_argument("--suffix", default=".normalized",
                    help="filename suffix when not in-place (default .normalized)")
    ap.add_argument("--dry-run", action="store_true",
                    help="with --write, report what would change without writing")
    args = ap.parse_args(argv)

    # ms -> centiseconds (round to nearest)
    floor_cs = max(0, round(args.floor_ms / 10))
    clamp_cs = max(0, round(args.clamp_ms / 10))
    min_cs = max(0, round(args.min_ms / 10))
    uniform_cs = max(0, round(args.delay_ms / 10))

    files = gather(args.paths, args.recursive)
    if not files:
        print("No .gif files found.", file=sys.stderr)
        return 1

    changed = skipped = clean = 0
    for src in files:
        try:
            data = open(src, "rb").read()
            struct, cs, lit, brow, mismatch, untimed = analyze(src, data, floor_cs, clamp_cs)
        except (ValueError, OSError) as e:
            print(f"  {os.path.basename(src)}\n    SKIP ({e})")
            skipped += 1
            continue

        print_report(src, struct, cs, lit, brow, mismatch, untimed)

        if not args.write:
            clean += 0 if mismatch else 1
            continue

        new, fchg, lchg = apply(data, struct, args.mode, floor_cs, clamp_cs,
                                min_cs, uniform_cs, args.loop)
        if fchg == 0 and not lchg:
            print("    -> already normalized, no change")
            clean += 1
            continue

        dst = out_path(src, args)
        note = f"{fchg} frame delay(s)" + (", loop set" if lchg else "")
        if args.dry_run:
            print(f"    -> would rewrite {note}  ->  {dst}")
        else:
            open(dst, "wb").write(new)
            print(f"    -> rewrote {note}  ->  {dst}")
        changed += 1

    print(f"\n{len(files)} file(s): "
          + (f"{changed} rewritten, " if args.write else "")
          + f"{clean} already consistent, {skipped} skipped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
