#!/usr/bin/env bash
# Import a subset of T3 Skynet WMP skin assets into the builtin T3 skin pack.
# Usage: ./scripts/import-skynet-wmp-assets.sh "/path/to/T3 Skynet Media Player"

set -euo pipefail

SKYNET="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "$SKYNET" ]]; then
  if [[ -d "$ROOT/wmp-skins/T3 Skynet Media Player 3" ]]; then
    SKYNET="$ROOT/wmp-skins/T3 Skynet Media Player 3"
  else
    SKYNET="$HOME/Desktop/T3 Skynet Media Player"
  fi
fi
OUT="$ROOT/src-tauri/skins/builtin/t3/assets"
BTN="$OUT/buttons"
SLIDERS="$OUT/sliders"
TIME="$OUT/time"
PREVIEW="$ROOT/src-tauri/skins/builtin/t3/preview.png"

if [[ ! -d "$SKYNET" ]]; then
  echo "Skynet skin folder not found: $SKYNET" >&2
  exit 1
fi

mkdir -p "$BTN" "$SLIDERS" "$TIME" "$OUT/animations" "$OUT/decorations"

chroma() {
  ffmpeg -y -loglevel error -i "$1" -vf "format=rgba,colorkey=0xFF00FF:0.08:0.05" "$2"
}

chroma_gif() {
  ffmpeg -y -loglevel error -i "$1" \
    -vf "format=rgba,colorkey=0xFF00FF:0.08:0.05,split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128" \
    -loop 0 "$2"
}

# Whole-sprite hover GIFs (single buttons): keep native GIF transparency.
# Masked button groups use chroma_gif instead — see import_button_group().
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

if [[ -f "$SKYNET/intro_anim.gif" ]]; then
  # Native GIF transparency (white scan lines), not WMP magenta.
  gif_preserve "$SKYNET/intro_anim.gif" "$OUT/animations/intro-light.gif"
fi

if [[ -f "$SKYNET/shutter_static.png" ]]; then
  chroma "$SKYNET/shutter_static.png" "$OUT/animations/shutter-static.png"
fi
for gif in shutter_open shutter_close; do
  if [[ -f "$SKYNET/${gif}.gif" ]]; then
    out_name="${gif/shutter_/shutter-}"
    # Native GIF transparency (white), not WMP magenta — preserve alpha, full frame count.
    gif_preserve "$SKYNET/${gif}.gif" "$OUT/animations/${out_name}.gif"
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

import_button_group() {
  local base="$1"
  local out="$2"
  chroma "$SKYNET/${base}_no.png" "$BTN/${out}.png"
  if [[ -f "$SKYNET/${base}_hov.gif" ]]; then
    chroma_gif "$SKYNET/${base}_hov.gif" "$BTN/${out}-hover.gif"
  elif [[ -f "$SKYNET/${base}_hov.png" ]]; then
    chroma "$SKYNET/${base}_hov.png" "$BTN/${out}-hover.png"
  fi
  chroma "$SKYNET/${base}_do.png" "$BTN/${out}-pressed.png"
  cp "$SKYNET/${base}_map.png" "$BTN/${out}-map.png"
}

import_simple_button() {
  local base="$1"
  local out="$2"
  chroma "$SKYNET/${base}_no.png" "$BTN/${out}.png"
  if [[ -f "$SKYNET/${base}_hov.gif" ]]; then
    gif_preserve "$SKYNET/${base}_hov.gif" "$BTN/${out}-hover.gif"
  elif [[ -f "$SKYNET/${base}_hov.png" ]]; then
    chroma "$SKYNET/${base}_hov.png" "$BTN/${out}-hover.png"
  fi
  chroma "$SKYNET/${base}_do.png" "$BTN/${out}-pressed.png"
}

for group in m_bot1:main-bottom-left m_bot2:main-bottom-right mini_set:mini-transport; do
  base="${group%%:*}"
  out="${group##*:}"
  if [[ -f "$SKYNET/${base}_no.png" && -f "$SKYNET/${base}_map.png" ]]; then
    import_button_group "$base" "$out"
  fi
done

for btn in m_switch:mini-switch m_logo:logo m_shutter:shutter; do
  base="${btn%%:*}"
  out="${btn##*:}"
  if [[ -f "$SKYNET/${base}_no.png" ]]; then
    import_simple_button "$base" "$out"
  fi
