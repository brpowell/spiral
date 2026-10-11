# spk-registry

Distribution service for Spiral packs (`.spk`): catalog listing, version resolution, download serving, and admin publish/yank/purge.

Companion crate [`spk-format`](../../libs/spk-format) owns pack validation; this service indexes and serves published artifacts.

## Phase 2 status

Admin upload + integrity is implemented. Publishing no longer requires hand-editing the database.

## Quick start

```bash
# Required for admin write endpoints / panel (≥32 bytes; empty disables writes)
export ADMIN_TOKEN="$(openssl rand -base64 32)"

# Optional: hand-seed demo rows for read-path smoke tests
cargo run --bin spk-registry-seed

# Serve
cargo run

# Browse
curl -s http://127.0.0.1:8787/v1/meta | jq
curl -s http://127.0.0.1:8787/v1/packs | jq

# Admin panel (Preact SPA; rebuild with `cd admin && npm run build`)
open http://127.0.0.1:8787/rgad

# Or upload via curl
curl -s -X POST http://127.0.0.1:8787/v1/rgad/packs \
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

## Admin SPA

The `/rgad` panel is a Preact + Vite app under [`admin/`](admin/). Built files in `admin/dist/` are embedded into the binary (`rust-embed`).

```bash
cd admin && npm install && npm run build   # after UI changes
cd admin && npm run dev                    # HMR; proxies /v1 → :8787
```

See [`admin/README.md`](admin/README.md).

## Configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `BIND_ADDR` | `127.0.0.1:8787` | Listen address |
| `INSTANCE_NAME` | `Spiral Pack Registry` | Reported by `GET /v1/meta` |
| `DATABASE_URL` | `sqlite:data/registry.db?mode=rwc` | SQLite only for now; Postgres URL fails fast |
| `STORAGE_BACKEND` | `local` | `s3` is stubbed |
| `STORAGE_LOCAL_PATH` | `data/objects` | Object root for `local` |
| `ADMIN_TOKEN` | _(empty)_ | Shared admin bearer token; empty disables write endpoints. When set, must be ≥32 bytes. Do not log `Authorization` at the proxy. |
| `MAX_UPLOAD_BYTES` | `52428800` (50 MiB) | Hard limit for `POST /v1/rgad/packs` only; other routes stay at Axum’s 2 MiB default |
| `CLIENT_IP_HEADER` | `fly-client-ip` | Trusted proxy header for rate-limit keys (`cf-connecting-ip`, `x-real-ip`, …). Empty = peer address only. Do not use `X-Forwarded-For`. |

Per-IP limits (keyed on `CLIENT_IP_HEADER`, then the peer address):

- `/v1/rgad/*`: 10 requests/minute
- Catalog / meta / preview: 120 requests/minute
- `/download`: 4 concurrent `.spk` transfers

No JS challenges on `/v1/*` (desktop is a non-browser client).

## HTTP API (`/v1`)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/v1/meta` | `{ protocolVersion, name }` |
| `GET` | `/v1/packs` | List packs. Query: `contributionType`, `authorId`. Excludes yanked. |
| `GET` | `/v1/packs/:authorId/:packId` | Pack detail + published versions |
| `GET` | `/v1/packs/:authorId/:packId/versions/:version` | Version detail (`latest` alias) |
| `GET` | `/v1/packs/:authorId/:packId/versions/:version/download` | Stream `.spk` (yanked still resolves; purged → `410 Gone`) |
| `GET` | `/v1/packs/:authorId/:packId/versions/:version/preview` | Pack preview image (from `pack.json` `preview` or first contribution preview; `latest` alias; yanked ok; purged → `410`) |
| `GET` | `/rgad` | Admin SPA (token entered in-page; opaque login until authenticated) |
| `GET` | `/v1/rgad/packs` | Admin list (includes yanked). Requires token. |
| `POST` | `/v1/rgad/packs` | Multipart upload (`spk` required). Validates via `spk-format`, computes sha256 + uncompressed on-disk `sizeBytes`, extracts pack preview when present. |
| `POST` | `/v1/rgad/packs/:authorId/:packId/versions/:version/yank` | Soft-delete (catalog hide; download kept) |
| `POST` | `/v1/rgad/packs/:authorId/:packId/versions/:version/unyank` | Clear yank — version reappears in catalog |
| `POST` | `/v1/rgad/packs/:authorId/:packId/versions/:version/purge` | Hard delete. Body: `{ "confirm": "author/pack@version", "reason": "…" }` |
| `POST` | `/v1/rgad/packs/:authorId/:packId/purge` | Pack-level hard delete. Body: `{ "confirm": "author/pack", "reason": "…" }` |

Admin auth: `Authorization: Bearer <ADMIN_TOKEN>` or `X-Admin-Token: <ADMIN_TOKEN>`.

## License

Apache License 2.0.
