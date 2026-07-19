/**
 * Neon Tunnel VizRenderer — pack-shipped WebGL/three.js module.
 * Contract: export create({ canvas, THREE }) → { render(frame, params), resize, dispose }
 * Tuning notes: ../visualizers/neon-tunnel/PARAMS.md (same pack)
 */

const IDLE_WAVE_FREQ = 180;
const IDLE_WAVE_SPREAD = 0.22;
const IDLE_WAVE_AMP = 0.22;
const IDLE_WAVE_BASE = 0.1;

const TUNNEL_RADIUS = 2.35;
const TUNNEL_DEPTH = 88;
const RING_SPACING = 1.7;
const RING_INNER = TUNNEL_RADIUS * 0.72;
const RING_OUTER = TUNNEL_RADIUS * 1.06;
const RING_PASS_Z = 2.5;
const CURVE_STRENGTH = 1.05;
const MAX_RING_TILT_Y = 0.6;
const MAX_RING_TILT_X = 0.45;
const SPEED_AUDIO = { base: 0.3, energy: 3.4, bass: 0.9 };
const SPEED_COASTER = { base: 0.6, energy: 1.5, bass: 0.45 };
const COASTER_GRAVITY = 1.1;
const PARTICLE_COUNT_MAX = 560;
const PARTICLE_SIZE = 0.028;
const PARTICLE_RADIUS_MIN = 0.2;
const PARTICLE_RADIUS_MAX = 1.45;

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function softTilt(raw, max) {
  return max * Math.tanh(raw / max);
}

function idleWaveValue(phase, index, count) {
  const spread = (index / Math.max(count - 1, 1)) * IDLE_WAVE_SPREAD * count;
  return (
    (Math.sin(phase * IDLE_WAVE_FREQ + spread) + 1) * 0.5 * IDLE_WAVE_AMP +
    IDLE_WAVE_BASE
  );
}

function logBinIndex(index, count, dataLength) {
  if (count <= 1) return 0;
  const t = index / (count - 1);
  const logT = Math.pow(t, 2.2);
  return Math.min(dataLength - 1, Math.floor(logT * (dataLength - 1)));
}

