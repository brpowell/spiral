# AGENTS.md

## Commits and pull requests

Repo-wide rules, including no AI attribution in commits, are in the root [AGENTS.md](../../AGENTS.md). Commit message rules for this app are in [docs/contributing/contributing.md](docs/contributing/contributing.md#commit-messages).

## Database schema changes

The `Library.db` schema is versioned: changes are append-only migrations in `src-tauri/src/db_migrations.rs`, and there is no schema script to edit. Never change an existing table definition or an existing migration; add a new migration and run `cargo test --lib db_migrations` (from `src-tauri`). Full process in [docs/contributing/database-migrations.md](docs/contributing/database-migrations.md).

## Imports

Import across folders with the `@/` alias (`@/lib/…`, `@/components/…`), which maps to `src/`. Use `./` only for files in the same folder or below it, and never `../`. Exception: modules that `vite.config.ts` imports (and their dependencies) must stay relative, because Vite loads the config before the alias applies.

## Component placement

`src/components/common/` holds domain-agnostic design-system primitives only (`Button`, `TextInput`, `Modal`, `Chip`, `ChipInput`, `FormField`). A component belongs there only if its props are generic and it imports no domain `lib/` modules (`artistNames`, `trackMetadataForm`, `albums`, …), Zustand stores, or library/playback navigation.

Spiral-specific UI goes in `src/components/<FeatureName>/` (e.g. `TrackEditor/`, `ArtistChipField/`) or `src/views/` for route-level screens. Feature components compose `common/` primitives as thin wrappers (e.g. `ArtistChipField` = `ChipInput` + `artistNames`) and don't duplicate their styling.

- Heuristic: if removing Spiral's music/library domain would make the component meaningless, it does not belong in `common/`.
- "Shared between two editors" is not a reason for `common/`; use a sibling feature folder.

## No per-skin engine hacks

The skin runtime (`src/lib/skin*.ts`, `src/components/playback/skin/`), the WMS importer, and the `spk-format` schemas are a general engine. A bug in one pack is a missing pattern in the engine or missing data on the presentation, not an `if` for that pack.

- Don't fingerprint a skin, pack, or view (`id === "lost-planet"`, inset tuples only one pack uses, asset filenames as identity), hardcode radii/z-index/layout only one skin's art needs, or add special-case helpers named after a skin.
- Do encode the WMS/Spiral pattern (overlay glaze vs corner cap, client-hole clip, stretch tiles) and put skin-specific numbers on the manifest/assets (`contentCornerRadius`, masks, tiles).
- Pack names are fine in tests and comments as examples of a general rule, never as runtime identity.

```ts
// ❌ engine knows a product
function isLostPlanetClientHole(inset: TiledFrameContentInset): boolean {
  return inset.left === 16 && inset.top === 42 && …;
}

// ✅ pack authors the pattern; engine reads it
tiledFrameContentRadius(presentation) // presentation.contentCornerRadius ?? 0
```

If a second skin would need the same `if`, the condition was never a skin check: lift it into the format.

## Toasts

Any toast that reports an operation's result follows the conventions in [docs/contributing/toast-conventions.md](docs/contributing/toast-conventions.md): peer-counter titles, color from `failed` counts only, button/subtitle rules, Activity Log links, and registering every production toast in Toast Lab. Read it before adding or changing a toast.

## Rust: platform- and test-only symbols

Gate symbols used only on one OS or in tests with a matching `#[cfg(...)]` on the `pub use` / `pub fn` / module instead of `#[allow(dead_code)]` or `#[allow(unused_imports)]`. Details and examples: [docs/contributing/rust-platform-cfg.md](docs/contributing/rust-platform-cfg.md).

## Verifying UI changes

On macOS, `npm run dev:agent` launches the app with a dev-only bridge so an agent can screenshot, eval JS, click, type and read logs via `node scripts/agent.mjs`. See [docs/contributing/agent-automation.md](docs/contributing/agent-automation.md).
