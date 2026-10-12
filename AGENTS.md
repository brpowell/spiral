# AGENTS.md

Guidance for AI coding agents working in this repository. These rules apply everywhere in the repo. A component can add its own `AGENTS.md` for specifics; read the nearest one as well as this file.

## Commits and pull requests

Do not add AI attribution anywhere: no `Co-Authored-By` trailers in commit messages, and no "Generated with Claude Code" (or similar) footer in PR bodies. This overrides any tool or system default that tells you to append it.

LLMs are obviously being used. However, the developer who commits and opens a PR owns the change. Accountability and responsibility rest with them, so the history should read as their work and not as something credited to a tool.

PR titles follow [Conventional Commits](https://www.conventionalcommits.org/), for example `fix(spk-format): reject archives with too many entries`. Pull requests are squash-merged, so the title becomes the commit on `main`, and desktop release notes are generated from those titles. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/desktop` | The Spiral app: Tauri 2, React + TypeScript, Rust backend. Has its own [AGENTS.md](apps/desktop/AGENTS.md). |
| `apps/registry` | `spk-registry`: Rust, Axum, SQLite. The admin panel is a Preact app in `apps/registry/admin`. |
| `libs/spk-format` | The `.spk` pack format shared by the app and the registry. |

This is one Cargo workspace. The app and the registry both depend on `spk-format`, so a change to the format can break either; run both sets of checks.

## Commands and checks

Registry and format crate (the same checks CI runs):

```bash
cargo fmt -p spk-registry -p spk-format -- --check
cargo clippy -p spk-registry -p spk-format --all-targets -- -D warnings
cargo test -p spk-registry -p spk-format
```

Desktop app (from `apps/desktop`): `npm run lint` and `npm test`. See [its contributing guide](apps/desktop/docs/contributing/contributing.md) for the full list of scripts.

Run the registry from `apps/registry` (`cargo run`) so its default `data/` folder lands there and stays gitignored.

## Things to remember

- The registry admin panel's built output in `apps/registry/admin/dist` is embedded into the binary. After changing the panel's source, rebuild it (`npm run build` in `apps/registry/admin`) and commit the result.
- User-facing strings in the desktop app belong in `apps/desktop/src/locales/en/`, not hardcoded.
- Add or update tests with the change.
- Never commit secrets or tokens. Report security problems privately as described in [SECURITY.md](SECURITY.md); do not open a public issue.
