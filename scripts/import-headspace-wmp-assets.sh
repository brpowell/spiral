#!/usr/bin/env bash
# Import Headspace WMP skin assets into the builtin headspace skin pack.
# Usage: ./scripts/import-headspace-wmp-assets.sh [path-to-Headspace-folder]

set -euo pipefail

HEADSPACE="${1:-$(cd "$(dirname "$0")/.." && pwd)/wmp-skins/Headspace}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/skins/builtin/headspace/assets"
BTN="$OUT/buttons"
SLIDERS="$OUT/sliders"
PREVIEW="$ROOT/src-tauri/skins/builtin/headspace/preview.png"

if [[ ! -d "$HEADSPACE" ]]; then
  echo "Headspace skin folder not found: $HEADSPACE" >&2
  exit 1
fi

mkdir -p "$BTN" "$SLIDERS" "$OUT/decorations"

. "$(dirname "$0")/wmp-viz-panel-assets.sh"

chroma() {
  ffmpeg -y -loglevel error -i "$1" -vf "format=rgba,colorkey=0xFF00FF:0.08:0.05" "$2"
}

# Head uses red (#FF0000) clipping outside the silhouette and magenta (#FF00FF) for the forehead window.
# Chained colorkey cannot key both without restoring alpha; use geq instead.
chroma_head() {
  ffmpeg -y -loglevel error -i "$1" \
    -vf "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(eq(r(X,Y),255)*eq(g(X,Y),0)*eq(b(X,Y),0)+eq(r(X,Y),255)*eq(g(X,Y),0)*eq(b(X,Y),255),0,255)'" \
    "$2"
}

# Main chrome
chroma_head "$HEADSPACE/head.bmp" "$OUT/decorations/head.png"
chroma "$HEADSPACE/left_ear.bmp" "$OUT/decorations/left-ear.png"
chroma "$HEADSPACE/right_ear.bmp" "$OUT/decorations/right-ear.png"
chroma "$HEADSPACE/left_drawer_top.bmp" "$OUT/decorations/left-drawer-top.png"
chroma "$HEADSPACE/left_drawer_bottom.bmp" "$OUT/decorations/left-drawer-bottom.png"
chroma "$HEADSPACE/left_drawer_right.bmp" "$OUT/decorations/left-drawer-right.png"
chroma "$HEADSPACE/right_drawer_left.bmp" "$OUT/decorations/right-drawer-left.png"
chroma "$HEADSPACE/right_drawer_top.bmp" "$OUT/decorations/right-drawer-top.png"
chroma "$HEADSPACE/right_drawer_bottom.bmp" "$OUT/decorations/right-drawer-bottom.png"
chroma "$HEADSPACE/drawer_bkgrnd_left.bmp" "$OUT/decorations/drawer-bkgrnd-left.png"
chroma "$HEADSPACE/drawer_bkgrnd_top.bmp" "$OUT/decorations/drawer-bkgrnd-top.png"
chroma "$HEADSPACE/drawer_bkgrnd_bottom.bmp" "$OUT/decorations/drawer-bkgrnd-bottom.png"
chroma "$HEADSPACE/drawer_bkgrnd_right.bmp" "$OUT/decorations/drawer-bkgrnd-right.png"
# Viz panel: vid_bkgd when valid, else head.bmp forehead crop (9,59 216x158 in head subview).
wmp_viz_panel_assets "$HEADSPACE/head.bmp" 9 59 216 158 "$HEADSPACE/vid_bkgd.bmp" \
  "$OUT/decorations/vid-frame.png" "$OUT/decorations/vid-mask.png"

# Preview — scale head graphic for the skin picker (16:10 thumbnail)
ffmpeg -y -loglevel error -i "$OUT/decorations/head.png" \
  -vf "scale=320:200:force_original_aspect_ratio=increase,crop=320:200" \
  "$PREVIEW"

# Window chrome (minimize / close)
chroma "$HEADSPACE/minimize_close_01_default.bmp" "$BTN/window-chrome.png"
chroma "$HEADSPACE/minimize_close_02_rollover.bmp" "$BTN/window-chrome-hover.png"
chroma "$HEADSPACE/minimize_close_03_down.bmp" "$BTN/window-chrome-pressed.png"
cp "$HEADSPACE/minimize_close_map.bmp" "$BTN/window-chrome-map.png"
chmod u+w "$BTN/window-chrome-map.png" 2>/dev/null || true

# Transport controls (composite button group)
chroma "$HEADSPACE/play_controls_01_default.bmp" "$BTN/transport.png"
chroma "$HEADSPACE/play_controls_02_rollover.bmp" "$BTN/transport-hover.png"
chroma "$HEADSPACE/play_controls_03_down.bmp" "$BTN/transport-pressed.png"
cp "$HEADSPACE/play_controls_map.bmp" "$BTN/transport-map.png"
chmod u+w "$BTN/transport-map.png" 2>/dev/null || true

# Pause overlay (shown while playing)
chroma "$HEADSPACE/pause_01_default.bmp" "$BTN/pause.png"
chroma "$HEADSPACE/pause_02_rollover.bmp" "$BTN/pause-hover.png"
chroma "$HEADSPACE/pause_03_down.bmp" "$BTN/pause-pressed.png"

