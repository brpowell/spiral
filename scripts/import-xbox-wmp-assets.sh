#!/usr/bin/env bash
# Import Xbox WMP skin assets into the builtin xbox skin pack.
# skin.json must reference explicit paths under assets/ including extensions.
# Usage: ./scripts/import-xbox-wmp-assets.sh [path-to-XBOX-folder]

set -euo pipefail

XBOX="${1:-$(cd "$(dirname "$0")/.." && pwd)/wmp-skins/XBOX}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/skins/builtin/xbox/assets"
BTN="$OUT/buttons"
SLIDERS="$OUT/sliders"
FRAME="$OUT/frame"
PREVIEW="$ROOT/src-tauri/skins/builtin/xbox/preview.png"

if [[ ! -d "$XBOX" ]]; then
  echo "Xbox skin folder not found: $XBOX" >&2
  exit 1
fi

mkdir -p "$BTN" "$SLIDERS" "$OUT/animations" "$OUT/decorations" "$FRAME" "$OUT/content"

chroma() {
  ffmpeg -y -loglevel error -i "$1" -vf "format=rgba,colorkey=0xFF00FF:0.08:0.05" "$2"
}

chroma_gif_once() {
  ffmpeg -y -loglevel error -i "$1" \
    -vf "format=rgba,colorkey=0xFF00FF:0.08:0.05,split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128" \
    -loop -1 "$2"
}

gif_preserve() {
  ffmpeg -y -loglevel error -i "$1" \
    -vf "split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128" \
    -loop 0 "$2"
}

gif_preserve_once() {
  ffmpeg -y -loglevel error -i "$1" \
    -vf "split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128" \
    -loop -1 "$2"
}

gif_first_frame() {
  ffmpeg -y -loglevel error -i "$1" -frames:v 1 \
    -vf "format=rgba,colorkey=0xFF00FF:0.08:0.05" "$2"
}

# First frame to PNG preserving native GIF transparency (not WMP magenta key).
gif_first_frame_preserve() {
  ffmpeg -y -loglevel error -i "$1" -frames:v 1 \
    -vf "split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128" \
    "$2"
}

jpg_to_png() {
  ffmpeg -y -loglevel error -i "$1" "$2"
}

# Preserve a source PNG's native alpha channel verbatim. Use for glass /
# gradient overlays whose transparency is baked into the alpha channel rather
# than a magenta chroma key. Running these through chroma() would overwrite the
# partial alpha (colorkey forces every non-keyed pixel to fully opaque).
alpha_png() {
  cp "$1" "$2"
}

import_button_group() {
  local base="$1"
  local out="$2"
  local map="${3:-${base}_map}"
  if [[ -f "$XBOX/${base}_no.png" ]]; then
    chroma "$XBOX/${base}_no.png" "$BTN/${out}.png"
  elif [[ -f "$XBOX/${base}_no.gif" ]]; then
    # Native GIF transparency (e.g. xp_pause), not WMP magenta.
    gif_first_frame_preserve "$XBOX/${base}_no.gif" "$BTN/${out}.png"
    gif_preserve_once "$XBOX/${base}_no.gif" "$BTN/${out}-rest.gif"
  elif [[ -f "$XBOX/${base}.gif" ]]; then
    gif_first_frame_preserve "$XBOX/${base}.gif" "$BTN/${out}.png"
  fi
  if [[ -f "$XBOX/${base}_hov.gif" ]]; then
    gif_preserve_once "$XBOX/${base}_hov.gif" "$BTN/${out}-hover.gif"
  elif [[ -f "$XBOX/${base}_hover.gif" ]]; then
    gif_preserve_once "$XBOX/${base}_hover.gif" "$BTN/${out}-hover.gif"
  elif [[ -f "$XBOX/${base}_hov.png" ]]; then
    chroma "$XBOX/${base}_hov.png" "$BTN/${out}-hover.png"
  fi
  if [[ -f "$XBOX/${base}_do.png" ]]; then
    chroma "$XBOX/${base}_do.png" "$BTN/${out}-pressed.png"
  elif [[ -f "$XBOX/${base}_do.gif" ]]; then
    gif_preserve_once "$XBOX/${base}_do.gif" "$BTN/${out}-pressed.gif"
  elif [[ -f "$XBOX/${base}_down.gif" ]]; then
    gif_preserve_once "$XBOX/${base}_down.gif" "$BTN/${out}-pressed.gif"
  fi
  cp "$XBOX/${map}.png" "$BTN/${out}-map.png"
}

