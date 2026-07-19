# Neon Tunnel — parameter reference

Tuning guide for the built-in **Neon Tunnel** visualizer. Edit `viz.json` for
`surfaces.default` params. Edit
`../renderers/neon-tunnel/index.js` for internal constants that control
geometry, the procedural track, camera, and particles.

After changing `viz.json` or the pack renderer, relaunch or reopen the
visualizer picker (built-in packs are scanned from disk).

---

## `viz.json` params

Opaque bag for `spiral.core.renderer.neon-tunnel`. The renderer clamps out-of-range values.

| Param | Type | Range | Default | What it does |
|-------|------|-------|---------|--------------|
| `ringCount` | int | 12–64 | 50 | Number of neon hoops in the tube. More rings = denser wormhole stack. Costs a bit more GPU (one band + fill mesh per ring). |
| `tunnelSpeed` | number | 0.2–3 | 1.2 | Base forward speed before audio multipliers. Actual speed also scales with overall energy, bass, and the internal travel multiplier (`4.6`). |
| `glow` | number | 0–2 | 0.9 | Ring brightness and opacity boost. Higher = hotter neon bands and stronger bass-driven pulse on ring scale. |
| `particleDensity` | number | 0–1 | 0.3 | Fraction of max spark count (`PARTICLE_COUNT_MAX`). `0` disables sparks entirely. |
| `bassPulse` | number | 0–2 | 0.85 | How much bass kicks ring radius, travel speed, FOV punch, and vanishing-point glow. |

**Speed feel (rough mental model):**

```
effectiveSpeed = tunnelSpeed × (0.6 + energyDrive×1.5 + bassKick×0.45×bassPulse)
travelPerFrame = effectiveSpeed × delta × 4.6 × coasterFactor
```

`energyDrive` blends overall / bass / mid / treble energy from the audio context.
`coasterFactor` speeds up on downhill track segments and eases on climbs.

---

## Internal constants (`index.js`)

Grouped by what you’re trying to change.

### Tube geometry

| Constant | Default | Effect |
|----------|---------|--------|
| `TUNNEL_RADIUS` | `2.35` | Radius of the neon rings. Larger = wider tube. |
| `TUNNEL_DEPTH` | `88` | How far rings extend along Z (world units). Deeper = longer vanishing point. |
| `RING_SPACING` | `1.7` | Distance between adjacent rings. Smaller = denser stack (more “wormhole”). |
| `RING_INNER` / `RING_OUTER` | `0.72×` / `1.06×` radius | Neon band thickness. |
| `RING_PASS_Z` | `2.5` | Z at which rings recycle past the camera. |

### Procedural track (bends, banks, hills)

The centerline is layered sine waves in arc-length `S` (world units travelled).
Every ring samples `trackOffset(travel + depth)` so bends scroll toward you.

| Constant | Default | Effect |
|----------|---------|--------|
| `CURVE_STRENGTH` | `1.05` | Master multiplier for all track offset, banking, and ring tilt. `0` = straight tube (also forced in reduced-motion mode). |
| `TRACK.ax1`, `TRACK.kx1` | `7.0`, `0.055` | Primary horizontal sway amplitude and frequency. Bigger `ax1` = wider left/right turns. |
| `TRACK.ax2`, `TRACK.kx2`, `TRACK.px2` | `3.2`, `0.091`, `1.7` | Secondary horizontal layer (stops obvious repetition). |
| `TRACK.ay1`, `TRACK.ky1`, `TRACK.py1` | `3.8`, `0.067`, `0.5` | Primary vertical hills/drops. |
| `TRACK.ay2`, `TRACK.ky2`, `TRACK.py2` | `2.4`, `0.043`, `2.3` | Secondary vertical layer. |

**Render-time track multipliers** (search `index.js` for these):

| Location | Multiplier | Effect |
|----------|------------|--------|
| `bank = -trackCurvatureX × 18 × curveAmt` | `18` | Camera roll and ring bank. Raise for harder lean into turns. |
| `camera.up` bank | `× 2.4` | Horizon roll strength. |
| `lookBend × 1.35` | `1.35` | How far ahead the camera aims into a turn (vanishing point lead). |
| Ring `rotation.y` / `rotation.x` | `× 2.2` / `× 1.9` | Ring tilt along track tangent. |
| `coasterFactor` | `1 - grade × 1.1` | Gravity-style speed on drops vs crests. |

### Camera & wormhole perspective

| Constant / expression | Default | Effect |
|---------------------|---------|--------|
| Base FOV | `70` | Wide-angle portal look. |
| `speedNorm × 16` | `16` | FOV stretch at high speed (dolly-zoom warp). |
| Drop FOV swell | `grade × 18` | Extra FOV when plunging downhill. |
| `LOOK_AHEAD` | `36` | Distance (world units) the camera looks down the track. |
| Fog density | `0.019` | `FogExp2` coefficient. Lower = clearer deep tunnel; higher = moodier fade. |
| Camera far plane | `180` | Must exceed `TUNNEL_DEPTH` so distant rings aren’t clipped. |

### Particles (sparks)

| Constant | Default | Effect |
|----------|---------|--------|
| `PARTICLE_COUNT_MAX` | `560` | Max sparks when `particleDensity = 1`. |
| Spark size (`PointsMaterial.size`) | `0.028` | Point sprite size. Smaller = less “square” read at distance. |
| Spark opacity base | `0.45` | Base alpha; treble/energy add on top. |
| Radial spread | `0.2–1.45×` `TUNNEL_RADIUS` | Min/max radius; wider = less “cone” clustering. Uses soft round texture, not square points. |
| Particle travel multiplier | `× 3.6` | How fast sparks stream past relative to rings. |

### Vanishing point glow

Small sphere at the far end of the tube (`buildVanishingGlow`). Pulses with bass.
Opacity ~`0.32 + bass×glow`; scale bumps with `bassPulse`. Remove entirely in
code if you prefer a pure ring stack with no far glow.

### Ring opacity falloff

`ringOpacityForZ` fades rings near the camera and at the far end using
`TUNNEL_DEPTH`-relative distances (`farStart = depth × 0.72`, `farFade = depth × 0.26`).

---

## Quick recipes

**More aggressive coaster:** raise `CURVE_STRENGTH`, `TRACK.ax1` / `ay1`, bank
multiplier (`18`), and `camera.up` bank (`2.4`).

**Denser wormhole:** lower `RING_SPACING`, raise `ringCount` in `viz.json`.

**Faster top end:** raise `tunnelSpeed`, energy multiplier (`1.5`), or travel
multiplier (`4.6`) in the render loop.

**Calmer sparks:** lower `particleDensity` or `PARTICLE_COUNT_MAX`; shrink
spark `size` and radial max spread.

**Straighter ride:** set `CURVE_STRENGTH` to `0` (or use reduced-motion flag).
