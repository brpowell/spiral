# spiral-host-api

The HTTP API a Spiral library host serves to its clients.

- `router(HostApi)` builds the API from a `HostLibrary` and an `Authenticator`.
- `SqliteHostLibrary` reads a `Library.db` read-only.
- `serve(listener, router, shutdown)` serves on a listener the host opened.
- `serve_connection(io, router)` serves one already-connected stream.

Every route needs `Authorization: Bearer <token>`.

## Endpoints

`/v1/sync/*` is replication: a client mirrors the catalog from it. Content routes
(`/v1/tracks/…`, `/v1/artwork/…`) serve files to any client.

| Route | Returns |
| --- | --- |
| `GET /v1/sync/state` | Library id and current rev |
| `GET /v1/sync/snapshot` | The whole catalog |
| `GET /v1/sync/changes?library_id=&since=` | Changes since `since`, or a resnapshot |
| `GET /v1/tracks/{id}/audio` | The track's audio file, with range requests (`206`) |
| `GET /v1/artwork/{hash}?max=N` | An image by content hash, the original or resized |

Errors are `{ "error": "..." }` with status 400, 401, 404, 405, 500 or 501. A library that
doesn't serve files answers 501 on the file routes.

Audio: a track that is unknown, missing on disk or outside its source's root is the same 404.

Artwork: without `max` you get the original. `max` snaps up to 120, 300, 600 or 1200 (the
longer side in pixels; anything larger is 1200, and `0` or a non-number is 400). Images are
never upscaled: one that already fits comes back as the original. Resized images are JPEG, or
PNG when the source has alpha, and are cached in the `cache_dir` given to `HostApi`, never
under `Artwork/`. Responses carry `ETag: "<hash>-<size>"` (`orig` for originals) and
`Cache-Control: private, max-age=31536000, immutable`, and answer `If-None-Match` with 304. A
malformed hash is 404.

## dev-host

```bash
SPIRAL_DEV_TOKEN=dev-secret cargo run -p spiral-host-api --features dev-host --bin dev-host -- \
  --db /path/to/Library.db
```

Optional flags: `--spiral-folder` (default: the database's folder), `--cache-dir` for resized
artwork (default: `spiral-dev-host-cache` in the OS temp dir; refused inside the Spiral folder)
and `--addr` (default: `127.0.0.1:7878`). Point it at a test database, not your real library.

```bash
curl -H "Authorization: Bearer dev-secret" http://127.0.0.1:7878/v1/sync/state
curl -H "Authorization: Bearer dev-secret" http://127.0.0.1:7878/v1/sync/snapshot
curl -H "Authorization: Bearer dev-secret" \
  "http://127.0.0.1:7878/v1/sync/changes?library_id=<id>&since=<rev>"

# A whole track, then its first kilobyte (206 with Content-Range).
curl -H "Authorization: Bearer dev-secret" -o track.flac \
  http://127.0.0.1:7878/v1/tracks/<track-id>/audio
curl -i -H "Authorization: Bearer dev-secret" -H "Range: bytes=0-1023" -o - \
  http://127.0.0.1:7878/v1/tracks/<track-id>/audio

# Artwork: the original, then at most 300 px on the longer side.
curl -i -H "Authorization: Bearer dev-secret" -o cover \
  http://127.0.0.1:7878/v1/artwork/<hash>
curl -i -H "Authorization: Bearer dev-secret" -o cover-300.jpg \
  "http://127.0.0.1:7878/v1/artwork/<hash>?max=300"
```
