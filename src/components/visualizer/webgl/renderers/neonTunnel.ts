/**
 * Neon tunnel WebGL renderer — tuning reference:
 * `src-tauri/visualizers/builtin/neon-tunnel/PARAMS.md`
 */
import * as THREE from "three";
import {
  idleWaveValue,
  logBinIndex,
  shouldDrawIdle,
} from "../../rendererUtils";
import { paletteToThreeColors } from "../colorUtils";
import type {
  WebGLRenderArgs,
  WebGLRendererHost,
  WebGLRendererModule,
} from "../types";

type SpeedMode = "coaster" | "audio";

interface NeonTunnelParams {
  ringCount?: number;
  tunnelSpeed?: number;
  glow?: number;
  particleDensity?: number;
  bassPulse?: number;
  /** "audio" (default): music dictates travel speed, coaster gravity off.
   *  "coaster": original ride feel — drops accelerate, climbs ease off. */
  speedMode?: SpeedMode;
}

const TUNNEL_RADIUS = 2.35;
const TUNNEL_DEPTH = 88;
const RING_SPACING = 1.7;
const RING_INNER = TUNNEL_RADIUS * 0.72;
const RING_OUTER = TUNNEL_RADIUS * 1.06;
const RING_PASS_Z = 2.5;
/** Master track bend/bank multiplier — see PARAMS.md */
const CURVE_STRENGTH = 1.05;
/** Hard ceilings on per-ring tilt so discs never rotate edge-on at sharp
 *  turns/grades. Gentle turns are unaffected (tanh ≈ identity near 0); only
 *  the peaks clamp. ~34° yaw, ~26° pitch. */
const MAX_RING_TILT_Y = 0.6;
const MAX_RING_TILT_X = 0.45;
/** Speed coupling gains — see PARAMS.md. `base` is the idle floor, `energy`
 *  scales the smoothed spectral drive, `bass` the per-kick punch. Audio mode
 *  couples harder so travel tracks the music; coaster mode is gentler and
 *  hands the rest to gravity. */
const SPEED_AUDIO = { base: 0.3, energy: 3.4, bass: 0.9 };
const SPEED_COASTER = { base: 0.6, energy: 1.5, bass: 0.45 };
/** Coaster-mode gravity: how hard grade modulates travel speed (drops speed
 *  up, climbs slow down). Only applied in "coaster" mode. */
const COASTER_GRAVITY = 1.1;
/** Spark field cap when particleDensity = 1 */
const PARTICLE_COUNT_MAX = 560;
/** Point sprite size (world units); smaller reads less “square” at distance */
const PARTICLE_SIZE = 0.028;
/** Radial placement: fraction of TUNNEL_RADIUS (wider = less cone clustering) */
const PARTICLE_RADIUS_MIN = 0.2;
const PARTICLE_RADIUS_MAX = 1.45;

interface ResolvedParams {
  ringCount: number;
  tunnelSpeed: number;
  glow: number;
  particleDensity: number;
  bassPulse: number;
  speedMode: SpeedMode;
}

interface RingState {
  group: THREE.Group;
  band: THREE.Mesh;
  fill: THREE.Mesh;
  baseColor: THREE.Color;
}

