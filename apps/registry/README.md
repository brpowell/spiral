# spk-registry

A small HTTP service that stores and serves Spiral packs (`.spk`): a browsable catalog, version resolution, downloads, and an admin API and panel for publishing, yanking and purging.

It is the backend for Spiral's theme, skin, visualizer and sound library, and it is self-hostable. Packs are validated by [`spk-format`](../../libs/spk-format), the same library the app uses, so what the registry accepts is what the app expects.

**Current scope**

- Publishing is admin-only, with a single shared admin token. There are no public accounts or community uploads.
- Storage is SQLite for the catalog and the local disk for pack files. Postgres and S3 are not implemented yet: a Postgres `DATABASE_URL` fails fast at startup and `STORAGE_BACKEND=s3` is a stub.
- It runs as a single instance. Rate limits are kept in memory, per process.

## Quick start

You need a stable [Rust](https://rustup.rs) toolchain. Run everything from this directory so the default `data/` folder lands here (it is gitignored).

```bash
cd apps/registry

# Admin token: at least 32 bytes. Leave it unset to run read-only
# (the admin API then answers 503 `admin_disabled`).
export ADMIN_TOKEN="$(openssl rand -base64 32)"

# Optional: load a demo pack so the catalog isn't empty
cargo run --bin spk-registry-seed

# Serve on http://127.0.0.1:8787
cargo run
```

Browse the catalog:

```bash
curl -s http://127.0.0.1:8787/v1/meta | jq
curl -s http://127.0.0.1:8787/v1/packs | jq
```

The seed tool adds `spiral/demo-skin`, so you can also try:

```bash
curl -s http://127.0.0.1:8787/v1/packs/spiral/demo-skin | jq
curl -OJ http://127.0.0.1:8787/v1/packs/spiral/demo-skin/versions/latest/download
```

## Publishing a pack

A `.spk` is a zip archive with `pack.json` at its root (or inside one top-level folder). The repository includes a valid example pack in `fixtures/valid-theme`. Zip it, keeping paths relative to that folder:

```bash
python3 - <<'PY'
import zipfile, pathlib
root = pathlib.Path('fixtures/valid-theme')
with zipfile.ZipFile('valid-theme.spk', 'w') as z:
    for p in root.rglob('*'):
        if p.is_file():
            z.write(p, p.relative_to(root).as_posix())
print('wrote valid-theme.spk')
PY
```

Then upload it with the admin token:

```bash
curl -s -X POST http://127.0.0.1:8787/v1/rgad/packs \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "spk=@valid-theme.spk" | jq
```

The registry validates the pack with `spk-format`, computes its SHA-256 and uncompressed size, extracts the preview image if there is one, stores the archive, and returns the new version's metadata. Uploading a version that already exists returns `409 conflict`. A request without a valid token returns `401`.

You can do the same from the admin panel at <http://127.0.0.1:8787/rgad>. Enter the token on the page; it is kept in `sessionStorage` for that tab only.

## Configuration

All configuration is through environment variables.

| Env var | Default | Notes |
| --- | --- | --- |
| `BIND_ADDR` | `127.0.0.1:8787` | Listen address. Use `0.0.0.0:<port>` inside a container. |
| `INSTANCE_NAME` | `Spiral Pack Registry` | Reported by `GET /v1/meta`. |
| `DATABASE_URL` | `sqlite:data/registry.db?mode=rwc` | SQLite only for now; a Postgres URL fails fast. |
| `STORAGE_BACKEND` | `local` | `s3` is stubbed. |
| `STORAGE_LOCAL_PATH` | `data/objects` | Object root for the `local` backend. |
| `ADMIN_TOKEN` | _(empty)_ | Shared admin bearer token. Empty disables the admin API: its endpoints return `503 admin_disabled` (the panel page still loads but can do nothing). When set it must be at least 32 bytes; a shorter value stops the server at startup. |
| `MAX_UPLOAD_BYTES` | `52428800` (50 MiB) | Hard limit for `POST /v1/rgad/packs` only; other routes keep Axum's 2 MiB default. |
| `CLIENT_IP_HEADER` | `fly-client-ip` | Trusted proxy header used as the rate-limit key (`cf-connecting-ip`, `x-real-ip`, and so on). Empty means use the peer address only. Never point this at `X-Forwarded-For`, which clients can spoof. |
| `RUST_LOG` | `info` | Log filter, in [`tracing-subscriber` `EnvFilter`](https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html) syntax. |

Per-client limits, keyed on `CLIENT_IP_HEADER` and then the peer address:

- `/v1/rgad/*`: 10 requests per minute
- Catalog, meta and preview routes: 120 requests per minute
- `/download`: 4 concurrent `.spk` transfers

The limits are per process. If you run more than one instance, each enforces its own.

## HTTP API

Everything is under `/v1`. Errors are JSON: `{ "code": "...", "message": "..." }`.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/v1/meta` | `{ protocolVersion, name }` |
| `GET` | `/v1/packs` | List packs. Query: `contributionType`, `authorId`. Excludes yanked versions. |
| `GET` | `/v1/packs/:authorId/:packId` | Pack detail and its published versions |
| `GET` | `/v1/packs/:authorId/:packId/versions/:version` | Version detail. `latest` is an alias for the newest version. |
| `GET` | `/v1/packs/:authorId/:packId/versions/:version/download` | Stream the `.spk`. Yanked versions still resolve; purged ones return `410 Gone`. |
| `GET` | `/v1/packs/:authorId/:packId/versions/:version/preview` | Preview image (from `pack.json`'s `preview`, or the first contribution preview). `latest` works; yanked is fine; purged returns `410`. |
| `GET` | `/rgad` | Admin panel (single-page app; the token is entered in the page) |
| `GET` | `/v1/rgad/packs` | Admin list, including yanked versions. Requires the token. |
| `POST` | `/v1/rgad/packs` | Multipart upload (`spk` field required). Validates, hashes and stores the pack. |
| `POST` | `/v1/rgad/packs/:authorId/:packId/versions/:version/yank` | Soft delete: hides the version from the catalog but keeps the download. |
| `POST` | `/v1/rgad/packs/:authorId/:packId/versions/:version/unyank` | Reverses a yank. |
| `POST` | `/v1/rgad/packs/:authorId/:packId/versions/:version/purge` | Hard delete. Body: `{ "confirm": "author/pack@version", "reason": "…" }` |
| `POST` | `/v1/rgad/packs/:authorId/:packId/purge` | Delete a whole pack. Body: `{ "confirm": "author/pack", "reason": "…" }` |

Admin requests authenticate with `Authorization: Bearer <ADMIN_TOKEN>` or `X-Admin-Token: <ADMIN_TOKEN>`.

## Running it for real

- **TLS and the proxy.** Put the registry behind a reverse proxy or platform router that terminates TLS and sets HSTS; the service does not do either itself. Set `CLIENT_IP_HEADER` to the header your proxy sets with the real client address, and do not log `Authorization` headers at the proxy.
- **Persistence.** The catalog (`registry.db`) and the pack files (`objects/`) both live under the data directory. Keep that directory on a persistent volume and back it up. A fresh container filesystem starts with an empty catalog.
- **Container.** [`Dockerfile`](Dockerfile) builds from the repository root, because the registry depends on `libs/spk-format`:

  ```bash
  docker build -f apps/registry/Dockerfile -t spk-registry .
  docker run --rm -p 8080:8080 \
    -e BIND_ADDR=0.0.0.0:8080 \
    -e ADMIN_TOKEN="$(openssl rand -base64 32)" \
    -v spk-registry-data:/app/data \
    spk-registry
  ```

  The image's working directory is `/app`, so the default `data/` paths resolve to `/app/data`.
- **`fly.toml`** is the maintainers' own deployment config. Use it as a reference or ignore it.

## Security notes

- The admin token is compared in constant time, must be at least 32 bytes, and failed attempts are rate limited and logged without the token.
- Packs are validated and extracted with `spk-format`, which rejects paths that escape the archive. Pack and author ids are restricted to kebab-case slugs, and storage keys are checked so they cannot leave the storage root.
- Pack previews must be raster images (PNG, JPEG, WebP, GIF). SVG is rejected because it can execute when opened as a document.
- Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and a restrictive `Content-Security-Policy`.

To report a vulnerability, see [SECURITY.md](../../SECURITY.md).

## Development

```bash
cargo test -p spk-registry -p spk-format
cargo fmt -p spk-registry -p spk-format -- --check
cargo clippy -p spk-registry -p spk-format --all-targets -- -D warnings
```

The admin panel is a Preact and Vite app in [`admin/`](admin/). Its built output in `admin/dist/` is embedded into the binary with `rust-embed`, so rebuild it after changing the UI and commit the result:

```bash
cd admin && npm install && npm run build   # rebuild after UI changes
cd admin && npm run dev                    # hot reload; proxies /v1 to :8787
```

See [`admin/README.md`](admin/README.md). Contribution guidelines are in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
