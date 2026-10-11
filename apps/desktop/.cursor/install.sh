#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for the Spiral Tauri 2 desktop app.
# Runs after checkout on a fresh agent. Safe to re-run.
set -euo pipefail

# --- System libraries for the Tauri 2 / WebKitGTK desktop build ---
SYS_PKGS=(
  libwebkit2gtk-4.1-dev
  libgtk-3-dev
  libsoup-3.0-dev
  libjavascriptcoregtk-4.1-dev
  librsvg2-dev
  libayatana-appindicator3-dev
  libssl-dev
  build-essential
  pkg-config
  file
  patchelf
  unzip
  dbus-x11
)
if ! dpkg -s "${SYS_PKGS[@]}" >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${SYS_PKGS[@]}"
fi

# --- Rust toolchain ---
# The Cargo deps need edition2024 (Rust >= 1.85); the base image may pin 1.83.
rustup toolchain install stable --profile minimal --component rustfmt clippy >/dev/null 2>&1 || true
rustup default stable

# Rust's bundled lld linker must find libstdc++.so during the link step.
if [ ! -e /usr/lib/x86_64-linux-gnu/libstdc++.so ]; then
  sudo ln -sf libstdc++.so.6 /usr/lib/x86_64-linux-gnu/libstdc++.so
fi

# --- Private spiral-powered repo access ---
# If a personal access token with `contents: read` is provided as a secret
# (RELEASE_PLEASE_TOKEN or SPIRAL_GH_TOKEN), use it so `gh` can reach other
# private spiral-powered repos.
PRIVATE_TOKEN="${RELEASE_PLEASE_TOKEN:-${SPIRAL_GH_TOKEN:-}}"
if [ -n "${PRIVATE_TOKEN}" ]; then
  echo "install: using provided PAT for private spiral-powered repos"
  export GH_TOKEN="${PRIVATE_TOKEN}"
  export GITHUB_TOKEN="${PRIVATE_TOKEN}"
  # Drop pre-baked github.com URL rewrites (they embed the narrower token)...
  while IFS= read -r key; do
    [ -n "${key}" ] && git config --global --unset-all "${key}" || true
  done < <(git config --global --name-only --get-regexp '^url\..*\.insteadof$' 2>/dev/null | sort -u)
  # ...and re-add rewrites that embed the PAT.
  pat_base="https://x-access-token:${PRIVATE_TOKEN}@github.com/"
  for from in \
    "https://github.com/" \
    "ssh://git@github.com/" \
    "git@github.com:" \
    "git+ssh://git@github.com/"; do
    git config --global --add "url.${pat_base}.insteadOf" "${from}"
  done
else
  export GH_TOKEN="${GH_TOKEN:-$(gh auth token 2>/dev/null || true)}"
fi

# --- Frontend dependencies ---
npm install

echo "Spiral cloud-agent install complete."