function resolveParams(params: Record<string, unknown>): ResolvedParams {
  const p = params as NeonTunnelParams;
  return {
    ringCount: clamp(Math.round(p.ringCount ?? 36), 12, 64),
    tunnelSpeed: clamp(p.tunnelSpeed ?? 1.2, 0.2, 3),
    glow: clamp(p.glow ?? 1, 0, 2),
    particleDensity: clamp(p.particleDensity ?? 0.65, 0, 1),
    bassPulse: clamp(p.bassPulse ?? 1, 0, 2),
    speedMode: p.speedMode === "coaster" ? "coaster" : "audio",
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Soft-saturating tilt: ≈ raw near 0, asymptotes to ±max. */
function softTilt(raw: number, max: number): number {
  return max * Math.tanh(raw / max);
}

/** Soft round sprite so sparks don't read as square GL points. */
function createSparkTexture(): THREE.CanvasTexture {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/** Uniform disk sample: sqrt(u) spreads points across the annulus, not a tight ring. */
function sampleParticleRadius(): number {
  const t = Math.sqrt(Math.random());
  const min = TUNNEL_RADIUS * PARTICLE_RADIUS_MIN;
  const max = TUNNEL_RADIUS * PARTICLE_RADIUS_MAX;
  return min + t * (max - min);
}

function resolveBins(args: WebGLRenderArgs, ringCount: number): number[] {
  const { context, remoteBins, state } = args;
  const source = remoteBins ?? context.audio.bins;

  if (!shouldDrawIdle(context) && source.length > 0) {
    const bins: number[] = new Array(ringCount);
    for (let i = 0; i < ringCount; i++) {
      const idx = logBinIndex(i, ringCount, source.length);
      bins[i] = (source[idx] ?? 0) / 255;
    }
    return bins;
  }

  const phase = state.idlePhaseRef.current;
  state.idlePhaseRef.current += 0.016;
  return Array.from({ length: ringCount }, (_, i) =>
    idleWaveValue(phase, i, ringCount),
  );
}

/** Wrap ring Z so travel moves hoops toward the camera (+Z), then recycle ahead (−Z). */
function wrapRingZ(z: number, span: number): number {
  let wrapped = z;
  while (wrapped > RING_PASS_Z) wrapped -= span;
  while (wrapped <= -span + RING_PASS_Z) wrapped += span;
  return wrapped;
}

function ringOpacityForZ(
  z: number,
  energy: number,
  glowBoost: number,
  span: number,
): number {
  const ahead = Math.max(0, -z);
  const hot = 0.65 + energy * 0.45;
  // Fade in over the last stretch before the recycle point so rings never
  // pop in at full brightness when they wrap. Tie this to the actual ring
  // span (ringCount * RING_SPACING), NOT TUNNEL_DEPTH — with few rings the
  // wrap distance is shorter than TUNNEL_DEPTH, the depth-based fade never
  // triggers, and every recycle reads as a strobe when idle.
  const recycleAhead = span - RING_PASS_Z;
  const farFade = Math.min(14, span * 0.28);
  const farStart = recycleAhead - farFade;
  if (z > RING_PASS_Z) return 0;
  if (ahead < 0.8) return (ahead / 0.8) * 0.3 * hot * glowBoost;
  if (ahead > farStart)
    return (
      Math.max(0, 1 - (ahead - farStart) / farFade) * 0.6 * hot * glowBoost
    );
  if (ahead < 8) return (0.42 + (ahead / 8) * 0.35) * hot * glowBoost;
  return (0.55 + energy * 0.35) * glowBoost;
}

// --- Procedural roller-coaster track ------------------------------------
// The centerline lateral offset is a function of the absolute arc position S
// (world units travelled). Because every ring/particle samples the curve at
// `travel + itsDepth`, the bends are baked into the track and scroll toward
// the camera as we move — giving real optical flow (near walls sweep, the
// vanishing point swings) instead of the whole tube sliding rigidly.
// Layered, incommensurate sines keep the ride from obviously repeating.
// X = left/right banked turns, Y = hills and drops.
const TRACK = {
  ax1: 7.0,
  kx1: 0.055,
  ax2: 3.2,
  kx2: 0.091,
  px2: 1.7,
  ay1: 3.8,
  ky1: 0.067,
  py1: 0.5,
  ay2: 2.4,
  ky2: 0.043,
  py2: 2.3,
};

interface TrackSample {
  x: number;
  y: number;
}

function trackOffset(s: number): TrackSample {
  return {
    x:
      TRACK.ax1 * Math.sin(s * TRACK.kx1) +
      TRACK.ax2 * Math.sin(s * TRACK.kx2 + TRACK.px2),
    y:
      TRACK.ay1 * Math.sin(s * TRACK.ky1 + TRACK.py1) +
      TRACK.ay2 * Math.sin(s * TRACK.ky2 + TRACK.py2),
  };
}

/** First derivative of the centerline → track tangent (slope). */
function trackTangent(s: number): TrackSample {
  return {
    x:
      TRACK.ax1 * TRACK.kx1 * Math.cos(s * TRACK.kx1) +
      TRACK.ax2 * TRACK.kx2 * Math.cos(s * TRACK.kx2 + TRACK.px2),
    y:
      TRACK.ay1 * TRACK.ky1 * Math.cos(s * TRACK.ky1 + TRACK.py1) +
      TRACK.ay2 * TRACK.ky2 * Math.cos(s * TRACK.ky2 + TRACK.py2),
  };
}

/** Horizontal curvature (second derivative) → how hard to bank into a turn. */
function trackCurvatureX(s: number): number {
  return (
    -TRACK.ax1 * TRACK.kx1 * TRACK.kx1 * Math.sin(s * TRACK.kx1) -
    TRACK.ax2 * TRACK.kx2 * TRACK.kx2 * Math.sin(s * TRACK.kx2 + TRACK.px2)
  );
}

function depthGradientColors(
  base: THREE.Color,
  z: number,
  palette: THREE.Color[],
): { band: THREE.Color; fill: THREE.Color } {
  const ahead = Math.max(0, -z);
  const depthT = clamp(ahead / (TUNNEL_DEPTH * 0.62), 0, 1);
  const nearTint = palette[0] ?? base;
  const farTint = (palette[palette.length - 1] ?? base)
    .clone()
    .lerp(new THREE.Color(0x0a0820), 0.45);

  const band = base
    .clone()
    .lerp(farTint, depthT * 0.55)
    .lerp(nearTint, (1 - depthT) * 0.28);
  const fill = band.clone().lerp(new THREE.Color(0x06061a), 0.42);
  return { band, fill };
}

function applyRadialVertexColors(
  geometry: THREE.BufferGeometry,
  innerColor: THREE.Color,
  outerColor: THREE.Color,
  innerRadius: number,
  outerRadius: number,
): void {
  const position = geometry.attributes.position;
  if (!position) return;

  const colors = new Float32Array(position.count * 3);
  const scratch = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const r = Math.hypot(x, y);
    const t = clamp((r - innerRadius) / (outerRadius - innerRadius), 0, 1);
    scratch.copy(innerColor).lerp(outerColor, t ** 0.75);
    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

export function createNeonTunnelRenderer(): WebGLRendererModule {
  let host: WebGLRendererHost | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let rings: RingState[] = [];
  let particles: THREE.Points | null = null;
  let sparkTexture: THREE.CanvasTexture | null = null;
  let vanishingGlow: THREE.Mesh | null = null;
  let particlePositions: Float32Array | null = null;
  let particleLocalX: Float32Array | null = null;
  let particleLocalY: Float32Array | null = null;
  let particleSpeeds: Float32Array | null = null;
  let paletteColors: THREE.Color[] = [];
  let resolved: ResolvedParams = resolveParams({});
  let travel = 0;
  let sceneBuilt = false;
  let energySmooth = 0;
  let bassKick = 0;
  let paletteSignature = "";

  function disposeRings(): void {
    for (const { group, band, fill } of rings) {
      band.geometry.dispose();
      (band.material as THREE.Material).dispose();
      fill.geometry.dispose();
      (fill.material as THREE.Material).dispose();
      scene?.remove(group);
    }
    rings = [];
  }

  function buildRings(): void {
    if (!scene) return;
    disposeRings();

    for (let i = 0; i < resolved.ringCount; i++) {
      const baseColor =
        paletteColors[i % paletteColors.length]?.clone() ??
        new THREE.Color("#7c6af7");
      const group = new THREE.Group();
      const outerBright = baseColor
        .clone()
        .lerp(new THREE.Color(0xffffff), 0.22);
      const innerSoft = baseColor.clone().lerp(new THREE.Color(0x06061a), 0.35);

      const bandGeo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 64);
      applyRadialVertexColors(
        bandGeo,
        innerSoft,
        outerBright,
        RING_INNER,
        RING_OUTER,
      );
      const band = new THREE.Mesh(
        bandGeo,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.82,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }),
      );

      const fillGeo = new THREE.CircleGeometry(RING_INNER * 0.98, 48);
      applyRadialVertexColors(
        fillGeo,
        innerSoft.clone().lerp(new THREE.Color(0x06061a), 0.25),
        innerSoft,
        0,
        RING_INNER,
      );
      const fill = new THREE.Mesh(
        fillGeo,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.38,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }),
      );

      group.add(band);
      group.add(fill);
      group.position.z = wrapRingZ(
        -i * RING_SPACING,
        resolved.ringCount * RING_SPACING,
      );
      rings.push({ group, band, fill, baseColor });
      scene.add(group);
    }

    travel = 0;
  }

  function buildParticles(): void {
    if (!scene) return;

    if (particles) {
      particles.geometry.dispose();
      (particles.material as THREE.Material).dispose();
      scene.remove(particles);
      particles = null;
    }

    const count = Math.round(PARTICLE_COUNT_MAX * resolved.particleDensity);
    if (count <= 0) return;

    particlePositions = new Float32Array(count * 3);
    particleLocalX = new Float32Array(count);
    particleLocalY = new Float32Array(count);
    particleSpeeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = sampleParticleRadius();
      particleLocalX[i] = Math.cos(angle) * radius;
      particleLocalY[i] = Math.sin(angle) * radius;
      particlePositions[i * 3] = particleLocalX[i]!;
      particlePositions[i * 3 + 1] = particleLocalY[i]!;
      particlePositions[i * 3 + 2] = -(4 + Math.random() * TUNNEL_DEPTH);
      particleSpeeds[i] = 0.25 + Math.random() * 0.7;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(particlePositions, 3),
    );

    const sparkTint = (paletteColors[0] ?? new THREE.Color("#c4baff"))
      .clone()
      .lerp(new THREE.Color(0xffffff), 0.55);

    if (!sparkTexture) sparkTexture = createSparkTexture();

    particles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        map: sparkTexture,
        color: sparkTint,
        size: PARTICLE_SIZE,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    scene.add(particles);
  }

  function buildVanishingGlow(): void {
    if (!scene) return;

    if (vanishingGlow) {
      vanishingGlow.geometry.dispose();
      (vanishingGlow.material as THREE.Material).dispose();
      scene.remove(vanishingGlow);
    }

    const color = paletteColors[0] ?? new THREE.Color("#9b8fff");
    vanishingGlow = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 24, 24),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    vanishingGlow.position.z = -TUNNEL_DEPTH * 0.72;
    scene.add(vanishingGlow);
  }

  function rebuildScene(palette: readonly string[]): void {
    paletteColors = paletteToThreeColors(palette, resolved.ringCount);
    buildRings();
    buildParticles();
    buildVanishingGlow();
  }

  function applyPalette(fresh: THREE.Color[]): void {
    paletteColors = fresh;
    rings.forEach(({ baseColor }, i) => {
      const color = fresh[i % fresh.length];
      if (color) baseColor.copy(color);
    });
    if (vanishingGlow && fresh[0]) {
      (vanishingGlow.material as THREE.MeshBasicMaterial).color.copy(fresh[0]);
    }
    if (particles && fresh[0]) {
      (particles.material as THREE.PointsMaterial).color
        .copy(fresh[0])
        .lerp(new THREE.Color(0xffffff), 0.55);
    }
  }

  return {
    init(webglHost) {
      host = webglHost;
      scene = new THREE.Scene();
      const fogNear = new THREE.Color(0x12102a);
      scene.background = fogNear.clone();
      // Thinner fog so the tube recedes into a deep vanishing point rather
      // than washing out a few rings in — key to the wormhole perspective.
      scene.fog = new THREE.FogExp2(fogNear.getHex(), 0.019);

      camera = new THREE.PerspectiveCamera(72, 1, 0.1, 180);
      camera.position.set(0, 0, 0);
    },

    resize(width, height, dpr) {
      if (!host || !camera) return;
      host.width = width;
      host.height = height;
      host.dpr = dpr;
      host.renderer.setPixelRatio(dpr);
      host.renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    },

    render(args, params, deltaMs) {
      if (!host || !scene || !camera) return;

      const next = resolveParams(params);
      const needsRebuild =
        !sceneBuilt ||
        next.ringCount !== resolved.ringCount ||
        Math.abs(next.particleDensity - resolved.particleDensity) > 0.05;

      if (needsRebuild) {
        resolved = next;
        rebuildScene(args.context.colors.palette);
        paletteSignature = args.context.colors.palette.join("|");
        sceneBuilt = true;
      } else {
        resolved = next;
      }

      const palette = args.context.colors.palette;
      if (palette.length > 0) {
        const signature = palette.join("|");
        if (signature !== paletteSignature) {
          paletteSignature = signature;
          applyPalette(paletteToThreeColors(palette, resolved.ringCount));
        }
      }

      const motionScale = args.context.flags.reducedMotion ? 0.25 : 1;
      const delta = (deltaMs / 1000) * motionScale;
      const bins = resolveBins(args, resolved.ringCount);
      const audio = args.context.audio;

      energySmooth = energySmooth * 0.85 + audio.overallEnergy * 0.15;
      bassKick = bassKick * 0.82 + audio.bassEnergy * 0.18;

      const energyDrive =
        energySmooth * 0.45 +
        audio.bassEnergy * 0.32 +
        audio.midEnergy * 0.15 +
        audio.trebleEnergy * 0.08;

      const curveAmt = args.context.flags.reducedMotion ? 0 : CURVE_STRENGTH;
      // Tangent slope at the camera: +y = climbing, -y = plunging. Still feeds
      // the camera FOV/look-ahead below in BOTH modes, so audio mode keeps
      // looking like a coaster even though gravity no longer drives the speed.
      const grade = trackTangent(travel).y * curveAmt;

      // Speed source. Audio mode lets the music dictate travel and drops the
      // coaster gravity (coasterFactor = 1); coaster mode is the original ride.
      let speed: number;
      let coasterFactor: number;
      if (resolved.speedMode === "audio") {
        speed =
          resolved.tunnelSpeed *
          (SPEED_AUDIO.base +
            energyDrive * SPEED_AUDIO.energy +
            bassKick * SPEED_AUDIO.bass * resolved.bassPulse);
        coasterFactor = 1;
      } else {
        speed =
          resolved.tunnelSpeed *
          (SPEED_COASTER.base +
            energyDrive * SPEED_COASTER.energy +
            bassKick * SPEED_COASTER.bass * resolved.bassPulse);
        // Coaster gravity: plunging down a drop accelerates, cresting eases off.
        coasterFactor = 1 - grade * COASTER_GRAVITY;
      }
      travel += speed * delta * 4.6 * coasterFactor;

      // Normalized speed drives the warp: faster travel widens the FOV and
      // stretches the tube, the classic dolly-zoom wormhole pull.
      const speedNorm = clamp((speed - 0.7) / 2.6, 0, 1);

      // Sample the track once per frame so rings/particles/camera agree.
      const camOff = trackOffset(travel);
      const bank = clamp(-trackCurvatureX(travel) * 18 * curveAmt, -0.72, 0.72);

      const offsetAtDepth = (depth: number): TrackSample => {
        const sample = trackOffset(travel + depth);
        return {
          x: (sample.x - camOff.x) * curveAmt,
          y: (sample.y - camOff.y) * curveAmt,
        };
      };

      const glowBoost = 0.55 + resolved.glow * 0.35;
      const span = resolved.ringCount * RING_SPACING;

      rings.forEach(({ group, band, fill, baseColor }, i) => {
        const bin = bins[i] ?? 0.1;
        const energy = 0.4 + bin * 0.6;

        const z = wrapRingZ(-i * RING_SPACING + travel, span);
        const bend = offsetAtDepth(-z);
        group.position.set(bend.x, bend.y, z);

        const radiusPulse =
          1 + bin * 0.09 * glowBoost + bassKick * 0.04 * resolved.bassPulse;
        group.scale.set(radiusPulse, radiusPulse, 1);

        const gradient = depthGradientColors(baseColor, z, paletteColors);
        (band.material as THREE.MeshBasicMaterial).color.copy(gradient.band);
        (fill.material as THREE.MeshBasicMaterial).color.copy(gradient.fill);

        const bandOpacity = ringOpacityForZ(z, energy, glowBoost, span);
        (band.material as THREE.MeshBasicMaterial).opacity =
          bandOpacity * (0.78 + bin * 0.18);
        (fill.material as THREE.MeshBasicMaterial).opacity =
          bandOpacity * (0.28 + bin * 0.22 + energy * 0.12);

        // Tilt rings to face along the local track tangent so the tube reads
        // as a banked, curving chute rather than flat discs sliding sideways.
        // Soft-saturate so gentle turns are unchanged but sharp turns/grades
        // can't push a disc edge-on (which lines consecutive rings into a
        // flat sheet).
        const tangent = trackTangent(travel - z);
        group.rotation.z = bank * 0.55;
        group.rotation.y = softTilt(
          tangent.x * curveAmt * 2.2,
          MAX_RING_TILT_Y,
        );
        group.rotation.x = softTilt(
          tangent.y * curveAmt * 1.9,
          MAX_RING_TILT_X,
        );
      });

      if (
        particles &&
        particlePositions &&
        particleSpeeds &&
        particleLocalX &&
        particleLocalY
      ) {
        const positions = particles.geometry.attributes.position;
        const count = particleSpeeds.length;
        const particleBoost = 1 + audio.trebleEnergy * 0.8 + energySmooth * 0.4;
        for (let i = 0; i < count; i++) {
          let z =
            particlePositions[i * 3 + 2]! +
            speed * particleSpeeds[i]! * delta * particleBoost * 3.6;
          if (z > RING_PASS_Z) {
            z = -(6 + Math.random() * TUNNEL_DEPTH);
            const angle = Math.random() * Math.PI * 2;
            const radius = sampleParticleRadius();
            particleLocalX[i] = Math.cos(angle) * radius;
            particleLocalY[i] = Math.sin(angle) * radius;
          }
          const pBend = offsetAtDepth(-z);
          particlePositions[i * 3] = particleLocalX[i]! + pBend.x;
          particlePositions[i * 3 + 1] = particleLocalY[i]! + pBend.y;
          particlePositions[i * 3 + 2] = z;
        }
        positions.needsUpdate = true;

        const particleMat = particles.material as THREE.PointsMaterial;
        particleMat.opacity =
          0.38 + audio.trebleEnergy * 0.32 + energySmooth * 0.08;
      }

      if (vanishingGlow) {
        const bassScale =
          1 + audio.bassEnergy * 0.3 * resolved.bassPulse + bassKick * 0.1;
        vanishingGlow.scale.setScalar(bassScale);
        const farTint =
          paletteColors[paletteColors.length - 1] ?? paletteColors[0];
        if (farTint) {
          (vanishingGlow.material as THREE.MeshBasicMaterial).color.copy(
            farTint,
          );
        }
        (vanishingGlow.material as THREE.MeshBasicMaterial).opacity =
          0.32 + audio.bassEnergy * 0.2 * glowBoost + energySmooth * 0.1;
        const glowZ = -TUNNEL_DEPTH * 0.72;
        const glowBend = offsetAtDepth(TUNNEL_DEPTH * 0.72);
        vanishingGlow.position.set(glowBend.x, glowBend.y, glowZ);
      }

      // Aim the camera down the curved track: look at the centerline a fixed
      // distance ahead. Slightly overshoot the offset so the vanishing point
      // leads into the turn, which sells the "going around a bend" feel.
      const LOOK_AHEAD = 36;
      const lookBend = offsetAtDepth(LOOK_AHEAD);
      const lookX = lookBend.x * 1.35 + bassKick * 0.08;
      const lookY = lookBend.y * 1.35;
      camera.position.set(0, 0, 0);
      // Roll the horizon to lean into turns.
      camera.up.set(-bank * 2.4, 1, 0).normalize();
      // Wide base FOV + speed-coupled warp stretch + drop swell pull you
      // through the portal; bass adds a subtle punch.
      camera.fov =
        70 + speedNorm * 16 + Math.max(0, -grade) * 18 + bassKick * 1.4;
      camera.updateProjectionMatrix();
      camera.lookAt(lookX, lookY, -LOOK_AHEAD);

      host.renderer.render(scene, camera);
    },

    dispose() {
      disposeRings();
      if (particles) {
        particles.geometry.dispose();
        (particles.material as THREE.Material).dispose();
        scene?.remove(particles);
        particles = null;
      }
      sparkTexture?.dispose();
      sparkTexture = null;
      if (vanishingGlow) {
        vanishingGlow.geometry.dispose();
        (vanishingGlow.material as THREE.Material).dispose();
        scene?.remove(vanishingGlow);
        vanishingGlow = null;
      }
      scene = null;
      camera = null;
      host = null;
    },
  };
}
