# License verify keys (app-bundled)

**Public keys only.** Signing private keys never live in this repo.

Desktop compiles **exactly one** of these 32-byte Ed25519 public keys into a given binary:

| File | When it is bundled |
| ---- | ------------------ |
| `dev-ed25519.pub` | `tauri dev` / debug, `cargo test`, or `npm run release:dev` (`--features license-dev-key`) |
| `prod-ed25519.pub` | Default `tauri build` (release) |

The development private seed is in spiral-powered `lib/license/ed25519-private.b64`. Production private seed is Vercel `LICENSE_SIGNING_PRIVATE_KEY` only.

Contract: spiral-powered `docs/license/spcard-v1.md`.