done

for btn in seek_inc:seek-forward seek_dec:seek-back vol_inc:volume-up vol_dec:volume-down; do
  base="${btn%%:*}"
  out="${btn##*:}"
  if [[ -f "$SKYNET/${base}_no.png" ]]; then
    import_simple_button "$base" "$out"
  fi
done

for name in mute pause prev; do
  pre="mini_${name}"
  chroma "$SKYNET/${pre}_no.png" "$BTN/mini-${name}.png"
  chroma "$SKYNET/${pre}_hov.png" "$BTN/mini-${name}-hover.png"
  chroma "$SKYNET/${pre}_do.png" "$BTN/mini-${name}-pressed.png"
done

chroma "$SKYNET/mini_back.png" "$OUT/mini-background.png"
chroma "$SKYNET/vol_mini.png" "$SLIDERS/vol-mini.png"
chroma "$SKYNET/vol_map_mini.png" "$SLIDERS/vol-mini-map.png"
chroma "$SKYNET/seek_mini.png" "$SLIDERS/seek-mini.png"
chroma "$SKYNET/seek_map_mini.png" "$SLIDERS/seek-mini-map.png"

if [[ -f "$SKYNET/eq_back.png" ]]; then
  chroma "$SKYNET/eq_back.png" "$OUT/eq-background.png"
  chroma "$SKYNET/eq_slider.png" "$SLIDERS/eq-band-track.png"
  chroma "$SKYNET/eq_thumb.png" "$SLIDERS/eq-band-thumb.png"
  chroma "$SKYNET/eq_thumb_3.png" "$SLIDERS/eq-balance-thumb.png"

  for btn in eq_close:eq-close eq_prev:eq-prev eq_next:eq-next; do
    base="${btn%%:*}"
    out="${btn##*:}"
    import_simple_button "$base" "$out"
  done

  if [[ -f "$SKYNET/eq_settings_no.png" && -f "$SKYNET/eq_settings_map.png" ]]; then
    import_button_group "eq_settings" "eq-settings"
  fi

  if [[ -f "$SKYNET/eq_srs_dis.png" ]]; then
    chroma "$SKYNET/eq_srs_dis.png" "$OUT/decorations/eq-srs-disabled.png"
  fi
fi

FRAME="$OUT/frame"
mkdir -p "$FRAME"

for tile in \
  f_top_left \
  f_top_center \
  f_top_right \
  f_top_s \
  f_top_s_2 \
  f_left_s \
  f_right_s \
  f_bot_left \
  f_bot_center \
  f_bot_right \
  f_bot_s \
  f_bot_s_2 \
  f_resize; do
  if [[ -f "$SKYNET/${tile}.png" ]]; then
    chroma "$SKYNET/${tile}.png" "$FRAME/${tile}.png"
  fi
done

if [[ -f "$SKYNET/f_close_no.png" ]]; then
  import_simple_button "f_close" "pl-close"
fi

if [[ -f "$SKYNET/pl_set_no.png" && -f "$SKYNET/pl_set_map.png" ]]; then
  chroma "$SKYNET/pl_set_no.png" "$BTN/pl-set.png"
  chroma "$SKYNET/pl_set_hov.png" "$BTN/pl-set-hover.png"
  chroma "$SKYNET/pl_set_do.png" "$BTN/pl-set-pressed.png"
  cp "$SKYNET/pl_set_map.png" "$BTN/pl-set-map.png"
fi

if [[ -f "$SKYNET/vis_set_no.png" && -f "$SKYNET/pl_set_map.png" ]]; then
  chroma "$SKYNET/vis_set_no.png" "$BTN/vis-set.png"
  if [[ -f "$SKYNET/vis_set_hov.png" ]]; then
    chroma "$SKYNET/vis_set_hov.png" "$BTN/vis-set-hover.png"
  fi
  chroma "$SKYNET/vis_set_do.png" "$BTN/vis-set-pressed.png"
  cp "$SKYNET/pl_set_map.png" "$BTN/vis-set-map.png"
fi

PROMO="$OUT/promo"
mkdir -p "$PROMO"

jpg_to_png() {
  ffmpeg -y -loglevel error -i "$1" "$2"
}

