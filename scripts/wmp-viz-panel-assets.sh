#!/usr/bin/env bash
# Shared helpers for WMP viz panel mask + frame PNGs (vid_bkgd / head.bmp pattern).
# Source from skin import scripts: . "$(dirname "$0")/wmp-viz-panel-assets.sh"

# Count white-ish pixels in a bitmap (returns count via stdout).
_wmp_white_pixel_count() {
  ffmpeg -loglevel error -i "$1" -vf "format=gray" -f rawvideo - 2>/dev/null \
    | python3 -c "
import sys
data = sys.stdin.buffer.read()
print(sum(1 for b in data if b > 200))
"
}

# Classic vid_bkgd.bmp: white hole (clippingColor) + colored frame border.
wmp_viz_assets_from_vid_bkgd() {
  local src="$1"
  local frame_out="$2"
  local mask_out="$3"
  local white='if(gt(r(X,Y)+g(X,Y)+b(X,Y),600)'
  ffmpeg -y -loglevel error -i "$src" \
    -vf "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${white},0,255)'" \
    "$frame_out"
  ffmpeg -y -loglevel error -i "$src" \
    -vf "format=rgba,geq=r='255':g='255':b='255':a='${white},255,0)'" \
    "$mask_out"
}

# head.bmp forehead: magenta hole + green inner bezel (Headspace-style).
wmp_viz_assets_from_head_crop() {
  local head="$1"
  local crop_x="$2"
  local crop_y="$3"
  local crop_w="$4"
  local crop_h="$5"
  local frame_out="$6"
  local mask_out="$7"
  local crop="crop=${crop_w}:${crop_h}:${crop_x}:${crop_y}"
  local mag='if(gt(r(X,Y),200)*lt(g(X,Y),40)*gt(b(X,Y),200),255,0)'
  ffmpeg -y -loglevel error -i "$head" \
    -vf "${crop},format=rgba,geq=r='255':g='255':b='255':a='${mag}'" \
    "$mask_out"
  ffmpeg -y -loglevel error -i "$head" \
    -vf "${crop},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(g(X,Y),80)*gt(g(X,Y),r(X,Y))*(1-${mag}),255,0)'" \
    "$frame_out"
}

# Prefer vid_bkgd when it has a meaningful white hole; else derive from head crop.
wmp_viz_panel_assets() {
  local head_bmp="$1"
  local crop_x="$2"
  local crop_y="$3"
  local crop_w="$4"
  local crop_h="$5"
  local vid_bkgd="$6"
  local frame_out="$7"
  local mask_out="$8"
  local total=$((crop_w * crop_h))
  local white_count=0
  if [[ -f "$vid_bkgd" ]]; then
    white_count=$(_wmp_white_pixel_count "$vid_bkgd")
  fi
  if [[ "$white_count" -gt $((total / 20)) ]]; then
    wmp_viz_assets_from_vid_bkgd "$vid_bkgd" "$frame_out" "$mask_out"
  else
    wmp_viz_assets_from_head_crop "$head_bmp" "$crop_x" "$crop_y" "$crop_w" "$crop_h" "$frame_out" "$mask_out"
  fi
}
