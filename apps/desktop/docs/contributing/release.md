# Releasing Spiral

How a version goes from `main` to installers on a GitHub Release. For the full decision history (channels, signing, updater UX), see [`release-process-plan.md`](./release-process-plan.md). Signing keys, secret layout, and local sign/verify: [`signing-and-keys.md`](./signing-and-keys.md).

## At a glance

1. Merge normal PRs into `main` — nothing ships yet.
2. **release-please** keeps a standing release PR updated with the version bump and changelog.
3. Merge that release PR when you’re ready to cut a version.
4. CI creates the `vX.Y.Z` tag and a **draft** GitHub Release, then builds macOS + Windows + Linux installers and attaches them.
5. **All platforms green** must pass before treating the draft as ready.
6. Publish via the **Publish Release** workflow (manual gate) when you’re ready for it to go live.

Merging a feature PR never releases by itself. Only merging the release PR starts the cut.

## Day to day (steps 1–2)

Work lands on `main` through PRs. Titles must be [Conventional Commits](./contributing.md) — that title becomes the squash commit, which is what release-please reads.

On every push to `main`, [release-please](https://github.com/googleapis/release-please) opens or updates a single PR, roughly titled `chore(main): release X.Y.Z`. It:

- Bumps `package.json` and `src-tauri/tauri.conf.json` together
- Regenerates the changelog from commits since the last tag

That PR just accumulates. Land as many features/fixes as you want before shipping.

## Cutting a release (steps 3–4)

1. Open the standing release PR. Skim **`CHANGELOG.md`** in the PR — that file is the internal record (compare links, PR/commit SHAs, chore/ci/test noise). Fix anything misleading before merge; do not treat it as user-facing copy.
2. Merge it.
3. release-please creates the `vX.Y.Z` tag and a **draft** GitHub Release. CI then rewrites **only the draft body** (drop the version/compare header, keep Features / Bug Fixes, strip PR/commit links). `CHANGELOG.md` is left as release-please wrote it. The draft body is what users will see in What's New — wordsmith it freely before Publish if you want; that pass is not re-applied later.
4. The [Release](../.github/workflows/release.yml) workflow builds:
   - macOS arm64 + x64 → `--bundles app,dmg` (DMG installer + updater `.app.tar.gz` / `.sig`; `app` must be explicit or the bundler deletes `Spiral.app` and no updater tarball is left)
   - Windows x64 → NSIS (`*-setup.exe` + `.sig`; NSIS is also the updater payload)
   - Linux x64 (`ubuntu-22.04`) + aarch64 (`ubuntu-22.04-arm`) → `--bundles appimage` (AppImage is the v1 Direct download **and** the updater payload — Tauri `.AppImage` + `.sig`). Optional `.deb` is [#333](https://github.com/spiral-powered/spiral-desktop/issues/333), not a release gate.
5. The **All platforms green** job (`platforms-green`) only passes when every matrix cell succeeded **and** the draft has installers **and** updater signatures for every platform. Treat the draft as ready only when that check is green — a partial matrix never counts. Asset expectations live in [`scripts/release/required-release-assets.mjs`](../../scripts/release/required-release-assets.mjs). Updater artifacts require `bundle.createUpdaterArtifacts` and `TAURI_SIGNING_PRIVATE_KEY` on the `production-release` environment.

**Re-run a build** (e.g. one platform failed): Actions → **Release** → Run workflow → enter the tag (`v0.2.0`).

## Publishing (step 6)

Only after **All platforms green** is green:

1. Actions → **Publish Release** → Run workflow → enter the tag (`v0.2.0`), **or**
2. Locally: `npm run release -- publish v0.2.0`

Both re-check that the draft has installers and updater artifacts, then undraft the GitHub Release. That publish is the go-live moment for Direct-channel auto-update once the marketing-site update route serves published releases.

The job uses the `production-release` Environment. Required reviewers are the intended long-term approval UI; they are not available on this private repo’s current GitHub plan, so **running the workflow is the human gate**. Details: [`signing-and-keys.md`](./signing-and-keys.md).

To re-run the notes sanitizer or backfill an older published release that still has a raw changelog body, use `sanitize-notes` (commands below). `--dry-run` prints the result without editing. Skip a live rewrite if you already rewrote the body — it would drop freeform edits that are not Features / Bug Fixes headings.

## Local release tooling

One npm script, subcommands via `--`:

```bash
npm run release -- installer              # native for this OS (dmg / nsis / linux AppImage)
npm run release -- installer deb          # Linux .deb only (optional later, #333)
npm run release -- installer dmg -- --target aarch64-apple-darwin
npm run release -- publish v0.2.0
npm run release -- check v0.2.0
npm run release -- check-bundle           # local packaged tree (no extra bins)
npm run release -- sanitize-notes v0.2.0            # re-run / backfill user-facing notes
npm run release -- sanitize-notes v0.2.0 --dry-run  # print sanitized notes; no edit
npm run release -- sign path/to/artifact
npm run release -- verify path/to/artifact
npm run release -- keys
```

`npm run release -- installer` runs `tauri build`, then `check-bundle` (no developer Cargo bins). Same `check-bundle` command as the Release workflow’s post-build step.

`npm run release -- --help` lists commands. Output lands under `src-tauri/target/**/bundle/`. Apple/Windows code signing is optional; **updater** signing is required for a full local bundle (`TAURI_SIGNING_PRIVATE_KEY` / `_PATH`) because `createUpdaterArtifacts` is on.

On Linux, the Direct download is the AppImage: `chmod +x` then run. CI ships both arches: `_amd64.AppImage` and `_aarch64.AppImage` (plus matching `.sig` updater signatures). User-facing download/run notes: [`docs/guides/linux.md`](../guides/linux.md).

Linux installer commands set `APPIMAGE_EXTRACT_AND_RUN=1` (when building AppImage) and a disk-backed `TMPDIR` under `src-tauri/target/tmp`. That avoids two common VM footguns: no FUSE for linuxdeploy, and `/tmp` mounted as tmpfs **with usrquota** (Cursor’s sandbox cache can exhaust the quota so `df` still shows free space while every write returns `Disk quota exceeded (os error 122)`). If you invoke `tauri build` directly, export the same env first:

```bash
export TMPDIR="$PWD/src-tauri/target/tmp" TMP="$TMPDIR" TEMP="$TMPDIR"
mkdir -p "$TMPDIR"
```

Reclaim disk after big builds: `npm run clean:target` (`cargo clean` in `src-tauri`).

## Debug builds and the updater

`tauri dev` (Vite `import.meta.env.DEV`) **does not** check for or install live updates by default.

**Why:** debug binaries live under `src-tauri/target/debug/`. The packaged app version is usually still behind a published release, so a live update prompt is common. Accepting it can unpack a release bundle over the debug tree, relaunch outside the Vite session, and migrate the shared library DB in ways an older local binary can't read.

**Override** (only when you intentionally want the debug session to hit the update endpoint):

```bash
SPIRAL_ENABLE_UPDATER=1 npm run tauri dev
```

(`true` also works. Vite exposes `SPIRAL_*` via `envPrefix` in `vite.config.ts`.)

Packaged / release builds are unaffected — the gate only applies in DEV. End-to-end update testing still wants two **installed** builds (older → newer published or local signed release), not `tauri dev`; see [release-process-plan.md](./release-process-plan.md).

**Simulate Update (DEV menu):** Developer → **Simulate Update…** seeds a fake pending release (`99.0.0`) in memory — update toast, What's New (with a simulation banner), download progress, then a window **reload** (not process `relaunch`, so `tauri dev` keeps running). It never contacts the live updater endpoint or unpacks a real build. Retrigger anytime after reload.

## What you don’t do by hand

- Don’t bump versions in a feature PR — release-please owns that.
- Don’t create the `v*` tag yourself — merging the release PR does it.
- Don’t upload installers manually — the matrix attaches them to the draft.

## Secrets (operators)

| Secret | Where | Purpose |
| --- | --- | --- |
| `RELEASE_PLEASE_TOKEN` | **Repo** secret (PAT with `contents: write` on desktop; `contents: read` on other private repos CI clones) | Lets release-please’s tag push trigger the build workflow (`GITHUB_TOKEN` events cannot); also clones private GitHub npm git deps |
| `TAURI_SIGNING_PRIVATE_KEY` | `production-release` Environment | Updater artifact signing (no password when generated with `--ci`) |
| Apple / Windows signing vars | `production-release` Environment | Code signing + notarization — optional until those setups land; unset = unsigned builds (never export empty `APPLE_CERTIFICATE`) |

Full runbook (generate/rotate/sign/verify, enrollment checklists): [`signing-and-keys.md`](./signing-and-keys.md). Key layout: [`src-tauri/keys/updater/README.md`](../src-tauri/keys/updater/README.md).

## Workflows & config

| File | Role |
| --- | --- |
| [`.github/workflows/release-please.yml`](../.github/workflows/release-please.yml) | Standing release PR; tag + draft on merge; sanitizes the draft body |
| [`.github/workflows/release.yml`](../.github/workflows/release.yml) | Platform matrix → attach installers → `platforms-green` gate |
| [`.github/workflows/publish-release.yml`](../.github/workflows/publish-release.yml) | Manual publish gate (undraft) |
| [`scripts/release/required-release-assets.mjs`](../scripts/release/required-release-assets.mjs) | Required draft assets (single source of truth) |
| [`scripts/release/check-bundle.mjs`](../scripts/release/check-bundle.mjs) | Packaged-tree checks (`npm run release -- check-bundle`) |
| [`scripts/release/sanitize-release-notes.mjs`](../scripts/release/sanitize-release-notes.mjs) | Draft-body sanitizer (Features / Bug Fixes only) |
| [`release-please-config.json`](../release-please-config.json) | release-please package config |
| [`.release-please-manifest.json`](../.release-please-manifest.json) | Last released version |
