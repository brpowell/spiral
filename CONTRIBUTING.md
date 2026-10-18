# Contributing to Spiral

Thanks for helping out. This file covers the repository as a whole. The desktop app has more detailed guidance in [`apps/desktop/docs/contributing/contributing.md`](apps/desktop/docs/contributing/contributing.md).

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, use [SECURITY.md](SECURITY.md) instead of a public issue.

## Before you start

- Look for an existing [issue](https://github.com/brpowell/spiral/issues) before filing a new one.
- For anything beyond a small fix, open an issue first so we can agree on the approach before you spend time on it.
- Keep changes focused. One topic per pull request is easier to review and easier to revert.

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/desktop` | The Spiral app (Tauri 2, React + TypeScript, Rust backend) |
| `apps/registry` | `spk-registry`, the pack distribution service (Rust, Axum, SQLite) |
| `libs/spk-format` | The `.spk` pack format shared by the app and the registry |

The app and the registry both depend on `spk-format`. A change to the format affects both, so CI runs both sets of checks for it.

## Setup

You need a stable [Rust](https://rustup.rs) toolchain with `rustfmt` and `clippy`, and Node.js 22. The desktop app also needs the platform libraries Tauri requires; see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Working on each part

### Desktop app (`apps/desktop`)

```bash
cd apps/desktop
npm install
npm run tauri dev     # run the app
npm run lint          # ESLint, i18n keys, rustfmt check
npm test              # frontend and backend tests
```

User-facing strings belong in `src/locales/en/`, not hardcoded. The full list of scripts, the pre-commit hook, and the i18n rules are in the [desktop contributing guide](apps/desktop/docs/contributing/contributing.md).

### Registry (`apps/registry`)

```bash
cd apps/registry
cargo run                                     # serve on 127.0.0.1:8787, data in ./data
cargo test -p spk-registry -p spk-format
```

The admin panel is a Preact app in `apps/registry/admin`. Its built output in `admin/dist` is embedded into the binary at compile time and is not committed, so build it (`cd apps/registry/admin && npm ci && npm run build`) before compiling the registry. The Docker image and CI build it themselves.

### Pack format (`libs/spk-format`)

```bash
cargo test -p spk-format
```

## Checks your change must pass

The registry and format checks are the same ones CI runs:

```bash
cargo fmt -p spk-registry -p spk-format -- --check
cargo clippy -p spk-registry -p spk-format --all-targets -- -D warnings
cargo test -p spk-registry -p spk-format
```

For the desktop app, run `npm run lint` and `npm test` in `apps/desktop`. CI only runs a component's checks when files that affect it change.

Please add or update tests with your change. If you fix a bug, a test that fails without the fix is the best evidence it is fixed.

## Commits and pull request titles

Spiral uses [Conventional Commits](https://www.conventionalcommits.org/). Pull request titles are validated in CI, and because pull requests are squash-merged, the title becomes the commit on `main`.

```
<type>[optional scope]: <description>
```

Common types are `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci` and `chore`. Use `!` after the type or scope for a breaking change. Examples:

```
feat(registry): add a pack download counter
fix(spk-format): reject archives with too many entries
docs: explain how to self-host the registry
```

Desktop release notes are generated from these titles, so write them for a reader of the changelog. See the [desktop commit guide](apps/desktop/docs/contributing/contributing.md#commit-messages) for the full list of types, and [release.md](apps/desktop/docs/contributing/release.md) for how releases are cut.

## Pull requests

- Describe what changed and why, and how you tested it. The pull request template has the prompts.
- Keep the diff to what the change needs. Unrelated cleanups are best sent separately.
- Be ready to revise. Review comments are about the change, not about you.

## Using AI tools

Use whatever tools you like, but you own what you submit: read it, understand it, and be ready to explain and defend it in review. Please don't add AI co-author trailers or "generated with" footers to commits or pull request descriptions.

## Licensing of contributions

Unless you say otherwise, contributions are licensed under the license of the part of the repository they change: Apache-2.0 for `apps/desktop` and `apps/registry`, and MIT OR Apache-2.0 for `libs/spk-format`. There is no separate contributor agreement to sign.

## Questions

If something in this guide is unclear or out of date, that is a bug in the guide. Open an issue or send a pull request.
