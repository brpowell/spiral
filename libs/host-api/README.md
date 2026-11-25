# spiral-host-api

The HTTP API a Spiral library host serves to its clients.

- `router(HostApi)` builds the API from a `HostLibrary` and an `Authenticator`.
- `SqliteHostLibrary` reads a `Library.db` read-only.
- `serve(listener, router, shutdown)` serves on a listener the host opened.
- `serve_connection(io, router)` serves one already-connected stream.

Every route needs `Authorization: Bearer <token>`.

## Endpoints

| Route | Returns |
| --- | --- |
| `GET /v1/library` | Library id and current rev |
| `GET /v1/snapshot` | The whole catalog |
| `GET /v1/changes?library_id=&since=` | Changes since `since`, or a resnapshot |

Errors are `{ "error": "..." }` with status 400, 401, 404 or 500.

## dev-host

```bash
SPIRAL_DEV_TOKEN=dev-secret cargo run -p spiral-host-api --features dev-host --bin dev-host -- \
  --db /path/to/Library.db
```

Optional flags: `--spiral-folder` (default: the database's folder) and `--addr` (default:
`127.0.0.1:7878`).

```bash
curl -H "Authorization: Bearer dev-secret" http://127.0.0.1:7878/v1/library
curl -H "Authorization: Bearer dev-secret" http://127.0.0.1:7878/v1/snapshot
curl -H "Authorization: Bearer dev-secret" \
  "http://127.0.0.1:7878/v1/changes?library_id=<id>&since=<rev>"
```