import_inverted_wmp_button() {
  local base="$1"
  local out="$2"
  # WMP uses *_hov.gif as the resting image and *_no.gif as hoverImage (opposite of eq/pl).
  if [[ -f "$XBOX/${base}_hov.gif" ]]; then
    gif_first_frame "$XBOX/${base}_hov.gif" "$BTN/${out}.png"
    gif_preserve_once "$XBOX/${base}_hov.gif" "$BTN/${out}-rest.gif"
  fi
  if [[ -f "$XBOX/${base}_no.gif" ]]; then
    gif_preserve_once "$XBOX/${base}_no.gif" "$BTN/${out}-hover.gif"
  fi
  if [[ -f "$XBOX/${base}_do.gif" ]]; then
    chroma_gif_once "$XBOX/${base}_do.gif" "$BTN/${out}-pressed.gif"
  elif [[ -f "$XBOX/${base}_do.png" ]]; then
    chroma "$XBOX/${base}_do.png" "$BTN/${out}-pressed.png"
  fi
}

import_simple_button() {
  local base="$1"
  local out="$2"
  if [[ -f "$XBOX/${base}_no.png" ]]; then
    chroma "$XBOX/${base}_no.png" "$BTN/${out}.png"
  elif [[ -f "$XBOX/${base}_no.gif" ]]; then
    gif_first_frame "$XBOX/${base}_no.gif" "$BTN/${out}.png"
    gif_preserve_once "$XBOX/${base}_no.gif" "$BTN/${out}-rest.gif"
  fi
  if [[ -f "$XBOX/${base}_hov.gif" ]]; then
    gif_preserve_once "$XBOX/${base}_hov.gif" "$BTN/${out}-hover.gif"
  elif [[ -f "$XBOX/${base}_hov.png" ]]; then
    chroma "$XBOX/${base}_hov.png" "$BTN/${out}-hover.png"
  fi
  if [[ -f "$XBOX/${base}_do.png" ]]; then
    chroma "$XBOX/${base}_do.png" "$BTN/${out}-pressed.png"
  elif [[ -f "$XBOX/${base}_do.gif" ]]; then
    chroma_gif_once "$XBOX/${base}_do.gif" "$BTN/${out}-pressed.gif"
  fi
}

# Main chrome
chroma "$XBOX/main.png" "$OUT/background.png"
PREVIEW_TMP="$ROOT/src-tauri/skins/builtin/xbox/preview.tmp.png"
jpg_to_png "$XBOX/preview.jpg" "$PREVIEW_TMP"
ffmpeg -y -loglevel error -i "$PREVIEW_TMP" \
  -vf "scale=320:200:force_original_aspect_ratio=increase,crop=320:200" \
  "$PREVIEW"
rm -f "$PREVIEW_TMP"

# Window chrome (WMP uses hov as resting image and no as hoverImage — see
# import_inverted_wmp_button).
for pair in min:min full:full close:close; do
  base="${pair%%:*}"
  out="${pair##*:}"
  import_inverted_wmp_button "$base" "$out"
done

# X pulse logo
chroma "$XBOX/x_pulse.png" "$BTN/x-pulse.png"
gif_preserve_once "$XBOX/x_pulse.gif" "$BTN/x-pulse-hover.gif"
chroma_gif_once "$XBOX/x_pulse_hov.gif" "$BTN/x-pulse-pressed.gif"

# Reverse shutter button (sticky toggle)
import_simple_button "reverse" "reverse"

# Transport button groups (WMP uses shared xp_/xp_map naming)
import_transport_group() {
  local out="$1"
  local default="$2"
  local hover="$3"
  local pressed="$4"
  local map="$5"
  gif_first_frame "$XBOX/$default" "$BTN/${out}.png"
  gif_preserve_once "$XBOX/$default" "$BTN/${out}-rest.gif"
  chroma_gif_once "$XBOX/$hover" "$BTN/${out}-hover.gif"
  chroma_gif_once "$XBOX/$pressed" "$BTN/${out}-pressed.gif"
  cp "$XBOX/$map" "$BTN/${out}-map.png"
}

import_transport_group "transport-closed" "xp_up.gif" "xp_hover.gif" "xp_down.gif" "xp_map.png"
import_transport_group "transport-open" "xp_up_open.gif" "xp_hover_open.gif" "xp_down_open.gif" "xp_map_open.png"
import_button_group "xp_pause" "pause-group"
import_button_group "xp_np" "prev-next"

