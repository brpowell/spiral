# spk-registry

A small HTTP service that stores and serves Spiral items (`.spk`): a browsable catalog, version resolution, downloads, and an admin API and panel for publishing, yanking and purging.

It is the backend for Spiral's theme, skin, visualizer and sound library, and it is self-hostable. Items are validated by [`spk-format`](../../libs/spk-format), the same library the app uses, so what the registry accepts is what the app expects.

**Current scope**

- Publishing is admin-only, with a single shared admin token. There are no public accounts or community uploads.
- The catalog is SQLite (the default) or Postgres, chosen by the scheme of `DATABASE_URL`. Item files live on the local disk (the default) or in an S3-compatible bucket (`STORAGE_BACKEND=s3`). Any combination works; see [Backends](#backends).
- With SQLite and local disk it must run as a single instance. With Postgres and S3 it can run more than one, but rate limits are kept in memory, per process, so each instance enforces its own.

## Quick start

You need a stable [Rust](https://rustup.rs) toolchain and Node 22 (to build the admin panel once). Run everything from this directory so the default `data/` folder lands here (it is gitignored).

```bash
cd apps/registry

# Build the admin panel bundle that gets embedded into the binary
(cd admin && npm ci && npm run build)

# Admin token: at least 32 bytes. Leave it unset to run read-only
# (the admin API then answers 503 `admin_disabled`).
export ADMIN_TOKEN="$(openssl rand -base64 32)"

# Optional: load demo items (a theme, skin, visualizer and sound) so the catalog isn't empty
cargo run --bin spk-registry-seed

# Serve on http://127.0.0.1:8787
cargo run
```

Browse the catalog:

```bash
curl -s http://127.0.0.1:8787/v1/meta | jq
curl -s 'http://127.0.0.1:8787/v1/items?type=theme' | jq
```

The seed tool adds `spiral.theme.demo-theme` and a few more, so you can also try:

```bash
curl -s http://127.0.0.1:8787/v1/items/spiral/theme/demo-theme | jq
curl -OJ http://127.0.0.1:8787/v1/items/spiral/theme/demo-theme/versions/latest/download
```

## Publishing an item

An item is one theme, skin, visualizer or sound. A `.spk` is a zip archive with the item manifest (`theme.json`, `skin.json`, `viz.json` or `sound.json`) at its root, or inside one top-level folder. The manifest carries the item's `id`, `publisherId`, `version` and optional `minAppVersion`; the effective id is `publisherId.type.id`. The repository includes one valid item per type in `fixtures/items/`. Zip one, keeping paths relative to that folder:

```bash
python3 - <<'PY'
import zipfile, pathlib
root = pathlib.Path('fixtures/items/demo-theme')
with zipfile.ZipFile('demo-theme.spk', 'w') as z:
    for p in root.rglob('*'):
        if p.is_file():
            z.write(p, p.relative_to(root).as_posix())
print('wrote demo-theme.spk')
PY
```

Then upload it with the admin token:

```bash
curl -s -X POST http://127.0.0.1:8787/admin/api/items \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "spk=@demo-theme.spk" | jq
```

The registry validates the item with `spk-format`, computes its SHA-256 and uncompressed size, extracts the preview image (declared by the manifest's `preview`) and the optional `README.md` and `CHANGELOG.md`, stores the archive, and returns the new version's metadata. A version is immutable: uploading one that already exists returns `409 conflict`. A request without a valid token returns `401`.

You can do the same from the admin panel at <http://127.0.0.1:8787/admin>. Enter the token on the page; it is kept in `sessionStorage` for that tab only.

## Backends

Pick the catalog and the file store independently:

| Catalog | Files | Good for |
| --- | --- | --- |
| SQLite | local disk | Trying it out and small self-hosted instances. One machine, with a persistent volume. |
| Postgres | local disk | A managed catalog with files still on a volume. |
| SQLite | S3 | Files off the machine, catalog still on it. |
| Postgres | S3 | A hosted deployment with no local state: no volume, and more than one instance is possible. |

**Postgres.** Set `DATABASE_URL=postgres://…` (use `sslmode=require` for a hosted database). Both supported backends keep their migrations under `migrations/<backend>/`, and a test keeps their tables and columns identical. It works with serverless Postgres such as Neon, Supabase and Aurora Serverless:

- The first connection at startup is retried, because a scaled-to-zero database takes a moment to wake.
- Connections are retired before the provider would drop them.
- Behind a connection pooler in transaction mode, prepared statements are turned off (`DB_POOLER`, detected for common pooled URLs), and migrations should use the provider's direct URL through `DATABASE_MIGRATE_URL`, because they hold a session-level advisory lock that a transaction pooler cannot keep.

**S3.** The registry stores `.spk` archives and previews in the bucket. Downloads redirect to a short-lived presigned URL, so file bytes never pass through the registry; previews are streamed by the registry itself, because the desktop app does not follow redirects for them. Credentials come from the standard AWS environment (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`) or a profile, never from the repository. The credentials need `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on the bucket; add `s3:ListBucket` too, since without it S3 reports a missing object as 403 and the registry can only guess. Keep the bucket private: nothing in it needs to be public.

Local development against both, with Docker (S3Mock is a small S3-compatible server that accepts any credentials and creates the bucket at startup):

```bash
docker run -d --name spk-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=spk -p 5432:5432 postgres:16
docker run -d --name spk-s3 -e initialBuckets=spk -p 9090:9090 adobe/s3mock

export DATABASE_URL=postgres://postgres:pw@127.0.0.1:5432/spk
export STORAGE_BACKEND=s3 S3_BUCKET=spk S3_ENDPOINT=http://127.0.0.1:9090
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
cargo run --bin spk-registry-seed && cargo run
```

The backend tests run against such servers when you set `TEST_DATABASE_URL` (and optionally `TEST_DATABASE_POOLED`, `TEST_DATABASE_MIGRATE_URL`) or `TEST_S3_ENDPOINT` (and `TEST_S3_BUCKET`, default `spk-test`); CI does this on every change, including Postgres behind PgBouncer.

## Configuration

All configuration is through environment variables.

| Env var | Default | Notes |
| --- | --- | --- |
| `BIND_ADDR` | `127.0.0.1:8787` | Listen address. Use `0.0.0.0:<port>` inside a container. |
| `INSTANCE_NAME` | `Spiral Registry` | Reported by `GET /v1/meta`. |
| `DATABASE_URL` | `sqlite:data/registry.db?mode=rwc` | `sqlite:…` or `postgres://…` (`postgresql://` also works). |
| `DATABASE_MIGRATE_URL` | _(empty)_ | Direct (non-pooled) connection used for migrations. Set it when `DATABASE_URL` is a connection pooler; defaults to `DATABASE_URL`. |
| `DB_MAX_CONNECTIONS` | `5` | Postgres pool size (1 to 100). Keep it small on serverless plans, which cap connections. |
| `DB_ACQUIRE_TIMEOUT_SECS` | `30` | How long a request waits for a Postgres connection (1 to 300). Generous so a scaled-to-zero database can wake. |
| `DB_POOLER` | auto | `true` when `DATABASE_URL` points at a transaction-mode pooler: turns off prepared statements. Detected automatically for Neon `-pooler` hosts, Supabase's pooler host and port 6543; set it to override. |
| `ADMIN_PATH` | `/admin` | Where the admin panel is served. The admin API is under `<ADMIN_PATH>/api`. Must start with `/`, may not be `/` or under `/v1`; letters, digits, `-`, `_` and `.` only. A non-default path keeps the panel off the obvious URL, but the token is still what protects it. |
| `AUTO_MIGRATE` | `true` | Apply pending schema migrations at startup. Set `false` to run them yourself with `spk-registry migrate`. |
| `STORAGE_BACKEND` | `local` | `local` or `s3`. |
| `S3_BUCKET` | | Required for `s3`. |
| `S3_REGION` | `AWS_REGION`, else `us-east-1` | Region name. With a custom endpoint it is only used for signing. |
| `S3_ENDPOINT` | _(empty)_ | Custom endpoint for R2, Tigris, MinIO and other S3-compatible services. Leave empty for AWS S3. |
| `S3_KEY_PREFIX` | _(empty)_ | Prepended to every object key (for example `registry/`), so one bucket can hold several registries. |
| `S3_PATH_STYLE` | `true` with an endpoint, else `false` | Path-style addressing (`endpoint/bucket/key`). |
| `S3_PRESIGN_TTL_SECS` | `600` | Lifetime of the presigned download URLs the registry redirects to (1 to 604800). |
| `STORAGE_LOCAL_PATH` | `data/objects` | Object root for the `local` backend. |
| `ADMIN_TOKEN` | _(empty)_ | Shared admin bearer token. Empty disables the admin API: its endpoints return `503 admin_disabled` (the panel page still loads but can do nothing). When set it must be at least 32 bytes; a shorter value stops the server at startup. |
| `MAX_UPLOAD_BYTES` | `52428800` (50 MiB) | Hard limit for `POST <ADMIN_PATH>/api/items` only; other routes keep Axum's 2 MiB default. |
| `CLIENT_IP_HEADER` | `fly-client-ip` | Trusted proxy header used as the rate-limit key (`cf-connecting-ip`, `x-real-ip`, and so on). Empty means use the peer address only. Never point this at `X-Forwarded-For`, which clients can spoof. |
| `RUST_LOG` | `info` | Log filter, in [`tracing-subscriber` `EnvFilter`](https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html) syntax. |

Per-client limits, keyed on `CLIENT_IP_HEADER` and then the peer address:

- `<ADMIN_PATH>/api/*`: 10 requests per minute
- Catalog, meta and preview routes: 120 requests per minute
- `/download`: 4 concurrent `.spk` transfers

The limits are per process. If you run more than one instance, each enforces its own.

## HTTP API

Everything is under `/v1`. Errors are JSON: `{ "code": "...", "message": "..." }`.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/v1/meta` | `{ protocolVersion, name }` |
| `GET` | `/v1/items` | One entry per item with its newest version. Query: `type` (`theme`, `skin`, `visualizer`, `sound`), `q` (case-insensitive substring of name, description, id or publisher), `publisher`, `limit` (default 50, max 200), `offset`. Returns `{ items, total, limit, offset }`, sorted by name. Excludes yanked versions. |
| `GET` | `/v1/items/:publisherId/:type/:id` | Item and its published versions, newest first |
| `GET` | `/v1/items/:publisherId/:type/:id/versions/:version` | Version detail with README and CHANGELOG. `latest` is an alias for the newest version. |
| `GET` | `/v1/items/:publisherId/:type/:id/versions/:version/download` | The `.spk`. Yanked versions still resolve; purged ones return `410 Gone`. |
| `GET` | `/v1/items/:publisherId/:type/:id/versions/:version/preview` | Preview image, always streamed by the registry (never redirected). `latest` works; yanked is fine; purged returns `410`. |
| `POST` | `/v1/items/updates` | Batch update check. Body: `{ "appVersion": "0.4.0", "items": [{ "publisherId", "itemType", "id", "version" }] }`, at most 200 items. Returns `{ updates: [{ publisherId, itemType, id, installedVersion, latest }], unlisted: [{ publisherId, itemType, id }] }`. `latest` is the newest version above the installed one; when `appVersion` is given, versions whose `minAppVersion` it does not satisfy are skipped. `unlisted` items have no published version here. |
| `GET` | `<ADMIN_PATH>` | Admin panel, default `/admin` (single-page app; the token is entered in the page) |
| `GET` | `<ADMIN_PATH>/api/items` | Admin list, including yanked versions. Requires the token. |
| `POST` | `<ADMIN_PATH>/api/items` | Multipart upload (`spk` field required). Validates, hashes and stores the item. |
| `POST` | `<ADMIN_PATH>/api/items/:publisherId/:type/:id/versions/:version/yank` | Soft delete: hides the version from the catalog but keeps the download. |
| `POST` | `<ADMIN_PATH>/api/items/:publisherId/:type/:id/versions/:version/unyank` | Reverses a yank. |
| `POST` | `<ADMIN_PATH>/api/items/:publisherId/:type/:id/versions/:version/purge` | Hard delete. Body: `{ "confirm": "publisher/type/id@version", "reason": "…" }` |
| `POST` | `<ADMIN_PATH>/api/items/:publisherId/:type/:id/purge` | Delete a whole item. Body: `{ "confirm": "publisher/type/id", "reason": "…" }` |

Admin requests authenticate with `Authorization: Bearer <ADMIN_TOKEN>` or `X-Admin-Token: <ADMIN_TOKEN>`.

## Running it for real

- **TLS and the proxy.** Put the registry behind a reverse proxy or platform router that terminates TLS and sets HSTS; the service does not do either itself. Set `CLIENT_IP_HEADER` to the header your proxy sets with the real client address, and do not log `Authorization` headers at the proxy.
- **Persistence.** The catalog (`registry.db`) and the item files (`objects/`) both live under the data directory. Keep that directory on a persistent volume and back it up. A fresh container filesystem starts with an empty catalog.
- **Container.** [`Dockerfile`](Dockerfile) builds from the repository root, because the registry depends on `libs/spk-format`:

  ```bash
  docker build -f apps/registry/Dockerfile -t spk-registry .
  docker run --rm -p 8080:8080 \
    -e ADMIN_TOKEN="$(openssl rand -base64 32)" \
    -v spk-registry-data:/data \
    spk-registry
  ```

  The image listens on port 8080 and keeps the catalog and item files under `/data`, so mount a volume there. It runs as an unprivileged user (`spk`): the entrypoint fixes ownership of the data directory and then drops privileges, so a root-owned volume works. It stops cleanly on SIGTERM. Every variable in the table above can be overridden with `-e`; the image sets `BIND_ADDR`, `DATABASE_URL` and `STORAGE_LOCAL_PATH` to container-friendly defaults.
- **`fly.toml`** is the maintainers' own Fly.io deployment; see [Deploying to Fly.io](#deploying-to-flyio) if you want to run the same setup.

### Deploying to Fly.io

[`fly.toml`](fly.toml) describes the official deployment, and [`registry-deploy.yml`](../../.github/workflows/registry-deploy.yml) deploys `main` from CI whenever the registry, `spk-format` or the lockfile change. It builds the image from the repository root, pushes it to `registry.fly.io`, and releases it with `flyctl deploy --image`. It does nothing until the `FLY_API_TOKEN` secret exists.

One-time setup for an app (use your own app name in `fly.toml` if you fork this):

```bash
# 1. A volume for the catalog and item files (one machine, matching the single-instance design)
fly volumes create registry_data --region iad --size 1 -a spk-registry

# 2. The admin token (at least 32 bytes). Keep a copy; Fly will not show it again.
fly secrets set ADMIN_TOKEN="$(openssl rand -base64 32)" -a spk-registry

# 3. A deploy token for CI; add it as the FLY_API_TOKEN repository secret
fly tokens create deploy -a spk-registry
```

The catalog is SQLite on a single volume, so the app must have exactly one machine. A volume attaches to one machine, and Fly wants a volume for every machine it updates, so if an app already has two (the default for a first deploy), destroy the extra with `fly machines destroy <id>` before deploying. `--ha=false` stops flyctl from creating a second machine.

With Postgres and S3 (see [Backends](#backends)) the app keeps no local state, so none of this applies: no volume is needed, and it can run more than one machine.

If Fly's own GitHub integration is enabled for the app, turn it off so a push does not deploy twice.

To deploy by hand from a checkout:

```bash
flyctl auth docker
image="registry.fly.io/spk-registry:$(git rev-parse --short HEAD)"
docker build -f apps/registry/Dockerfile -t "$image" .
docker push "$image"
flyctl deploy --config apps/registry/fly.toml --image "$image" --ha=false
```

Do not run a plain `fly deploy` from this directory. Fly would use `apps/registry` as the build context, which does not contain `libs/spk-format`.

If a machine was already running before the volume existed, its catalog and items live in the machine's own filesystem (`/app/data` in the old image). Copy them onto the volume before replacing the machine, or republish the items. SQLite runs in WAL mode, so the catalog is `registry.db` plus `registry.db-wal` and `registry.db-shm`: stop the app first, or copy all three files together, and do not copy `registry.db` alone from a running server.

## Security notes

- The admin token is compared in constant time, must be at least 32 bytes, and failed attempts are rate limited and logged without the token.
- Items are validated and extracted with `spk-format`, which rejects paths that escape the archive and bounds how far an archive can expand: at most 10,000 entries, 256 MiB in total, and a 50:1 compression ratio (checked once an archive expands past 8 MiB), so a small upload cannot fill the disk. Item and publisher ids are restricted to kebab-case slugs, and storage keys are checked so they cannot leave the storage root.
- Item previews must be raster images (PNG, JPEG, WebP, GIF). SVG is rejected because it can execute when opened as a document.
- Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and a restrictive `Content-Security-Policy`.

To report a vulnerability, see [SECURITY.md](../../SECURITY.md).

## Development

### Schema migrations

The schema is versioned SQL under `migrations/<backend>/` (`NNNN_description.sql`, numbered from 0001), embedded in the binary and applied at startup. Migrations are forward-only: never edit one that has shipped (sqlx rejects a changed checksum), add a new file instead. `spk-registry migrate` applies them and exits, for example before a deploy that sets `AUTO_MIGRATE=false`.

```bash
cargo test -p spk-registry -p spk-format
cargo fmt -p spk-registry -p spk-format -- --check
cargo clippy -p spk-registry -p spk-format --all-targets -- -D warnings
```

The admin panel is a Preact and Vite app in [`admin/`](admin/). Its built output (`admin/dist/`, not committed) is embedded into the binary with `rust-embed` at compile time, so build it before compiling the registry, and again after changing the UI:

```bash
cd admin && npm ci && npm run build   # needed before cargo build / run / test
cd admin && npm run dev               # hot reload; proxies the API to :8787
```

The Docker image builds the panel in its own Node stage, so `docker build` needs nothing installed locally.

See [`admin/README.md`](admin/README.md). Contribution guidelines are in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
