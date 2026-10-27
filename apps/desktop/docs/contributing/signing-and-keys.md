# Signing & key management

Operator runbook for Spiral’s Direct-channel signing keys and secrets. Decisions and rationale live in `release-process-plan.md`; day-to-day cutting a release is in [`release.md`](./release.md).

Scripts under `scripts/release/` wrap the same tools CI uses (`tauri signer`, `gh release`, env vars consumed by `tauri-action`). Prefer the npm scripts over hand-rolled CLI flags.

---

## Key inventory

| Key / secret | Consumer | Where it lives | Blast radius |
| --- | --- | --- | --- |
| **Updater signing private key** | CI build (`tauri-action` / `tauri build`) | GitHub Environment secret `production-release` → `TAURI_SIGNING_PRIVATE_KEY` (+ empty password); durable copy in password-manager vault | Attacker can push a malicious auto-update to every install that trusts the bundled pubkey — highest severity |
| **Updater public key** | App (`plugins.updater.pubkey`) | Git: `src-tauri/keys/updater/spiral-updater.pub` and `src-tauri/tauri.conf.json` | Public |
| **Apple Developer ID + notarization** | CI macOS build | Environment secrets on `production-release` (see below) | Fake signed macOS builds while the cert is valid |
| **Windows Authenticode cert** | CI Windows build | Environment secrets on `production-release` (see below) — **not filled yet** (#183) | Fake signed Windows installers while the cert is valid |
| **`RELEASE_PLEASE_TOKEN`** | `release-please` workflow | **Repo** secret (PAT, `contents: write`) | Can create tags/releases; does not sign updates |

---

## GitHub Environment: `production-release`

- **Exists** on `brpowell/spiral-desktop`.
- Holds high-blast-radius CI secrets (updater private key today; Apple/Windows when #182 / #183 land).
- Referenced by:
  - [`.github/workflows/release.yml`](../../../../.github/workflows/desktop-release.yml) — matrix build (needs secrets)

### Required reviewers (plan limitation)

Environment **required reviewers** / wait timers need a GitHub plan that supports deployment protection rules on **private** repos. On the current personal private repo plan, enabling them returns HTTP 422 from the API.

**Gate today:** a human publishes the draft from the GitHub Releases page after **All platforms green** is green. This is a convention, not an enforced gate.

**When reviewers become available:** add them under Settings → Environments → `production-release` → Required reviewers, then optionally add a `publish` job with `needs: platforms-green` to `release.yml` so approval pauses the same run.

Until then, do **not** add an unguarded `publish` job to the tag-triggered workflow — it would auto-publish drafts.

---

## Scripts & npm entries

Single entry: `npm run release -- <command> …` (`scripts/release/cli.mjs`).

| Command | Script | Purpose |
| --- | --- | --- |
| `npm run release -- keys` | `generate-updater-keys.mjs` | `tauri signer generate --ci` |
| `npm run release -- sign <file>` | `sign-updater.mjs` | `tauri signer sign` (same env vars as CI) |
| `npm run release -- verify <file>` | `verify-updater-sig.mjs` | Verify `<file>.sig` against bundled pubkey |
| `npm run release -- installer [kind]` | `build-installer.mjs` | Local installer (`dmg` / `nsis` / `linux` AppImage / `deb` / `rpm`); signs when env vars are set |
| `npm run release -- check desktop-vX.Y.Z` | `check-release-assets.mjs` | Same draft-asset gate as CI `platforms-green` |

---

## Updater keypair

### Generate (first time or rotation)

```bash
npm run release -- keys
# default path: ~/.tauri/spiral-updater.key (+ .pub)
# npm run release -- keys -- --out /path/to/key --force
```

Uses `--ci` (no password) so CI can set `TAURI_SIGNING_PRIVATE_KEY` without `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

### Install / rotate into the repo and CI

1. Copy the new `.pub` contents → `src-tauri/keys/updater/spiral-updater.pub`
2. Set `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` to the **same** string
3. GitHub → Settings → Environments → `production-release` → secret `TAURI_SIGNING_PRIVATE_KEY` = private key file contents (entire blob)
4. Leave `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` unset/empty
5. Store the private key in the password-manager vault (GitHub secrets are write-only)
6. Land a release signed with the **new** key before discarding the old private key — existing installs only trust the pubkey they already shipped; they pick up the new pubkey only by installing a build that contains it

### Sign & verify locally

```bash
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/spiral-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

npm run release -- sign path/to/Spiral_0.2.0_aarch64.app.tar.gz
npm run release -- verify path/to/Spiral_0.2.0_aarch64.app.tar.gz
# or: npm run release -- verify file file.sig --pubkey src-tauri/keys/updater/spiral-updater.pub
```

CI does not call these scripts directly — `tauri-action` reads the same env vars during `tauri build` and attaches `.sig` assets. Locally, `npm run release -- installer` behaves the same when the env vars are set.

---

## macOS code signing & notarization (#182)

The Release workflow’s macOS step reads these Environment secrets and appends only non-empty values to `GITHUB_ENV`. With none set it builds an **unsigned** DMG; with all of the certificate secrets and one notarization method set it signs, notarizes and staples, then runs a verify step (`codesign`, `spctl`, `stapler validate`). A partial set fails the job early. Do not map missing secrets to empty `APPLE_*` job env vars — tauri-bundler treats a present empty `APPLE_CERTIFICATE` as a cert to import and fails CI. (`secrets` cannot be referenced in Actions `if:` expressions.)

| Secret | Purpose |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64 `.p12` Developer ID Application cert |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple ID email (app-specific password flow) |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Team ID |

Use the Apple ID + app-specific password flow. The `APPLE_API_KEY` / `APPLE_API_ISSUER` flow is also accepted by the workflow, but the bundler needs the `.p8` as a file (`APPLE_API_KEY_PATH`), which CI does not write.

### Getting the certificate

1. **Create a CSR** (on the Mac that will hold the private key): Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority. Enter your email, a common name, choose “Saved to disk”. Keychain now holds the private key.
2. **Create the certificate**: developer.apple.com → Certificates, IDs & Profiles → Certificates → `+` → **Developer ID Application** (not “Developer ID Installer”, not “Apple Development”). Profile type G2 Sub-CA. Upload the CSR, download the `.cer`. Only the Account Holder can create Developer ID certificates.
3. **Install it**: double-click the `.cer`. Under My Certificates it should show a private key beneath it. Check the identity string:

   ```bash
   security find-identity -v -p codesigning
   ```

   Copy the full `Developer ID Application: Name (TEAMID)` string, which is `APPLE_SIGNING_IDENTITY`. The 10-character value in parentheses is `APPLE_TEAM_ID`.
4. **Export the `.p12`**: Keychain Access → My Certificates → right-click the certificate (with its key) → Export → `.p12`, with a strong password (`APPLE_CERTIFICATE_PASSWORD`). Then:

   ```bash
   base64 -i DeveloperID.p12 | pbcopy
   ```

   Paste as `APPLE_CERTIFICATE`.
5. **App-specific password**: account.apple.com → Sign-In and Security → App-Specific Passwords → generate one named e.g. `spiral-notarize`. That is `APPLE_PASSWORD`; `APPLE_ID` is the Apple ID email of the account holder (or a team member with the Developer role).
6. Add all six as secrets on the `production-release` Environment. Store the `.p12`, its password and the app-specific password in the password-manager vault, with the certificate expiry (5 years) and who can renew.
7. Delete the local `.p12` and CSR once vaulted. Keep the private key in your login keychain until the vault copy is confirmed.

### Verify

Run the Release workflow manually (`workflow_dispatch`, platforms `macos`) against a draft tag. The “Verify macOS signature and notarization” step must pass. Then download the DMG from the draft in a browser (so it gets the quarantine flag) and open it on another Mac: no Gatekeeper warning should appear.

Local smoke: set the same env vars, then `npm run release -- installer dmg`. Tauri’s bundler invokes `codesign` / `notarytool`.

Notarization normally takes 2–15 minutes but can occasionally take longer; the job timeout is 90 minutes.

---

## Windows Authenticode (#183)

Blocked on legal entity / certificate subject. Secret names already wired; empty → unsigned NSIS.

| Secret | Purpose |
| --- | --- |
| `WINDOWS_CERTIFICATE` | Base64 `.pfx` |
| `WINDOWS_CERTIFICATE_PASSWORD` | `.pfx` password |

Also required when flipping signing on: `certificateThumbprint` (and related) under `bundle.windows` in `tauri.conf.json` — see Tauri Windows signing docs. The workflow imports the PFX into the job’s cert store when `WINDOWS_CERTIFICATE` is non-empty.

**Enrollment checklist (prep):**

1. Obtain Authenticode cert under the final legal name (OV/EV per chosen CA).
2. Export `.pfx`; base64 into `WINDOWS_CERTIFICATE`; vault the PFX + password + thumbprint.
3. Set Environment secrets; add thumbprint to `tauri.conf.json`.
4. Confirm CI produces a signed `*-setup.exe` (`signtool verify /pa`).

Local smoke: same env vars + `npm run release -- installer nsis` on Windows.

---

## Publish gate

After **All platforms green** on the [Release](../../../../.github/workflows/desktop-release.yml) workflow, publish the draft from the GitHub Releases page. To check a draft locally first: `npm run release -- check desktop-v0.2.0` (see `scripts/release/check-release-assets.mjs`).

There is no separate “write update manifest” file step in this repo: with the planned marketing-site proxy, **publishing the GitHub Release** is the atomic go-live. Updater `.sig` files are attached at build time by `tauri-action`.

---

## What never goes in git

- Updater **private** key
- Apple `.p12` / notarization passwords / API keys
- Windows `.pfx` / password
- `RELEASE_PLEASE_TOKEN`
