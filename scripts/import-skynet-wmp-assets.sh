#!/usr/bin/env bash
# Import a subset of T3 Skynet WMP skin assets into the builtin T3 skin pack.
# Usage: ./scripts/import-skynet-wmp-assets.sh "/path/to/T3 Skynet Media Player"

set -euo pipefail

SKYNET="${1:-$HOME/Desktop/T3 Skynet Media Player}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/skins/builtin/t3/assets"
BTN="$OUT/buttons"
SLIDERS="$OUT/sliders"
TIME="$OUT/time"
PREVIEW="$ROOT/src-tauri/skins/builtin/t3/preview.png"

if [[ ! -d "$SKYNET" ]]; then
  echo "Skynet skin folder not found: $SKYNET" >&2
  exit 1
fi

mkdir -p "$BTN" "$SLIDERS" "$TIME" "$OUT/animations"

chroma() {
  ffmpeg -y -loglevel error -i "$1" -vf "format=rgba,colorkey=0xFF00FF:0.08:0.05" "$2"
}

chroma_gif() {
  ffmpeg -y -loglevel error -i "$1" \
    -vf "format=rgba,colorkey=0xFF00FF:0.08:0.05,split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128" \
    -loop 0 "$2"
}

# Button hover GIFs already use GIF transparency; colorkey would bake it opaque.
gif_preserve() {
  ffmpeg -y -loglevel error -i "$1" \
    -vf "split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128" \
    -loop 0 "$2"
}

chroma "$SKYNET/main_back.png" "$OUT/background.png"
chroma "$SKYNET/preview.png" "$PREVIEW"

for name in play pause prev next stop mute; do
  case $name in
    play) pre="m_play" ;;
    pause) pre="m_pause" ;;
    prev) pre="m_prev" ;;
    next) pre="m_next" ;;
    stop) pre="m_stop" ;;
    mute) pre="m_mute" ;;
  esac
  chroma "$SKYNET/${pre}_no.png" "$BTN/${name}.png"
  if [[ -f "$SKYNET/${pre}_hov.gif" ]]; then
    gif_preserve "$SKYNET/${pre}_hov.gif" "$BTN/${name}-hover.gif"
  else
    chroma "$SKYNET/${pre}_no.png" "$BTN/${name}-hover.png"
  fi
  chroma "$SKYNET/${pre}_do.png" "$BTN/${name}-pressed.png"
done

chroma "$SKYNET/seek.png" "$SLIDERS/seek.png"
chroma "$SKYNET/seek_map.png" "$SLIDERS/seek-map.png"
chroma "$SKYNET/vol.png" "$SLIDERS/vol.png"
chroma "$SKYNET/vol_map.png" "$SLIDERS/vol-map.png"

if [[ -f "$SKYNET/numbers.bmp" ]]; then
  chroma "$SKYNET/numbers.bmp" "$TIME/numbers.png"
elif [[ -f "$SKYNET/time.png" ]]; then
  chroma "$SKYNET/time.png" "$TIME/numbers.png"
fi

for gif in m_idle m_playback; do
  if [[ -f "$SKYNET/${gif}.gif" ]]; then
    chroma_gif "$SKYNET/${gif}.gif" "$OUT/animations/${gif}.gif"
  fi
done

if [[ -f "$SKYNET/m_top_no.png" ]]; then
  chroma "$SKYNET/m_top_no.png" "$BTN/window-chrome.png"
  if [[ -f "$SKYNET/m_top_hov.gif" ]]; then
    chroma_gif "$SKYNET/m_top_hov.gif" "$BTN/window-chrome-hover.gif"
  fi
  chroma "$SKYNET/m_top_do.png" "$BTN/window-chrome-pressed.png"
  cp "$SKYNET/m_top_map.png" "$BTN/window-chrome-map.png"
fi

echo "Imported Skynet assets to $OUT"
