# spk-format

Rust crate for the Spiral item format: the manifests of the four item types, their validators, and zip-slip-safe `.spk` archive extract and write.

An **item** is one theme, skin, visualizer or sound pack. Its manifest sits at the item root and carries the item's identity and distribution fields, so there is no wrapper manifest:

| Type | Manifest | Schema |
| --- | --- | --- |
| `theme` | `theme.json` | [`schemas/theme-v1.schema.json`](schemas/theme-v1.schema.json) |
| `skin` | `skin.json` | [`schemas/skin-v1.schema.json`](schemas/skin-v1.schema.json) |
| `visualizer` | `viz.json` | [`schemas/viz-v1.schema.json`](schemas/viz-v1.schema.json) |
| `sound` | `sound.json` | [`schemas/sound-v1.schema.json`](schemas/sound-v1.schema.json) |

Every manifest declares:

- `id`: kebab-case slug, unique per publisher and type.
- `publisherId`: kebab-case slug naming who publishes the item. The effective id is `publisherId.type.id` (for example `spiral.theme.noir`).
- `version`: semver. A published version is immutable.
- `name`, and optionally `description`, `author` (a freeform credit), `preview` (a raster image path inside the item) and `minAppVersion`.

A `.spk` is a zip archive of one item, with the manifest at the archive root or inside a single top-level folder. An item may also carry a `README.md` and a `CHANGELOG.md` (each up to 256 KiB), which the registry and the app show.

## API

- `validate_item_dir(dir)` reads and strictly validates an item directory (identity fields, declared preview, and the type-specific content validator) and returns an `ItemManifest`.
- `read_item_manifest`, `parse_item_manifest_json`, `detect_item_type`, `list_item_dirs` and the id helpers (`effective_item_id`, `item_dir_name`) cover the lighter reads.
- `extract_archive` extracts a `.spk` into a temp directory under `ExtractLimits` (entry count, total size, compression ratio) and rejects paths that escape the archive. `find_item_root` locates the item inside it, and `write_archive` zips an item directory.

```bash
cargo test -p spk-format
```

## License

Dual-licensed under MIT OR Apache-2.0.