function lerpColor(a, b, t) {
  const parse = (hex) => {
    const h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function paletteColorAt(colors, index, count) {
  if (!colors || colors.length === 0) return "#888888";
  if (count <= 1) return colors[0];
  const t = index / (count - 1);
  const colorIndex = t * (colors.length - 1);
  const idx = Math.floor(colorIndex);
  const frac = colorIndex - idx;
  const c1 = colors[idx] ?? colors[0];
  const c2 = colors[Math.min(idx + 1, colors.length - 1)] ?? c1;
  return lerpColor(c1, c2, frac);
}

function paletteToThreeColors(THREE, palette, count) {
  if (!palette || palette.length === 0) {
    return Array.from({ length: count }, () => new THREE.Color("#888888"));
  }
  return Array.from({ length: count }, (_, i) =>
    new THREE.Color(paletteColorAt(palette, i, count)),
  );
}

function resolveParams(params) {
  const p = params ?? {};
  return {
    ringCount: clamp(Math.round(p.ringCount ?? 36), 12, 64),
    tunnelSpeed: clamp(p.tunnelSpeed ?? 1.2, 0.2, 3),
    glow: clamp(p.glow ?? 1, 0, 2),
    particleDensity: clamp(p.particleDensity ?? 0.65, 0, 1),
    bassPulse: clamp(p.bassPulse ?? 1, 0, 2),
    speedMode: p.speedMode === "coaster" ? "coaster" : "audio",
  };
}

function createSparkTexture(THREE) {
  const size = 32;
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(size, size)
      : document.createElement("canvas");
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

function sampleParticleRadius() {
  const t = Math.sqrt(Math.random());
  const min = TUNNEL_RADIUS * PARTICLE_RADIUS_MIN;
  const max = TUNNEL_RADIUS * PARTICLE_RADIUS_MAX;
  return min + t * (max - min);
}

function resolveBins(frame, ringCount) {
  const source = frame.audio.frequencies;
  if (frame.audio.isPlaying && source.length > 0) {
    const bins = new Array(ringCount);
    for (let i = 0; i < ringCount; i++) {
      const idx = logBinIndex(i, ringCount, source.length);
      bins[i] = source[idx] ?? 0;
    }
    return bins;
  }
  const phase = frame.time.elapsedMs * 0.001;
  return Array.from({ length: ringCount }, (_, i) =>
    idleWaveValue(phase, i, ringCount),
  );
}

function wrapRingZ(z, span) {
  let wrapped = z;
  while (wrapped > RING_PASS_Z) wrapped -= span;
  while (wrapped <= -span + RING_PASS_Z) wrapped += span;
  return wrapped;
}

function ringOpacityForZ(z, energy, glowBoost, span) {
  const ahead = Math.max(0, -z);
  const hot = 0.65 + energy * 0.45;
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

function trackOffset(s) {
  return {
    x:
      TRACK.ax1 * Math.sin(s * TRACK.kx1) +
      TRACK.ax2 * Math.sin(s * TRACK.kx2 + TRACK.px2),
    y:
      TRACK.ay1 * Math.sin(s * TRACK.ky1 + TRACK.py1) +
      TRACK.ay2 * Math.sin(s * TRACK.ky2 + TRACK.py2),
  };
}

function trackTangent(s) {
  return {
    x:
      TRACK.ax1 * TRACK.kx1 * Math.cos(s * TRACK.kx1) +
      TRACK.ax2 * TRACK.kx2 * Math.cos(s * TRACK.kx2 + TRACK.px2),
    y:
      TRACK.ay1 * TRACK.ky1 * Math.cos(s * TRACK.ky1 + TRACK.py1) +
      TRACK.ay2 * TRACK.ky2 * Math.cos(s * TRACK.ky2 + TRACK.py2),
  };
}

function trackCurvatureX(s) {
  return (
    -TRACK.ax1 * TRACK.kx1 * TRACK.kx1 * Math.sin(s * TRACK.kx1) -
    TRACK.ax2 * TRACK.kx2 * TRACK.kx2 * Math.sin(s * TRACK.kx2 + TRACK.px2)
  );
}

function depthGradientColors(THREE, base, z, palette) {
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
  THREE,
  geometry,
  innerColor,
  outerColor,
  innerRadius,
  outerRadius,
) {
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

export function create({ canvas, THREE }) {
  const glRenderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
    // Needed so transferToImageBitmap captures the frame in the sandbox worker.
    preserveDrawingBuffer: true,
  });
  glRenderer.setClearColor(0x000000, 0);

  let scene = new THREE.Scene();
  const fogNear = new THREE.Color(0x12102a);
  scene.background = fogNear.clone();
  scene.fog = new THREE.FogExp2(fogNear.getHex(), 0.019);

  let camera = new THREE.PerspectiveCamera(72, 1, 0.1, 180);
  camera.position.set(0, 0, 0);

  let rings = [];
  let particles = null;
  let sparkTexture = null;
  let vanishingGlow = null;
  let particlePositions = null;
  let particleLocalX = null;
  let particleLocalY = null;
  let particleSpeeds = null;
  let paletteColors = [];
  let resolved = resolveParams({});
  let travel = 0;
  let sceneBuilt = false;
  let energySmooth = 0;
  let bassKick = 0;
  let paletteSignature = "";

  function disposeRings() {
    for (const { group, band, fill } of rings) {
      band.geometry.dispose();
      band.material.dispose();
      fill.geometry.dispose();
      fill.material.dispose();
      scene?.remove(group);
    }
    rings = [];
  }

  function buildRings() {
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
        THREE,
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
        THREE,
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

  function buildParticles() {
    if (!scene) return;

    if (particles) {
      particles.geometry.dispose();
      particles.material.dispose();
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
      particlePositions[i * 3] = particleLocalX[i];
      particlePositions[i * 3 + 1] = particleLocalY[i];
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

    if (!sparkTexture) sparkTexture = createSparkTexture(THREE);

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

  function buildVanishingGlow() {
    if (!scene) return;

    if (vanishingGlow) {
      vanishingGlow.geometry.dispose();
      vanishingGlow.material.dispose();
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

  function rebuildScene(palette) {
    paletteColors = paletteToThreeColors(THREE, palette, resolved.ringCount);
    buildRings();
    buildParticles();
    buildVanishingGlow();
  }

  function applyPalette(fresh) {
    paletteColors = fresh;
    rings.forEach(({ baseColor }, i) => {
      const color = fresh[i % fresh.length];
      if (color) baseColor.copy(color);
    });
    if (vanishingGlow && fresh[0]) {
      vanishingGlow.material.color.copy(fresh[0]);
    }
    if (particles && fresh[0]) {
      particles.material.color.copy(fresh[0]).lerp(new THREE.Color(0xffffff), 0.55);
    }
  }

  return {
    resize(width, height, dpr) {
      if (!camera) return;
      glRenderer.setPixelRatio(dpr);
      glRenderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    },

    render(frame, params) {
      if (!scene || !camera) return;

      const next = resolveParams(params);
      const needsRebuild =
        !sceneBuilt ||
        next.ringCount !== resolved.ringCount ||
        Math.abs(next.particleDensity - resolved.particleDensity) > 0.05;

      if (needsRebuild) {
        resolved = next;
        rebuildScene(frame.colors.palette);
        paletteSignature = frame.colors.palette.join("|");
        sceneBuilt = true;
      } else {
        resolved = next;
      }

      const palette = frame.colors.palette;
      if (palette.length > 0) {
        const signature = palette.join("|");
        if (signature !== paletteSignature) {
          paletteSignature = signature;
          applyPalette(paletteToThreeColors(THREE, palette, resolved.ringCount));
        }
      }

      const motionScale = frame.flags.reducedMotion ? 0.25 : 1;
      const delta = (frame.time.deltaMs / 1000) * motionScale;
      const bins = resolveBins(frame, resolved.ringCount);
      const audio = frame.audio;

      energySmooth = energySmooth * 0.85 + audio.overallEnergy * 0.15;
      bassKick = bassKick * 0.82 + audio.bassEnergy * 0.18;

      const energyDrive =
        energySmooth * 0.45 +
        audio.bassEnergy * 0.32 +
        audio.midEnergy * 0.15 +
        audio.trebleEnergy * 0.08;

      const curveAmt = frame.flags.reducedMotion ? 0 : CURVE_STRENGTH;
      const grade = trackTangent(travel).y * curveAmt;

      let speed;
      let coasterFactor;
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
        coasterFactor = 1 - grade * COASTER_GRAVITY;
      }
      travel += speed * delta * 4.6 * coasterFactor;

      const speedNorm = clamp((speed - 0.7) / 2.6, 0, 1);
      const camOff = trackOffset(travel);
      const bank = clamp(-trackCurvatureX(travel) * 18 * curveAmt, -0.72, 0.72);

      const offsetAtDepth = (depth) => {
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

        const gradient = depthGradientColors(THREE, baseColor, z, paletteColors);
        band.material.color.copy(gradient.band);
        fill.material.color.copy(gradient.fill);

        const bandOpacity = ringOpacityForZ(z, energy, glowBoost, span);
        band.material.opacity = bandOpacity * (0.78 + bin * 0.18);
        fill.material.opacity =
          bandOpacity * (0.28 + bin * 0.22 + energy * 0.12);

        const tangent = trackTangent(travel - z);
        group.rotation.z = bank * 0.55;
        group.rotation.y = softTilt(tangent.x * curveAmt * 2.2, MAX_RING_TILT_Y);
        group.rotation.x = softTilt(tangent.y * curveAmt * 1.9, MAX_RING_TILT_X);
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
            particlePositions[i * 3 + 2] +
            speed * particleSpeeds[i] * delta * particleBoost * 3.6;
          if (z > RING_PASS_Z) {
            z = -(6 + Math.random() * TUNNEL_DEPTH);
            const angle = Math.random() * Math.PI * 2;
            const radius = sampleParticleRadius();
            particleLocalX[i] = Math.cos(angle) * radius;
            particleLocalY[i] = Math.sin(angle) * radius;
          }
          const pBend = offsetAtDepth(-z);
          particlePositions[i * 3] = particleLocalX[i] + pBend.x;
          particlePositions[i * 3 + 1] = particleLocalY[i] + pBend.y;
          particlePositions[i * 3 + 2] = z;
        }
        positions.needsUpdate = true;

        particles.material.opacity =
          0.38 + audio.trebleEnergy * 0.32 + energySmooth * 0.08;
      }

      if (vanishingGlow) {
        const bassScale =
          1 + audio.bassEnergy * 0.3 * resolved.bassPulse + bassKick * 0.1;
        vanishingGlow.scale.setScalar(bassScale);
        const farTint =
          paletteColors[paletteColors.length - 1] ?? paletteColors[0];
        if (farTint) {
          vanishingGlow.material.color.copy(farTint);
        }
        vanishingGlow.material.opacity =
          0.32 + audio.bassEnergy * 0.2 * glowBoost + energySmooth * 0.1;
        const glowZ = -TUNNEL_DEPTH * 0.72;
        const glowBend = offsetAtDepth(TUNNEL_DEPTH * 0.72);
        vanishingGlow.position.set(glowBend.x, glowBend.y, glowZ);
      }

      const LOOK_AHEAD = 36;
      const lookBend = offsetAtDepth(LOOK_AHEAD);
      const lookX = lookBend.x * 1.35 + bassKick * 0.08;
      const lookY = lookBend.y * 1.35;
      camera.position.set(0, 0, 0);
      camera.up.set(-bank * 2.4, 1, 0).normalize();
      camera.fov =
        70 + speedNorm * 16 + Math.max(0, -grade) * 18 + bassKick * 1.4;
      camera.updateProjectionMatrix();
      camera.lookAt(lookX, lookY, -LOOK_AHEAD);

      glRenderer.render(scene, camera);
    },

    dispose() {
      disposeRings();
      if (particles) {
        particles.geometry.dispose();
        particles.material.dispose();
        scene?.remove(particles);
        particles = null;
      }
      sparkTexture?.dispose();
      sparkTexture = null;
      if (vanishingGlow) {
        vanishingGlow.geometry.dispose();
        vanishingGlow.material.dispose();
        scene?.remove(vanishingGlow);
        vanishingGlow = null;
      }
      scene = null;
      camera = null;
      glRenderer.dispose();
    },
  };
}
