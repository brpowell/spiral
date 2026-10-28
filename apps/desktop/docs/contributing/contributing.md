# Contributing

## First-time setup

```bash
npm install
npm run tauri dev
```

## Lint and format

Frontend TypeScript/React is checked with [ESLint](https://eslint.org/) and formatted with [Prettier](https://prettier.io/). Rust (`src-tauri`) is formatted with [rustfmt](https://github.com/rust-lang/rustfmt) (`edition = "2021"` in `src-tauri/rustfmt.toml`).

```bash
npm run lint              # ESLint + i18n keys + rustfmt check (CI + local)
npm run lint:i18n         # Catalog key check only (`t("ns:key")` vs `src/locales/en`)
npm run lint:rust         # rustfmt --check only
npm run lint:fix          # ESLint with autofix
npm run format            # Prettier write + rustfmt write
npm run format:check      # Prettier check (not required in CI yet)
npm run format:rust       # rustfmt write
npm run notice:check      # Fail if the third-party license bundle is stale vs lockfiles
npm run notice:generate   # Rewrite src-tauri/NOTICE and src/assets/licenses/third-party.json (About > Licenses) from production npm + Cargo
```

A Husky `pre-commit` hook runs [lint-staged](https://github.com/lint-staged/lint-staged) so only staged files are linted/formatted (Prettier/ESLint for frontend, rustfmt for `src-tauri/**/*.rs`), then the full test suite (skipped when the commit only touches docs or workflows: `*.md`, `*.mdc`, `docs/**`, or `.github/workflows/**`). CI’s Desktop CI workflow uses the same paths filter. When lockfiles, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/NOTICE`, `scripts/generate-notice.mjs`, `scripts/lib/license-bundle.mjs`, or `scripts/license-overrides.json` are staged, the hook also runs `npm run notice:check` (CI’s Desktop CI job always does). If that fails: `npm run notice:generate`, `git add src-tauri/NOTICE src/assets/licenses/third-party.json`, and skim the diff for copyleft. The generator fails if a shipped package has no license text it can reproduce; add a justified entry to `scripts/license-overrides.json` (or a canonical text in `scripts/license-templates/`) rather than skipping it. Frontend formatting adoption stays incremental without a repo-wide Prettier reformat; rustfmt is already clean across the crate and is part of `npm run lint`.

Editor extensions are recommended in `.vscode/extensions.json` (ESLint + Prettier + rust-analyzer). rustfmt ships with the stable Rust toolchain (`rustup component add rustfmt` if a commit fails because it is missing).

## Native LAME (`libmp3lame`)

Convert-to-MP3 statically links LAME 3.100 via the vendored `mp3lame-sys` crate; there is nothing to fetch. LAME is LGPL — keep the About credit, license text and `NOTICE` entry intact.

## Developer CLIs

`wms-import` and `read-tags` are Cargo bins behind `--features dev-bins` so Tauri does not copy them into installers. The npm scripts pass that flag. Do not enable `dev-bins` for `tauri build`.

## Removed: free trial and Spiral Card

The 24-track free-trial library cap, the Spiral Card (`.spcard`) registration flow, the `spiral://` card handoff, license key verification, and the `--dev-license` / `release:dev` installer flag were removed from the app. The full pre-removal implementation is preserved on the `archive/free-trial-and-spiral-card` branch (last commit before removal) for potential reuse. Older docs that mention licenses or Spiral Cards are historical.

## UI strings (i18n)

User-facing copy belongs in `src/locales/en/` and is referenced via `t` / `useTranslation` — not hardcoded in components or `src/lib/`.

- Follow [`.cursor/rules/i18n-ui-strings.mdc`](../../.cursor/rules/i18n-ui-strings.mdc) for all **new and touched** UI strings.
- React: `useTranslation()` / `<Trans>`. Non-React (`src/lib/`, menus, toasts): `t` / `i18n` from `src/lib/i18n`.
- `t()` is typed from the English JSON catalogs (`TranslationKey` in `src/lib/i18nKeys.ts`). Use `tUnchecked` only for interpolated key paths.
- `npm run lint:i18n` (also part of `npm run lint`) fails when a static `t("ns:key")` is missing from `src/locales/en`.
- Date/sort helpers use the app locale (`getIntlLocale` / `compareLocalized`). A German stub catalog (`src/locales/de`) plus Developer → Language proves switching; it is not a product locale.
- Untouched screens may still have inline English until a boy-scout extract on touch.
- **Plan / cutoff / backlog:** `docs/impl/i18n-impl.md`.

Exceptions: pack/skin author content, non-UI activity-log internals, and Rust log strings (unless shown as UI).

## Commit messages

Spiral uses [Conventional Commits](https://www.conventionalcommits.org/). A Husky `commit-msg` hook runs [commitlint](https://commitlint.js.org/) and **rejects** messages that do not match. PR titles are validated the same way in CI (squash-merge uses the PR title as the commit on `main`). Those titles also feed the automated changelog — see [release.md](./release.md).

### Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | When to use |
| --- | --- |
| `feat` | A new user-facing feature |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `style` | Formatting / non-functional style |
| `refactor` | Code change that is not a fix or feature |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `build` | Build system or external dependencies |
| `ci` | CI configuration |
| `chore` | Maintenance that does not fit elsewhere |
| `revert` | Reverts a previous commit |

Breaking changes: add `!` after the type/scope (`feat!: ...`) or a `BREAKING CHANGE:` footer.

### Examples

```
feat(player): add gapless playback toggle
fix(library): restore album art after re-import
docs: document conventional commit requirements
chore: bump vitest
feat(ripper)!: require explicit output format
```

### Local check

```bash
echo "bad message" | npx commitlint
echo "feat: add thing" | npx commitlint
```

## Resource use and local profiling

Spiral does not send performance telemetry.

- **How to sample on-device** (symbolicated release build, samply / Instruments / Activity Monitor, `npm run profile:build`): [profiling.md](./profiling.md).
- **What to attack** (ranked findings, regression risk, skin checklist): resource-optimization.md. Attack order is **risk first** (skin hide/show, Web Audio ownership, click-through), not impact × effort alone.
