# Build context is the monorepo ROOT (needs libs/spk-format):
#   docker build -f apps/registry/Dockerfile .
FROM lukemathwalker/cargo-chef:latest-rust-1 AS chef
WORKDIR /app

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY libs ./libs
COPY apps/registry ./apps/registry
# Workspace members outside this image: stub them so the workspace resolves.
RUN mkdir -p apps/desktop/src-tauri/src \
 && printf '[package]\nname = "Spiral"\nversion = "0.0.0"\nedition = "2021"\n' > apps/desktop/src-tauri/Cargo.toml \
 && touch apps/desktop/src-tauri/src/lib.rs
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY --from=planner /app .
RUN cargo build --release --bin spk-registry

FROM debian:bookworm-slim AS runtime
WORKDIR /app
COPY --from=builder /app/target/release/spk-registry /usr/local/bin
ENTRYPOINT ["/usr/local/bin/spk-registry"]