import_promo_jpg_button_group() {
  local base="$1"
  local out="$2"
  jpg_to_png "$SKYNET/${base}_no.jpg" "$BTN/${out}.png"
  if [[ -f "$SKYNET/${base}_hov.jpg" ]]; then
    jpg_to_png "$SKYNET/${base}_hov.jpg" "$BTN/${out}-hover.png"
  fi
  if [[ -f "$SKYNET/${base}_do.jpg" ]]; then
    jpg_to_png "$SKYNET/${base}_do.jpg" "$BTN/${out}-pressed.png"
  else
    jpg_to_png "$SKYNET/${base}_no.jpg" "$BTN/${out}-pressed.png"
  fi
  cp "$SKYNET/${base}_map.png" "$BTN/${out}-map.png"
}

import_promo_jpg_button() {
  local base="$1"
  local out="$2"
  jpg_to_png "$SKYNET/${base}_no.jpg" "$BTN/${out}.png"
  if [[ -f "$SKYNET/${base}_hov.jpg" ]]; then
    jpg_to_png "$SKYNET/${base}_hov.jpg" "$BTN/${out}-hover.png"
  fi
  jpg_to_png "$SKYNET/${base}_no.jpg" "$BTN/${out}-pressed.png"
}

if [[ -f "$SKYNET/c_back.jpg" ]]; then
  jpg_to_png "$SKYNET/c_back.jpg" "$PROMO/c_back.png"
fi

for deck in 1 2; do
  for page in $(seq 1 7); do
    if [[ -f "$SKYNET/c_sub_${deck}_${page}.jpg" ]]; then
      jpg_to_png "$SKYNET/c_sub_${deck}_${page}.jpg" "$PROMO/c_sub_${deck}_${page}.png"
    fi
  done
done

if [[ -f "$SKYNET/c_sub_3_1.jpg" ]]; then
  jpg_to_png "$SKYNET/c_sub_3_1.jpg" "$PROMO/c_sub_3_1.png"
fi

for page in 1 2; do
  if [[ -f "$SKYNET/c_sub_4_${page}.jpg" ]]; then
    jpg_to_png "$SKYNET/c_sub_4_${page}.jpg" "$PROMO/c_sub_4_${page}.png"
  fi
done

if [[ -f "$SKYNET/c_menu_no.jpg" && -f "$SKYNET/c_menu_map.png" ]]; then
  import_promo_jpg_button_group "c_menu" "info-sections"
fi

if [[ -f "$SKYNET/c_wb_no.png" ]]; then
  chroma "$SKYNET/c_wb_no.png" "$BTN/info-wb.png"
  if [[ -f "$SKYNET/c_wb_hov.png" ]]; then
    chroma "$SKYNET/c_wb_hov.png" "$BTN/info-wb-hover.png"
  fi
  chroma "$SKYNET/c_wb_no.png" "$BTN/info-wb-pressed.png"
fi

if [[ -f "$SKYNET/c_menu_return_no.png" ]]; then
  import_simple_button "c_menu_return" "info-return"
fi

if [[ -f "$SKYNET/c_nav_no.png" && -f "$SKYNET/c_nav_map.png" ]]; then
  import_button_group "c_nav" "info-nav"
fi

if [[ -f "$SKYNET/c_trailer_1_no.jpg" && -f "$SKYNET/c_trailer_1_map.png" ]]; then
  import_promo_jpg_button_group "c_trailer_1" "info-trailer-links"
fi

if [[ -f "$SKYNET/c_link_no.jpg" && -f "$SKYNET/c_link_map.png" ]]; then
  import_promo_jpg_button_group "c_link" "info-links-p1"
fi

if [[ -f "$SKYNET/c_link2_no.jpg" && -f "$SKYNET/c_link2_map.png" ]]; then
  import_promo_jpg_button_group "c_link2" "info-links-p2"
fi

if [[ -f "$SKYNET/c_link3_no.jpg" ]]; then
  import_promo_jpg_button "c_link3" "info-story-link"
fi

SOUNDS="$OUT/sounds"
mkdir -p "$SOUNDS"
for wav in buton window open close skynet; do
  if [[ -f "$SKYNET/${wav}.wav" ]]; then
    cp "$SKYNET/${wav}.wav" "$SOUNDS/"
  fi
done

echo "Imported Skynet assets to $OUT"