# Drawer tab buttons (below seek bar)
chroma "$HEADSPACE/EQ_01_DF.bmp" "$BTN/eq.png"
chroma "$HEADSPACE/EQ_02_RV.bmp" "$BTN/eq-hover.png"
chroma "$HEADSPACE/EQ_03_Dwn.bmp" "$BTN/eq-pressed.png"
chroma "$HEADSPACE/PL_01_DF.bmp" "$BTN/pl.png"
chroma "$HEADSPACE/PL_02_RV.bmp" "$BTN/pl-hover.png"
chroma "$HEADSPACE/PL_03_Dwn.bmp" "$BTN/pl-pressed.png"

# Drawer open/close controls on the ears
chroma "$HEADSPACE/L_drwr_open_01_default.bmp" "$BTN/eq-drawer-open.png"
chroma "$HEADSPACE/L_drwr_open_02_rollover.bmp" "$BTN/eq-drawer-open-hover.png"
chroma "$HEADSPACE/L_drwr_open_03_down.bmp" "$BTN/eq-drawer-open-pressed.png"
chroma "$HEADSPACE/L_drwr_close_01_default.bmp" "$BTN/eq-drawer-close.png"
chroma "$HEADSPACE/L_drwr_close_02_rollover.bmp" "$BTN/eq-drawer-close-hover.png"
chroma "$HEADSPACE/L_drwr_close_03_down.bmp" "$BTN/eq-drawer-close-pressed.png"
chroma "$HEADSPACE/left_X_01_default.bmp" "$BTN/eq-drawer-x.png"
chroma "$HEADSPACE/left_X_02_rollover.bmp" "$BTN/eq-drawer-x-hover.png"
chroma "$HEADSPACE/left_X_02_rollover.bmp" "$BTN/eq-drawer-x-pressed.png"
chroma "$HEADSPACE/R_drwr_open_01_default.bmp" "$BTN/pl-drawer-open.png"
chroma "$HEADSPACE/R_drwr_open_02_rollover.bmp" "$BTN/pl-drawer-open-hover.png"
chroma "$HEADSPACE/R_drwr_open_03_down.bmp" "$BTN/pl-drawer-open-pressed.png"
chroma "$HEADSPACE/R_drwr_close_01_default.bmp" "$BTN/pl-drawer-close.png"
chroma "$HEADSPACE/R_drwr_close_02_rollover.bmp" "$BTN/pl-drawer-close-hover.png"
chroma "$HEADSPACE/R_drwr_close_03_down.bmp" "$BTN/pl-drawer-close-pressed.png"
chroma "$HEADSPACE/right_X_01_default.bmp" "$BTN/pl-drawer-x.png"
chroma "$HEADSPACE/right_X_02_rollover.bmp" "$BTN/pl-drawer-x-hover.png"
chroma "$HEADSPACE/right_X_02_rollover.bmp" "$BTN/pl-drawer-x-pressed.png"

# Return to library
chroma "$HEADSPACE/themebutton_01_default.bmp" "$BTN/theme.png"
chroma "$HEADSPACE/themebutton_02_rollover.bmp" "$BTN/theme-hover.png"
chroma "$HEADSPACE/themebutton_03_down.bmp" "$BTN/theme-pressed.png"

# Visualization chooser dropdown (viz_drop)
chroma "$HEADSPACE/viz_drop.bmp" "$OUT/decorations/viz-drop.png"
chroma "$HEADSPACE/viz_drop_L_01_default.bmp" "$BTN/viz-drop-prev.png"
chroma "$HEADSPACE/viz_drop_L_02_rollover.bmp" "$BTN/viz-drop-prev-hover.png"
chroma "$HEADSPACE/viz_drop_L_03_down.bmp" "$BTN/viz-drop-prev-pressed.png"
chroma "$HEADSPACE/viz_drop_R_01_default.bmp" "$BTN/viz-drop-next.png"
chroma "$HEADSPACE/viz_drop_R_02_rollover.bmp" "$BTN/viz-drop-next-hover.png"
chroma "$HEADSPACE/viz_drop_R_03_down.bmp" "$BTN/viz-drop-next-pressed.png"
chroma "$HEADSPACE/viz_drop_X_01_default.bmp" "$BTN/viz-drop-close.png"
chroma "$HEADSPACE/viz_drop_X_02_rollover.bmp" "$BTN/viz-drop-close-hover.png"
chroma "$HEADSPACE/viz_drop_X_03_down.bmp" "$BTN/viz-drop-close-pressed.png"

# Seek bar
chroma "$HEADSPACE/progressbar.bmp" "$SLIDERS/seek-track.png"
chroma "$HEADSPACE/progressbar_foreground.bmp" "$SLIDERS/seek-fill.png"
chroma "$HEADSPACE/thumb_01_default.bmp" "$SLIDERS/seek-thumb.png"
chroma "$HEADSPACE/thumb_02_rollover.bmp" "$SLIDERS/seek-thumb-hover.png"
chroma "$HEADSPACE/thumb_03_down.bmp" "$SLIDERS/seek-thumb-pressed.png"

# EQ band sliders — WMP tile (11×15) + thumb; runtime 3-slice tiling to track height
chroma "$HEADSPACE/vertical_slider.bmp" "$SLIDERS/eq-track-tile.png"
chroma "$HEADSPACE/vertical_thumb.bmp" "$SLIDERS/eq-thumb.png"

# EQ drawer balance/volume — WMP tile (15×11) + thumb; runtime 3-slice tiling to track width
chroma "$HEADSPACE/horizontal_slider.bmp" "$SLIDERS/eq-h-track-tile.png"
chroma "$HEADSPACE/horizontal_thumb.bmp" "$SLIDERS/eq-h-thumb.png"

echo "Imported Headspace assets to $OUT"
