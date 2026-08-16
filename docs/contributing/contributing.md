# Contributing

## Lint and format

Frontend TypeScript/React is checked with [ESLint](https://eslint.org/) and formatted with [Prettier](https://prettier.io/).

```bash
npm run lint          # ESLint (CI + local)
npm run lint:fix     # ESLint with autofix
npm run format        # Prettier write
npm run format:check  # Prettier check (not required in CI yet)
```

A Husky `pre-commit` hook runs [lint-staged](https://github.com/lint-staged/lint-staged) so only staged files are linted/formatted, then the full test suite (skipped when the commit only touches docs or workflows: `*.md`, `*.mdc`, `docs/**`, or `.github/workflows/**`). CI’s Tests workflow uses the same paths filter. That keeps formatting adoption incremental without a repo-wide reformat.

Editor extensions are recommended in `.vscode/extensions.json` (ESLint + Prettier).

## UI strings (i18n)

User-facing copy belongs in `src/locales/en/` and is referenced via `t` / `useTranslation` — not hardcoded in components or `src/lib/`.

- Follow [`.cursor/rules/i18n-ui-strings.mdc`](../.cursor/rules/i18n-ui-strings.mdc) for all **new and touched** UI strings.
- React: `useTranslation()` / `<Trans>`. Non-React (`src/lib/`, menus, toasts): `t` / `i18n` from `src/lib/i18n`.
- Untouched screens may still have inline English until a Phase 3+ sweep or boy-scout extract on touch.
- **Plan / cutoff / backlog:** [`docs/impl/i18n-impl.md`](../impl/i18n-impl.md).

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
