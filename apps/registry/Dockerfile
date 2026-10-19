# spk-registry image.
#
# The build context is the monorepo ROOT, because the registry depends on
# libs/spk-format:
#
#   docker build -f apps/registry/Dockerfile -t spk-registry .
#
# Run it with a volume on /data (catalog + pack files) and an admin token:
#
#   docker run --rm -p 8080:8080 -e ADMIN_TOKEN="$(openssl rand -base64 32)" \
#     -v spk-registry-data:/data spk-registry

# Base images. ARGs used in a FROM must be declared before the first FROM. Override
# NODE_IMAGE or RUST_IMAGE to pin a specific version.
ARG NODE_IMAGE=node:22-bookworm-slim
# cargo-chef caches compiled dependencies in their own layer, so changing
# registry code does not rebuild every crate.
ARG RUST_IMAGE=lukemathwalker/cargo-chef:latest-rust-1

# The admin panel (Preact + Vite) is built here and embedded into the binary at compile time.
FROM ${NODE_IMAGE} AS admin
WORKDIR /admin
COPY apps/registry/admin/package.json apps/registry/admin/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/registry/admin ./
RUN npm run build

FROM ${RUST_IMAGE} AS chef
WORKDIR /app

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY libs ./libs
COPY apps/registry ./apps/registry
# The workspace also lists the desktop app, which is not built here. Stub that
# member so the workspace resolves without copying the whole app. The registry
# does not depend on it, so it never ends up in the dependency recipe.
RUN mkdir -p apps/desktop/src-tauri/src \
 && printf '[package]\nname = "Spiral"\nversion = "0.0.0"\nedition = "2021"\n' > apps/desktop/src-tauri/Cargo.toml \
 && touch apps/desktop/src-tauri/src/lib.rs
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json -p spk-registry
COPY --from=planner /app .
COPY --from=admin /admin/dist ./apps/registry/admin/dist
RUN cargo build --release -p spk-registry --bin spk-registry

FROM debian:bookworm-slim AS runtime

LABEL org.opencontainers.image.title="spk-registry" \
      org.opencontainers.image.description="Spiral pack registry: catalog, version resolution and downloads for .spk packs" \
      org.opencontainers.image.source="https://github.com/brpowell/spiral" \
      org.opencontainers.image.licenses="Apache-2.0"

# Unprivileged user. The entrypoint starts as root only to fix volume ownership,
# then drops to this user before running the server.
RUN useradd --system --uid 10001 --user-group --no-create-home \
      --home-dir /nonexistent --shell /usr/sbin/nologin spk \
 && mkdir -p /data \
 && chown spk:spk /data

COPY --from=builder /app/target/release/spk-registry /usr/local/bin/spk-registry
COPY apps/registry/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Container defaults. Everything is overridable with -e; see apps/registry/README.md.
ENV BIND_ADDR=0.0.0.0:8080 \
    DATABASE_URL=sqlite:/data/registry.db?mode=rwc \
    STORAGE_LOCAL_PATH=/data/objects

VOLUME ["/data"]
EXPOSE 8080

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["spk-registry"]
