# Contributing

## UI strings (i18n)

User-facing copy belongs in `src/locales/en/` and is referenced via `t` / `useTranslation` — not hardcoded in components or `src/lib/`.

- **After** the i18n cutoff lands (`src/lib/i18n.ts` + catalogs): follow [`.cursor/rules/i18n-ui-strings.mdc`](../.cursor/rules/i18n-ui-strings.mdc) for all new and touched UI strings.
- **Plan / cutoff / backlog:** [`docs/localization-investigation.md`](./localization-investigation.md).

Exceptions: pack/skin author content, non-UI activity-log internals, and Rust log strings (unless shown as UI).

## Commit messages

Spiral uses [Conventional Commits](https://www.conventionalcommits.org/). A Husky `commit-msg` hook runs [commitlint](https://commitlint.js.org/) and **rejects** messages that do not match.

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
