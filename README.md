# spk-registry

Distribution service for Spiral packs (`.spk`): catalog listing, version resolution, and download serving.

Companion crate [`spk-format`](https://github.com/spiral-powered/spk-format) owns pack validation; this service indexes and serves published artifacts.

## Phase 1 status

Read path only. Admin upload lands in Phase 2. For local development, seed the database by hand (see below).

## Quick start

```bash
# Apply schema + insert a demo pack (re-runnable)
cargo run --bin spk-registry-seed

# Serve
cargo run

# Browse
curl -s http://127.0.0.1:8787/v1/meta | jq
curl -s http://127.0.0.1:8787/v1/packs | jq
curl -s http://127.0.0.1:8787/v1/packs/spiral/demo-skin | jq
curl -OJ http://127.0.0.1:8787/v1/packs/spiral/demo-skin/versions/latest/download
```

## Configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `BIND_ADDR` | `127.0.0.1:8787` | Listen address |
| `INSTANCE_NAME` | `Spiral Pack Registry` | Reported by `GET /v1/meta` |
| `DATABASE_URL` | `sqlite:data/registry.db?mode=rwc` | SQLite only in Phase 1; Postgres URL fails fast |
| `STORAGE_BACKEND` | `local` | `s3` is stubbed |
| `STORAGE_LOCAL_PATH` | `data/objects` | Object root for `local` |

## HTTP API (`/v1`)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/v1/meta` | `{ protocolVersion, name }` |
| `GET` | `/v1/packs` | List packs. Query: `contributionType`, `authorId`. Excludes yanked. |
| `GET` | `/v1/packs/:authorId/:packId` | Pack detail + published versions |
| `GET` | `/v1/packs/:authorId/:packId/versions/:version` | Version detail (`latest` alias) |
| `GET` | `/v1/packs/:authorId/:packId/versions/:version/download` | Stream `.spk` (yanked still resolves) |

## License

Apache License 2.0.