# Bottom control buttons (vis uses inverted WMP hover mapping like window chrome)
for btn in vis_prev:vis-prev vis_next:vis-next eq:eq pl:pl; do
  base="${btn%%:*}"
  out="${btn##*:}"
  import_simple_button "$base" "$out"
done
import_inverted_wmp_button "vis" "vis"

# EQ preset nav
import_simple_button "eq_prev" "eq-prev"
import_simple_button "eq_next" "eq-next"

# Playlist shuffle / repeat
import_simple_button "shuff" "shuffle"
import_simple_button "rep" "repeat"

# Playlist / aux close
import_simple_button "x_vid_close" "aux-close"

# Sliders — strip PNGs rely on native alpha (gradient anti-alias), not magenta.
alpha_png "$XBOX/seek.png" "$SLIDERS/seek.png"
gif_first_frame "$XBOX/seek_map.gif" "$SLIDERS/seek-map.png"
alpha_png "$XBOX/vol.png" "$SLIDERS/vol.png"
gif_first_frame "$XBOX/vol_map.gif" "$SLIDERS/vol-map.png"

# EQ thumbs (thumb-only sliders; grooves are in eq-panel.png)
alpha_png "$XBOX/thumb.png" "$SLIDERS/eq-thumb.png"
alpha_png "$XBOX/thumb2.png" "$SLIDERS/eq-thumb-pressed.png"

# Decorations
# These three overlay the screen area and rely on native alpha (glass reflection
# + gradient backings). They have no magenta key, so preserve alpha as-is.
alpha_png "$XBOX/screen_cover.png" "$OUT/decorations/screen-cover.png"
alpha_png "$XBOX/time_meta_back.png" "$OUT/decorations/time-meta-back.png"
alpha_png "$XBOX/screen_buttons_back.png" "$OUT/decorations/screen-buttons-back.png"
chroma "$XBOX/button_patch.png" "$OUT/decorations/button-patch.png"
chroma "$XBOX/min_patch.png" "$OUT/decorations/min-patch.png"
jpg_to_png "$XBOX/screen_back_blur.jpg" "$OUT/decorations/vis-back.png"
chroma "$XBOX/eq_back.png" "$OUT/decorations/eq-panel.png"

# Animations
# Shutter GIFs: copy verbatim — ffmpeg re-encode drops the terminal clear-to-transparent
# frame WMP uses to hand off to intro_anim.png underneath the animation overlay.
cp "$XBOX/intro_anim.gif" "$OUT/animations/shutter-open.gif"
cp "$XBOX/intro_anim_rev.gif" "$OUT/animations/shutter-close.gif"
gif_preserve "$XBOX/x_intro_anim.gif" "$OUT/animations/x-intro.gif"
chroma "$XBOX/intro_anim.png" "$OUT/animations/shutter-static.png"
gif_preserve "$XBOX/nobang2.gif" "$OUT/animations/vis-idle.gif"

# Frame tiles (playlist / future video aux)
for tile in \
  x_top_left:f_top_left \
  x_top:f_top_center \
  x_top_right:f_top_right \
  x_f_top_s:f_top_s \
  x_f_top2:f_top_s_2 \
  x_left:f_left_s \
  x_right:f_right_s \
  x_bot_left:f_bot_left \
  x_f_bot:f_bot_center \
  x_bot_right:f_bot_right \
  x_f_bot_s:f_bot_s \
  x_f_bot2:f_bot_s_2 \
  x_f_top:f_inner_top \
  x_f_left:f_inner_left \
  x_f_left_s:f_inner_left_s \
  x_f_left2:f_inner_left2 \
  x_f_right:f_inner_right \
  x_f_right_s:f_inner_right_s \
  x_f_right2:f_inner_right2 \
  x_bot:f_outer_bot; do
  src="${tile%%:*}"
  dst="${tile##*:}"
  if [[ -f "$XBOX/${src}.png" ]]; then
    chroma "$XBOX/${src}.png" "$FRAME/${dst}.png"
  fi
done

# Future content viewer assets
for asset in c_xbox c_games c_web c_winmedia c_winmedia_cs content_mode; do
  if [[ -f "$XBOX/${asset}.jpg" ]]; then
    jpg_to_png "$XBOX/${asset}.jpg" "$OUT/content/${asset}.png"
  elif [[ -f "$XBOX/${asset}.png" ]]; then
    chroma "$XBOX/${asset}.png" "$OUT/content/${asset}.png"
  fi
done

echo "Imported Xbox assets to $OUT"
