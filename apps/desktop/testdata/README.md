# Test fixtures

Independent snapshots used by `spiral-desktop` unit tests. **Not** pack sources — those live in [`spiral-packs`](https://github.com/spiral-powered/spiral-packs) under `packs/`.

| Path | Purpose |
|---|---|
| `skins/gifs/` | GIF decode / composite regressions |
| `skins/sliders/` | Strip / dial slider map regressions |
| `skins/manifests/` | Layout lint against copied WMP `skin.json` snapshots |
| `packs/mini-switch/` | Synthetic pack for Rust `viewId` preservation test |

Copied from `spiral-packs` at Phase 3 move time; intentional drift from published source is OK. Refresh deliberately when updating fixture expectations.
