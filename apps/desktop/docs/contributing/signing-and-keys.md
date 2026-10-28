# Signing & keys

Maintainer runbook for the keys and secrets behind Spiral's release builds. Cutting a release is covered in [`release.md`](./release.md).

Every secret below lives in the `production-release` GitHub Environment (Settings → Environments), except where noted. Secrets are write-only in GitHub, so keep durable copies of the private ones in a password manager.

## What signs what

| Signing | Secrets | Used by |
| --- | --- | --- |
| **Updater** (every platform) | `TAURI_SIGNING_PRIVATE_KEY` | `tauri build` signs the update artifacts. The public key is committed in `tauri.conf.json` and `src-tauri/keys/updater/`. |
| **macOS** Developer ID + notarization | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | The macOS job in the Release workflow. |
| **Windows** Authenticode | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` | `scripts/release/sign-windows.mjs`, via Azure Artifact Signing. No certificate or client secret is stored. |
| Release automation | `RELEASE_PLEASE_TOKEN` (repo secret, a PAT with `contents: write`) | Lets release-please's tag push trigger the build. It doesn't sign anything. |

Signing is optional per platform. With no secrets set you get unsigned builds. A *partly* set configuration fails the build early, so a half-configured platform can't ship by accident.

## Publishing

The Release workflow builds every platform and attaches the installers to a draft GitHub Release. After **All platforms green** passes, publish the draft by hand from the Releases page. Publishing is the go-live; nothing auto-publishes. To check a draft first: `npm run release -- check desktop-vX.Y.Z`.

## Updater key

Generate (first time or rotation):

```bash
npm run release -- keys            # writes ~/.tauri/spiral-updater.key and .pub
```

Install or rotate:

1. Copy the `.pub` contents into `src-tauri/keys/updater/spiral-updater.pub` and `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.
2. Set `TAURI_SIGNING_PRIVATE_KEY` to the whole private key file. The key has no password, so leave `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` unset.
3. Ship a release signed with the new key before discarding the old one. Existing installs only trust the pubkey they already have, and pick up the new one by installing a build that contains it.

Sign and verify a file locally with the same key:

```bash
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/spiral-updater.key"
npm run release -- sign path/to/Spiral.app.tar.gz
npm run release -- verify path/to/Spiral.app.tar.gz
```

## macOS

Requires an Apple Developer Program membership. Only the Account Holder can create Developer ID certificates.

1. Create a **Developer ID Application** certificate (G2 Sub-CA) from a CSR made in Keychain Access, and install it in the **login** keychain on the same Mac. `security find-identity -v -p codesigning` shows the identity string (`APPLE_SIGNING_IDENTITY`) and Team ID (`APPLE_TEAM_ID`).
2. Export the certificate with its private key as a `.p12`. Set it as `APPLE_CERTIFICATE` (base64) and its password as `APPLE_CERTIFICATE_PASSWORD`:

   ```bash
   base64 -i DeveloperID.p12 | gh secret set APPLE_CERTIFICATE --env production-release
   ```

3. For notarization, create an app-specific password at account.apple.com (`APPLE_PASSWORD`) and set the Apple ID email as `APPLE_ID`. The workflow also accepts `APPLE_API_KEY` / `APPLE_API_ISSUER`, but CI doesn't write the `.p8` file the bundler needs, so use the password flow.
4. Keep the `.p12` and its password in a password manager, and note the certificate's expiry.

After the build, the workflow checks `codesign`, Gatekeeper (`spctl`) and the stapled ticket, so a build that isn't properly signed and notarized fails. Never set `APPLE_*` on a job's `env:` block: an empty `APPLE_CERTIFICATE` makes the bundler try to import it and fail. The workflow only exports non-empty values.

Local test: set the same variables and run `npm run release -- installer dmg`.

## Windows

Windows builds are signed with [Azure Artifact Signing](https://learn.microsoft.com/azure/trusted-signing/). The workflow gets a GitHub OIDC token and `sign-windows.mjs` exchanges it for Azure access right before each signing call, so there is no certificate or client secret to store or rotate. The five `AZURE_*` values only identify the app registration and the signing account.

Outside CI the script uses your own `az login`.

## Environment protection

Required reviewers or a wait timer on `production-release` would pause the build until someone approves it. If you enable them, a `publish` job with `needs: platforms-green` could replace the manual publish step. Don't add an unguarded `publish` job to the tag-triggered workflow: it would publish every draft automatically.

## Never commit

- The updater private key
- Apple `.p12` files, passwords and API keys
- `RELEASE_PLEASE_TOKEN`
