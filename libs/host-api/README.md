# spiral-host-api

The HTTP API a Spiral library host serves to its clients. The library sync endpoints live here
today; audio, artwork and pairing come later.

- `router(HostApi)` builds the API over a `HostLibrary` (where data comes from) and an
  `Authenticator` (who may ask). `SqliteHostLibrary` reads a desktop `Library.db` read-only.
- `serve(listener, router, shutdown)` runs it on any `axum::serve::Listener` the host opened.
- `serve_connection(io, router)` runs it on one stream that is already connected.

The crate never binds an address. Every route, unknown paths included, needs
`Authorization: Bearer <token>`; the peer's address is never trusted.

## dev-host

A development server over a `Library.db`. Point it at a copy or a test database, never at your
real `~/Music/Spiral`.

```bash
SPIRAL_DEV_TOKEN=dev-secret cargo run -p spiral-host-api --features dev-host --bin dev-host -- \
  --db /path/to/Library.db
```

Flags: `--db` (required), `--spiral-folder` (defaults to the database's folder), `--addr`
(defaults to `127.0.0.1:7878`) and `--token` (or `SPIRAL_DEV_TOKEN`). It won't start without a
token. Ctrl-C shuts it down.

## Endpoints

All `GET`, all JSON. Errors are `{ "error": "..." }`: 400 for a bad query, 401 (with
`WWW-Authenticate: Bearer`) for a missing or wrong token, 404 for an unknown path, 500 for a
storage failure (details go to the host's log only).

```bash
TOKEN=dev-secret
HOST=http://127.0.0.1:7878

# The library id and where its change feed stands.
curl -H "Authorization: Bearer $TOKEN" $HOST/v1/library

# The whole catalog at the current rev.
curl -H "Authorization: Bearer $TOKEN" $HOST/v1/snapshot

# Changes since a cursor, or {"type":"resnapshot",...} when the client must start over.
curl -H "Authorization: Bearer $TOKEN" \
  "$HOST/v1/changes?library_id=<library_id>&since=<rev>"

# No token: 401.
curl -i $HOST/v1/library
```
