# Updater signing keys (app-bundled)

**Public key only** in this directory. The private key must never be committed — it lives as a GitHub Actions Environment secret on `production-release` (`TAURI_SIGNING_PRIVATE_KEY`) plus a durable copy in the password-manager vault.

This keypair is dedicated to `tauri-plugin-updater`. It is **not** shared with the license Ed25519 keys under `../license/`.

| File | Contents |
| ---- | -------- |
| `spiral-updater.pub` | Minisign public key (base64); same value as `plugins.updater.pubkey` in `tauri.conf.json` |

Generate / rotate:

```bash
npm run release -- keys
```

Then replace `spiral-updater.pub` and `plugins.updater.pubkey` with the new `.pub` contents, update the Environment secret, and store the new private key in the vault before discarding the old one.

Sign / verify a local artifact:

```bash
npm run release -- sign path/to/artifact
npm run release -- verify path/to/artifact
```

Full runbook: `docs/signing-and-keys.md`.
