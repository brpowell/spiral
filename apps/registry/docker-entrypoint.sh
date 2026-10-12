#!/bin/sh
# Entrypoint for the spk-registry image.
#
# The server runs as the unprivileged `spk` user. Volumes (for example on
# Fly.io) are usually mounted root-owned, so when started as root this fixes
# ownership of the data directory and then drops privileges before exec'ing the
# server. When started as a non-root user (for example `docker run --user`), it
# just execs the command.
set -eu

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # Only touch files that are not already owned by spk, so restarts are cheap.
  find "$DATA_DIR" ! -user spk -exec chown spk:spk {} +
  exec setpriv --reuid=spk --regid=spk --init-groups "$@"
fi

exec "$@"
