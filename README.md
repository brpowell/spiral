# spk-registry

Distribution service for Spiral packs (`.spk`): catalog listing, version resolution, download serving, and admin publish/yank/purge.

Companion crate [`spk-format`](https://github.com/spiral-powered/spk-format) owns pack validation; this service indexes and serves published artifacts.

## Phase 2 status

Admin upload + integrity is implemented. Publishing no longer requires hand-editing the database.

## Quick start

```bash
# Required for admin write endpoints / panel
export ADMIN_TOKEN=dev-secret

# Optional: hand-seed demo rows for read-path smoke tests
cargo run --bin spk-registry-seed

# Serve
cargo run

# Browse
curl -s http://127.0.0.1:8787/v1/meta | jq
curl -s http://127.0.0.1:8787/v1/packs | jq

# Admin panel
open http://127.0.0.1:8787/admin

# Or upload via curl
curl -s -X POST http://127.0.0.1:8787/v1/admin/packs \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "spk=@fixtures/valid-theme.spk" | jq
```

Build a fixture `.spk` from the valid theme directory:

```bash
# any zip tool that preserves relative paths works; seed binary also zips fixtures/
python3 - <<'PY'
import zipfile, pathlib
root = pathlib.Path('fixtures/valid-theme')
with zipfile.ZipFile('fixtures/valid-theme.spk', 'w') as z:
    for p in root.rglob('*'):
        if p.is_file():
            z.write(p, p.relative_to(root).as_posix())
print('wrote fixtures/valid-theme.spk')
PY
```

## Configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `BIND_ADDR` | `127.0.0.1:8787` | Listen address |
| `INSTANCE_NAME` | `Spiral Pack Registry` | Reported by `GET /v1/meta` |
| `DATABASE_URL` | `sqlite:data/registry.db?mode=rwc` | SQLite only for now; Postgres URL fails fast |
| `STORAGE_BACKEND` | `local` | `s3` is stubbed |
| `STORAGE_LOCAL_PATH` | `data/objects` | Object root for `local` |
| `ADMIN_TOKEN` | _(empty)_ | Shared admin bearer token; empty disables write endpoints |
| `MAX_UPLOAD_BYTES` | `52428800` (50 MiB) | Hard limit for multipart uploads |

## HTTP API (`/v1`)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/v1/meta` | `{ protocolVersion, name }` |
| `GET` | `/v1/packs` | List packs. Query: `contributionType`, `authorId`. Excludes yanked. |
| `GET` | `/v1/packs/:authorId/:packId` | Pack detail + published versions |
| `GET` | `/v1/packs/:authorId/:packId/versions/:version` | Version detail (`latest` alias) |
| `GET` | `/v1/packs/:authorId/:packId/versions/:version/download` | Stream `.spk` (yanked still resolves; purged → `410 Gone`) |
| `GET` | `/v1/packs/:authorId/:packId/versions/:version/icon` | Pack icon from `pack.json` `icon` (extracted at publish; `latest` alias; yanked ok; purged → `410`) |
| `GET` | `/admin` | Minimal admin panel (token entered in-page) |
| `GET` | `/v1/admin/packs` | Admin list (includes yanked). Requires token. |
| `POST` | `/v1/admin/packs` | Multipart upload (`spk` required). Validates via `spk-format`, computes sha256 + size, extracts pack icon if declared. |
| `POST` | `/v1/admin/packs/:authorId/:packId/versions/:version/yank` | Soft-delete (catalog hide; download kept) |
| `POST` | `/v1/admin/packs/:authorId/:packId/versions/:version/unyank` | Clear yank — version reappears in catalog |
| `POST` | `/v1/admin/packs/:authorId/:packId/versions/:version/purge` | Hard delete. Body: `{ "confirm": "author/pack@version", "reason": "…" }` |
| `POST` | `/v1/admin/packs/:authorId/:packId/purge` | Pack-level hard delete. Body: `{ "confirm": "author/pack", "reason": "…" }` |

Admin auth: `Authorization: Bearer <ADMIN_TOKEN>` or `X-Admin-Token: <ADMIN_TOKEN>`.

## License

Apache License 2.0.
