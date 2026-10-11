// Old substring vs fuzzy search on synthetic data. Run:
//   npx esbuild scripts/bench-fuzzy-search.ts --bundle --platform=node --format=esm --outfile=$TMPDIR/bench.mjs && node --expose-gc $TMPDIR/bench.mjs [trackCount]
import { createFuzzyMatcher } from "../src/lib/fuzzySearch";

interface T {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
}
const syl = [
  "ra",
  "di",
  "o",
  "head",
  "bea",
  "tles",
  "fle",
  "et",
  "wood",
  "mac",
  "bon",
  "jo",
  "vi",
  "pink",
  "floyd",
  "dark",
  "side",
  "moon",
  "road",
  "abbey",
  "kid",
  "a",
  "ok",
  "com",
  "pu",
  "ter",
  "ne",
  "ver",
  "mind",
  "bul",
  "lets",
  "ho",
  "tel",
  "ca",
  "li",
  "for",
  "nia",
];
let seed = 42;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const word = () => {
  let s = "";
  for (let n = 1 + ((rnd() * 3) | 0); n--;) s += syl[(rnd() * syl.length) | 0];
  return s;
};
const phrase = (n: number) =>
  Array.from({ length: 1 + ((rnd() * n) | 0) }, word).join(" ");
const N = Number(process.argv[2] ?? 50000);
const tracks: T[] = Array.from({ length: N }, () => ({
  title: phrase(4),
  artist: phrase(2),
  album: phrase(3),
  albumArtist: phrase(2),
}));

const oldMatch = (t: T, q: string) => {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [t.title, t.artist, t.album, t.albumArtist]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(s);
};
const fz = createFuzzyMatcher<T>((t) => [
  { fields: [t.title], weight: 1 },
  { fields: [t.artist, t.album, t.albumArtist], weight: 0.75 },
]);
const queries = [
  "r",
  "ra",
  "radi",
  "radiohed",
  "pink flo",
  "bonjovi",
  "darkside moon",
  "zzzxq",
  "beatels road",
];
const heap = () => {
  (globalThis as any).gc?.();
  return process.memoryUsage().heapUsed / 1048576;
};
const time = (f: () => unknown, reps = 5) => {
  const ts: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    f();
    ts.push(performance.now() - t0);
  }
  ts.sort((a, b) => a - b);
  return ts[ts.length >> 1];
};

console.log(`tracks: ${N}`);
const h0 = heap();
const t0 = performance.now();
fz.filter(tracks, "warm");
console.log(
  `first (cold, builds index): ${(performance.now() - t0).toFixed(1)} ms`,
);
const h1 = heap();
console.log(`index heap: +${(h1 - h0).toFixed(1)} MB`);
console.log(
  "query".padEnd(16),
  "old ms".padStart(8),
  "new ms".padStart(8),
  "hits old/new",
);
for (const q of queries) {
  const o = time(() => tracks.filter((t) => oldMatch(t, q)));
  const n = time(() => fz.filter(tracks, q));
  console.log(
    q.padEnd(16),
    o.toFixed(1).padStart(8),
    n.toFixed(1).padStart(8),
    `${tracks.filter((t) => oldMatch(t, q)).length}/${fz.filter(tracks, q).length}`,
  );
}
