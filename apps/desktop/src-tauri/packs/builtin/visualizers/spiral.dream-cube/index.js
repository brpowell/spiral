/**
 * Dream Cube VizRenderer — pack-shipped WebGL/three.js module.
 * A holographic glass cube turns slowly in a hazy void. Its faces light from
 * the waveform and its hue shifts with the track. Dust and motes push out
 * with the music, and stronger hits release a short cube shell.
 * Each new track places a cube on the ring and the camera pans to it.
 * Returning to the previous track pans back to that cube. When the ring is
 * full, the cube visited least recently is removed.
 * Every color is derived from the album art and eases between tracks.
 * Contract: export create({ canvas, THREE }) → { render(frame), resize, dispose }
 */

/** Radians per second around x / y / z. */
const SPIN = { x: 0.11, y: 0.17, z: 0.07 };
const CUBE_SIZE = 1.35;
const CUBE_SCALE = 0.62;
/**
 * The cube is composed for studio cards and the expanded stage. The library
 * header is only ~60px tall, which shrinks that same framing to a speck.
 * Below COMFORT_SPAN (shorter side, CSS px) the cube and its cloud grow,
 * reaching SUBJECT_SCALE_MAX at TIGHT_SPAN.
 */
const COMFORT_SPAN = 108;
const TIGHT_SPAN = 56;
const SUBJECT_SCALE_MAX = 2.65;
/** How long the camera takes to settle on the cube for a new track. */
const PAN_MS = 1600;
/** Distance from the origin at which visited cubes are set down. */
const FIELD_RADIUS = 7.5;
/** Visited cubes kept. Past this, the least recently visited one is removed. */
const CUBE_CACHE = 8;

const SHELL_POOL = 6;
const SHELL_LIFE_MS = 1400;
/** How far a shell grows past the cube, as a multiple of the cube's size. */
const SHELL_REACH = 1.6;
/** A shell needs a sudden bass jump that also clears this absolute level. */
const ONSET_RATIO = 2;
const ONSET_FLOOR = 0.12;
const ONSET_MIN = 0.58;
const ONSET_COOLDOWN_MS = 380;
/** No shell during the opening of a track. */
const ONSET_GRACE_MS = 1100;

const ORBIT_COUNT = 140;
const FACE_COUNT = 6;

const PARTICLE_COUNT = 420;
const PARTICLE_HEIGHT = 7;
const FLOATER_COUNT = 10;

/** How long a palette change takes to settle. */
const PALETTE_EASE_MS = 1400;
const FALLBACK_PALETTE = ["#7ab01c", "#c4e070", "#4fb89a"];

const NOISE_GLSL = /* glsl */ `
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
          mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
          mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * noise3(p);
      p *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }
`;

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;
  uniform float uPulse;
  uniform vec2 uResolution;
  uniform vec3 uDeep;
  uniform vec3 uPrimary;
  uniform vec3 uSecondary;
  uniform vec3 uAccent;
  varying vec3 vDir;
  ${NOISE_GLSL}
  void main() {
    vec3 d = normalize(vDir);
    float t = uTime * 0.012;

    float haze = fbm(d * 2.1 + vec3(t, t * 0.6, -t * 0.4));
    float veil = fbm(d * 3.7 - vec3(t * 0.7, -t * 0.2, t));
    float horizon = exp(-abs(d.y + 0.08) * 4.5);

    vec3 col = mix(uDeep * 0.22, uDeep * 0.7, smoothstep(-0.9, 0.7, d.y));
    col += uPrimary * smoothstep(0.5, 0.92, haze) * 0.11;
    col += uAccent * smoothstep(0.58, 0.95, veil) * 0.06;
    col += uSecondary * horizon * (0.05 + uEnergy * 0.12);

    vec2 uv = gl_FragCoord.xy / uResolution;
    float rad = length(uv - 0.5);
    // Soft wash that swells with the track, so the air around the cube stays alive.
    float wash = exp(-rad * rad * (12.0 - uEnergy * 5.0));
    col += uPrimary * wash * (0.04 + uEnergy * 0.18 + uPulse * 0.08);

    float vignette = smoothstep(1.05, 0.2, rad * 1.7);
    col *= mix(0.35, 1.0, vignette);

    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    #include <colorspace_fragment>

    // Dither in output space so the long gradients do not band. Interleaved
    // gradient noise has no row/column structure, and the sRGB encode never
    // sees a negative channel.
    vec2 px = gl_FragCoord.xy + 5.588238 * mod(floor(uTime * 60.0), 64.0);
    float dither = fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
    gl_FragColor.rgb = max(gl_FragColor.rgb + (dither - 0.5) / 255.0, vec3(0.0));
  }
`;

const GLASS_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vObjectNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vObjectNormal = normal;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * Shared by the cube, its shells, and the floaters.
 * uShimmer is 0 on shells and floaters, so they hold one color. On the cube
 * it crossfades the two swatches, and uLevels[6] lights each face
 * (+x, -x, +y, -y, +z, -z) from its own audio value.
 */
const GLASS_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uFace;
  uniform float uEdgeWidth;
  uniform float uPulse;
  uniform float uPanel;
  uniform float uShimmer;
  uniform float uPulseGain;
  uniform float uLevels[6];
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vObjectNormal;
  varying vec3 vView;

  float faceLevel() {
    vec3 an = abs(vObjectNormal);
    float useX = step(an.y, an.x) * step(an.z, an.x);
    float useY = (1.0 - useX) * step(an.z, an.y);
    float useZ = 1.0 - useX - useY;
    return useX * mix(uLevels[1], uLevels[0], step(0.0, vObjectNormal.x))
      + useY * mix(uLevels[3], uLevels[2], step(0.0, vObjectNormal.y))
      + useZ * mix(uLevels[5], uLevels[4], step(0.0, vObjectNormal.z));
  }

  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float fresnel = pow(1.0 - facing, 2.0);

    vec2 e = min(vUv, 1.0 - vUv);
    float edge = 1.0 - smoothstep(0.0, uEdgeWidth, min(e.x, e.y));
    edge = edge * edge;

    float wave = 0.5 + 0.5 * sin(uTime * 0.9 + dot(vObjectNormal, vec3(1.7, 2.4, 0.9)) * 3.0);
    vec3 iri = mix(uColorA, uColorB, wave * uShimmer);
    float scan = uShimmer * (0.5 + 0.5 * sin((vUv.y + uTime * 0.04) * 90.0));

    vec3 body = iri * (0.012 + fresnel * 0.12 + scan * 0.006) * uFace;
    vec3 rim = mix(uColorB, vec3(1.0), 0.08) * edge * (0.22 + uPulse * 0.45 * uPulseGain);

    float panel = 1.0 - smoothstep(0.05, 0.55, length(vUv - 0.5));
    vec3 faceLit = iri * faceLevel() * mix(0.2, 1.15, panel) * uPanel;

    gl_FragColor = vec4((body + rim) * uIntensity + faceLit, 1.0);
    #include <colorspace_fragment>
  }
`;

const HALO_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HALO_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float r2 = r * r;
    float glow = 0.6 * exp(-r2 * 20.0) + 0.3 * exp(-r2 * 4.0);
    glow *= 1.0 - smoothstep(0.8, 1.0, r);
    gl_FragColor = vec4(uColor * glow * uOpacity, 1.0);
    #include <colorspace_fragment>

    vec2 px = gl_FragCoord.xy + 5.588238 * mod(floor(uTime * 60.0), 64.0);
    float dither = fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
    gl_FragColor.rgb = max(gl_FragColor.rgb + (dither - 0.5) * glow / 255.0, vec3(0.0));
  }
`;

const DUST_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uPointScale;
  uniform float uSizeCap;
  uniform float uPush;
  uniform float uHeight;
  uniform float uTreble;
  varying float vSeed;
  varying float vFade;
  void main() {
    vec3 p = position;
    p.y = mod(p.y + uTime * (0.04 + aSeed * 0.1) + uHeight, 2.0 * uHeight) - uHeight;
    p.x += sin(uTime * 0.18 + aSeed * 21.0) * 0.35;
    p.z += cos(uTime * 0.15 + aSeed * 13.0) * 0.35;
    p += normalize(p + vec3(0.0001)) * uPush * (0.3 + aSeed * 0.7);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float sized = min(aSize, uSizeCap);
    gl_PointSize = sized * uPixelRatio * uPointScale * (1.0 + uTreble * 1.6) * (18.0 / -mv.z);
    vSeed = aSeed;
    vFade = 1.0 - smoothstep(uHeight * 0.55, uHeight, abs(p.y));
  }
`;

const DUST_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying float vSeed;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = 1.0 - smoothstep(0.0, 0.5, d);
    a *= a;
    float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + vSeed * 2.2) + vSeed * 40.0);
    vec3 col = mix(uColorA, uColorB, vSeed);
    gl_FragColor = vec4(col, a * twinkle * vFade * uOpacity);
    #include <colorspace_fragment>
  }
`;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/** How much to enlarge the cube and its cloud so a short slot still reads. */
function subjectScaleFor(width, height) {
  const span = Math.min(Math.max(width, 1), Math.max(height, 1));
  if (span >= COMFORT_SPAN) return 1;
  const t = clamp((COMFORT_SPAN - span) / (COMFORT_SPAN - TIGHT_SPAN), 0, 1);
  return 1 + (SUBJECT_SCALE_MAX - 1) * smoothstep(t);
}

/** 0 on the composed stage, 1 in the library header. */
function stageTightness(subjectScale) {
  return clamp((subjectScale - 1) / (SUBJECT_SCALE_MAX - 1), 0, 1);
}

/**
 * Wisps shrink with the frame; dust sprites do not, so on a short view the
 * field outshines the cloud. 0 at the composed height, 1 near the header.
 */
const FIELD_HEIGHT = 440;
const FIELD_FLOOR = 64;

function fieldEased(height) {
  const t = clamp(
    (FIELD_HEIGHT - Math.max(height, 1)) / (FIELD_HEIGHT - FIELD_FLOOR),
    0,
    1,
  );
  return smoothstep(t);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Golden-angle ring, so each new cube sits off the one before it. */
function cubePosition(THREE, index) {
  const angle = index * 2.399963;
  return new THREE.Vector3(
    Math.cos(angle) * FIELD_RADIUS,
    Math.sin(index * 1.2) * 1.5,
    Math.sin(angle) * FIELD_RADIUS,
  );
}

/**
 * Stable identity for a visit. The track id distinguishes recordings that
 * share a title. Art and colors are left out: they arrive later.
 */
function trackKey(track) {
  if (typeof track?.id === "number") return `id:${track.id}`;
  if (!track?.title) return "";
  const artists = (track.artists ?? []).map((artist) => artist.name).join("\u0001");
  return `meta:${track.title}\u0000${track.album ?? ""}\u0000${artists}`;
}

/**
 * Drop the analyser's resting hum, then keep the curve steep so a quiet
 * face stays dim and only a real peak fills the panel.
 */
function punch(value) {
  const lifted = Math.max(0, value - 0.14) / 0.86;
  return clamp(Math.pow(lifted, 1.45), 0, 1);
}

/** Six slices of the waveform, each face taking the peak of its slice. */
function waveformFaces(source, out) {
  const n = source.length;
  for (let i = 0; i < FACE_COUNT; i++) {
    const start = Math.floor((i * n) / FACE_COUNT);
    const end = Math.max(start + 1, Math.floor(((i + 1) * n) / FACE_COUNT));
    let peak = 0;
    const last = Math.min(end, n);
    for (let j = start; j < last; j++) {
      const value = Math.abs(source[j] ?? 0);
      if (value > peak) peak = value;
    }
    out[i] = punch(peak);
  }
}

function easeFaces(display, targets, dt, attackMs, releaseMs) {
  const attack = 1 - Math.exp(-dt / attackMs);
  const release = 1 - Math.exp(-dt / releaseMs);
  for (let i = 0; i < FACE_COUNT; i++) {
    const target = targets[i] ?? 0;
    const blend = target >= display[i] ? attack : release;
    display[i] += (target - display[i]) * blend;
  }
}

function createGlowTexture(THREE) {
  const size = 128;
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(size, size)
      : document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.25, "rgba(255,255,255,0.35)");
    g.addColorStop(0.6, "rgba(255,255,255,0.08)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * Album swatches → four roles. The most saturated swatches lead so muddy
 * covers still read as luminous; lightness is lifted into a soft pastel band.
 */
function derivePalette(THREE, artColors) {
  const sources = (artColors && artColors.length > 0 ? artColors : FALLBACK_PALETTE)
    .map((hex) => new THREE.Color(hex));
  const hsl = { h: 0, s: 0, l: 0 };
  const ranked = sources
    .map((color) => {
      color.getHSL(hsl, THREE.SRGBColorSpace);
      return { color, h: hsl.h, s: hsl.s, l: hsl.l };
    })
    .sort((a, b) => b.s - a.s);

  const lead = ranked[0];
  const pick = (index, hueShift) => {
    const swatch = ranked[index];
    const h = swatch ? swatch.h : (lead.h + hueShift) % 1;
    const s = swatch ? swatch.s : lead.s;
    return new THREE.Color().setHSL(
      h,
      clamp(s * 1.05 + 0.05, 0.22, 0.7),
      clamp(swatch ? swatch.l : lead.l, 0.4, 0.56),
      THREE.SRGBColorSpace,
    );
  };

  const primary = pick(0, 0);
  const secondary = pick(1, 0.12);
  const accent = pick(2, -0.1);
  const deep = new THREE.Color().setHSL(
    (ranked[1] ?? lead).h,
    clamp(lead.s * 0.7, 0.3, 0.7),
    0.07,
    THREE.SRGBColorSpace,
  );
  return { deep, primary, secondary, accent };
}

export function create({ canvas, THREE }) {
  const glRenderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
    // Needed so transferToImageBitmap captures the frame in the sandbox worker.
    preserveDrawingBuffer: true,
  });
  glRenderer.setClearColor(0x05060f, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  camera.position.set(0, 0, 6.2);

  const colors = {
    deep: new THREE.Color(),
    primary: new THREE.Color(),
    secondary: new THREE.Color(),
    accent: new THREE.Color(),
  };
  let targetColors = null;
  let paletteSignature = null;

  const time = { value: 0 };
  const pulse = { value: 0 };
  const geometries = [];
  const materials = [];

  function track(geometry, material) {
    geometries.push(geometry);
    materials.push(material);
  }

  function glassMaterial({ intensity, face, edgeWidth, colorA, colorB, panel = 0 }) {
    return new THREE.ShaderMaterial({
      vertexShader: GLASS_VERTEX,
      fragmentShader: GLASS_FRAGMENT,
      uniforms: {
        uTime: time,
        uPulse: pulse,
        uIntensity: { value: intensity },
        uFace: { value: face },
        uEdgeWidth: { value: edgeWidth },
        uPanel: { value: panel },
        uShimmer: { value: 0 },
        uPulseGain: { value: 0 },
        uLevels: { value: new Float32Array(FACE_COUNT) },
        uColorA: { value: colorA },
        uColorB: { value: colorB },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
    });
  }

  // Sky
  const skyGeometry = new THREE.SphereGeometry(80, 48, 32);
  const skyMaterial = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: {
      uTime: time,
      uPulse: pulse,
      uEnergy: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uDeep: { value: colors.deep },
      uPrimary: { value: colors.primary },
      uSecondary: { value: colors.secondary },
      uAccent: { value: colors.accent },
    },
    side: THREE.BackSide,
    depthWrite: false,
  });
  track(skyGeometry, skyMaterial);
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.renderOrder = -10;
  scene.add(sky);

  // Color aura on the cube that is playing. It stays with that cube while
  // the camera travels. A shader, not a canvas gradient: WebKit dithers
  // those, and stretching one this large turns the dither into dark specks.
  const haloGeometry = new THREE.PlaneGeometry(1, 1);
  const haloMaterial = new THREE.ShaderMaterial({
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    uniforms: {
      uTime: time,
      uColor: { value: colors.primary },
      uOpacity: { value: 0.12 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  track(haloGeometry, haloMaterial);
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.scale.setScalar(4.4);
  halo.renderOrder = -5;
  scene.add(halo);

  // One mesh per visited track, on a ring. Only the focused one dances.
  const cubeGeometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
  geometries.push(cubeGeometry);
  const visits = [];
  let cursor = -1;
  let currentKey = "";
  let placed = 0;
  let useStamp = 0;

  function disposeVisit(visit) {
    scene.remove(visit.mesh);
    visit.material.dispose();
    const index = materials.indexOf(visit.material);
    if (index >= 0) materials.splice(index, 1);
  }

  function setDancing(visit, dancing) {
    visit.dancing = dancing;
    visit.material.uniforms.uShimmer.value = dancing ? 1 : 0;
    visit.material.uniforms.uPanel.value = dancing ? 1.55 : 0;
    visit.material.uniforms.uPulseGain.value = dancing ? 1 : 0;
    if (!dancing) {
      visit.material.uniforms.uIntensity.value = 0.3;
      visit.material.uniforms.uEdgeWidth.value = 0.026;
    }
  }

  function createVisit(key) {
    const index = placed;
    placed += 1;
    const material = glassMaterial({
      intensity: 0.3,
      face: 1.1,
      edgeWidth: 0.026,
      panel: 0,
      colorA: colors.accent.clone(),
      colorB: colors.secondary.clone(),
    });
    materials.push(material);
    const mesh = new THREE.Mesh(cubeGeometry, material);
    mesh.scale.setScalar(CUBE_SCALE * subjectScale);
    mesh.position.copy(cubePosition(THREE, index));
    mesh.rotation.set(index * 0.4, index * 0.7, index * 0.2);
    scene.add(mesh);
    return { key, mesh, material, dancing: false, used: 0 };
  }

  function dropForwardVisits() {
    while (visits.length > cursor + 1) disposeVisit(visits.pop());
  }

  /** Drop the visit we haven't focused in the longest time. Never the current one. */
  function evictLeastRecent() {
    while (visits.length > CUBE_CACHE) {
      let oldest = -1;
      let oldestUsed = Infinity;
      for (let i = 0; i < visits.length; i++) {
        if (i === cursor) continue;
        if (visits[i].used < oldestUsed) {
          oldestUsed = visits[i].used;
          oldest = i;
        }
      }
      if (oldest < 0) break;
      disposeVisit(visits[oldest]);
      visits.splice(oldest, 1);
      if (oldest < cursor) cursor -= 1;
    }
  }

  // Pulse shells
  const shells = Array.from({ length: SHELL_POOL }, () => {
    const material = glassMaterial({
      intensity: 0,
      face: 0.18,
      edgeWidth: 0.022,
      panel: 0,
      colorA: new THREE.Color(),
      colorB: new THREE.Color(),
    });
    materials.push(material);
    const mesh = new THREE.Mesh(cubeGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    return {
      mesh,
      material,
      age: SHELL_LIFE_MS,
      strength: 0,
      startScale: CUBE_SCALE,
      spin: new THREE.Vector3(),
    };
  });
  let shellCursor = 0;
  let subjectScale = 1;

  // Wisps that travel with the camera. They gather while in transit and
  // swell with the sound once they've arrived at the cube.
  const glowTexture = createGlowTexture(THREE);
  const orbitPositions = new Float32Array(ORBIT_COUNT * 3);
  const orbitSeeds = Array.from({ length: ORBIT_COUNT }, () => ({
    theta: Math.random() * Math.PI * 2,
    phi: Math.acos(2 * Math.random() - 1),
    speed: 0.15 + Math.random() * 0.45,
    wobble: Math.random() * Math.PI * 2,
  }));
  const orbitGeometry = new THREE.BufferGeometry();
  orbitGeometry.setAttribute("position", new THREE.BufferAttribute(orbitPositions, 3));
  const orbitMaterial = new THREE.PointsMaterial({
    map: glowTexture,
    color: colors.accent,
    size: 0.09,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    toneMapped: false,
  });
  geometries.push(orbitGeometry);
  materials.push(orbitMaterial);
  const cloud = new THREE.Group();
  cloud.add(new THREE.Points(orbitGeometry, orbitMaterial));
  scene.add(cloud);

  // Dust
  const dustPositions = new Float32Array(PARTICLE_COUNT * 3);
  const dustSeeds = new Float32Array(PARTICLE_COUNT);
  const dustSizes = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.8 + Math.pow(Math.random(), 0.7) * 11;
    dustPositions[i * 3] = Math.cos(angle) * radius;
    dustPositions[i * 3 + 1] = (Math.random() * 2 - 1) * PARTICLE_HEIGHT;
    dustPositions[i * 3 + 2] = Math.sin(angle) * radius - 2;
    dustSeeds[i] = Math.random();
    dustSizes[i] = 0.8 + Math.pow(Math.random(), 3) * 3.2;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute("aSeed", new THREE.BufferAttribute(dustSeeds, 1));
  dustGeometry.setAttribute("aSize", new THREE.BufferAttribute(dustSizes, 1));
  const dustMaterial = new THREE.ShaderMaterial({
    vertexShader: DUST_VERTEX,
    fragmentShader: DUST_FRAGMENT,
    uniforms: {
      uTime: time,
      uPixelRatio: { value: 1 },
      uPointScale: { value: 1 },
      uSizeCap: { value: 4.2 },
      uPush: { value: 0 },
      uHeight: { value: PARTICLE_HEIGHT },
      uTreble: { value: 0 },
      uOpacity: { value: 0.32 },
      uColorA: { value: colors.secondary },
      uColorB: { value: colors.accent },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  track(dustGeometry, dustMaterial);
  scene.add(new THREE.Points(dustGeometry, dustMaterial));

  // Distant floaters
  const floaterMaterial = glassMaterial({
    intensity: 0.26,
    face: 0.55,
    edgeWidth: 0.05,
    colorA: colors.secondary,
    colorB: colors.accent,
  });
  materials.push(floaterMaterial);
  const floaters = Array.from({ length: FLOATER_COUNT }, (_, i) => {
    const mesh = new THREE.Mesh(cubeGeometry, floaterMaterial);
    const angle = (i / FLOATER_COUNT) * Math.PI * 2 + Math.random() * 0.4;
    const radius = 7 + Math.random() * 8;
    const base = new THREE.Vector3(
      Math.cos(angle) * radius,
      (Math.random() * 2 - 1) * 3.5,
      Math.sin(angle) * radius - 6,
    );
    mesh.position.copy(base);
    const baseScale = 0.1 + Math.random() * 0.22;
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    scene.add(mesh);
    mesh.scale.setScalar(baseScale);
    return {
      mesh,
      base,
      baseScale,
      phase: Math.random() * Math.PI * 2,
      spin: 0.05 + Math.random() * 0.12,
    };
  });

  // Audio state
  let clockMs = 0;
  let energySmooth = 0;
  let bassSmooth = 0;
  let midSmooth = 0;
  let bassAverage = 0;
  let trebleSmooth = 0;
  let sinceShell = 0;
  let shellQuietUntil = 0;
  /** Eased gather and release of the wisp ball. */
  let cloudShape = 1;
  /** Beat response. Cut the moment a pan starts, back once they've arrived. */
  let cloudBeat = 1;
  const faceTargets = new Float32Array(FACE_COUNT);
  const focus = new THREE.Vector3();
  const panFrom = new THREE.Vector3();
  const panTo = new THREE.Vector3();
  let panElapsed = PAN_MS;

  function activeVisit() {
    return cursor >= 0 ? visits[cursor] : null;
  }

  function focusVisit(index, immediate) {
    cursor = index;
    const visit = visits[index];
    visit.used = ++useStamp;
    for (const other of visits) setDancing(other, other === visit);
    evictLeastRecent();
    panFrom.copy(focus);
    panTo.copy(visit.mesh.position);
    panElapsed = immediate ? PAN_MS : 0;
    if (immediate) focus.copy(visit.mesh.position);
  }

  /**
   * Next lands on a new cube, unless it returns to the track we just left by
   * going back — that cube is still there. Previous always returns to the
   * cube visited before this one.
   */
  function followTrack(track) {
    const key = trackKey(track);
    if (!key || key === currentKey) return;
    const back = cursor > 0 && visits[cursor - 1]?.key === key;
    const forward = cursor >= 0 && visits[cursor + 1]?.key === key;
    if (back) {
      focusVisit(cursor - 1, false);
    } else if (forward) {
      focusVisit(cursor + 1, false);
    } else {
      if (cursor >= 0) dropForwardVisits();
      visits.push(createVisit(key));
      focusVisit(visits.length - 1, visits.length === 1);
    }
    currentKey = key;
    shellQuietUntil = clockMs + ONSET_GRACE_MS;
  }

  function idleFaces(out, speed) {
    for (let i = 0; i < FACE_COUNT; i++) {
      out[i] = 0.04 + 0.05 * (0.5 + 0.5 * Math.sin(time.value * speed + i * 1.15));
    }
  }

  function syncPalette(artColors) {
    const signature = artColors.join("|");
    if (signature === paletteSignature) return;
    const first = paletteSignature === null;
    paletteSignature = signature;
    targetColors = derivePalette(THREE, artColors);
    if (first) {
      for (const key of Object.keys(colors)) colors[key].copy(targetColors[key]);
    }
  }

  function easePalette(dt) {
    if (!targetColors) return;
    const blend = 1 - Math.exp(-dt / (PALETTE_EASE_MS / 4));
    for (const key of Object.keys(colors)) colors[key].lerp(targetColors[key], blend);
  }

  function spawnShell(strength) {
    const cube = activeVisit()?.mesh;
    if (!cube) return;
    const shell = shells[shellCursor];
    shellCursor = (shellCursor + 1) % shells.length;
    shell.age = 0;
    shell.strength = strength;
    shell.startScale = cube.scale.x;
    shell.mesh.visible = true;
    shell.mesh.position.copy(cube.position);
    shell.mesh.quaternion.copy(cube.quaternion);
    shell.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .multiplyScalar(0.25);
    shell.material.uniforms.uColorA.value.copy(colors.primary);
    shell.material.uniforms.uColorB.value.copy(colors.primary);
    shell.material.uniforms.uPulseGain.value = 0.4;
    sinceShell = 0;
    pulse.value = Math.max(pulse.value, strength);
  }

  function detectPulse(audio, dt, reducedMotion) {
    sinceShell += dt;
    bassAverage += (audio.bassEnergy - bassAverage) * (1 - Math.exp(-dt / 450));
    if (!audio.isPlaying || clockMs < shellQuietUntil) return;

    const cooldown = reducedMotion ? ONSET_COOLDOWN_MS * 4 : ONSET_COOLDOWN_MS;
    const lift = audio.bassEnergy - bassAverage;
    if (
      sinceShell > cooldown &&
      audio.bassEnergy >= ONSET_MIN &&
      audio.bassEnergy > bassAverage * ONSET_RATIO + ONSET_FLOOR
    ) {
      spawnShell(clamp(0.55 + lift * 2.2, 0.55, 1) * (reducedMotion ? 0.6 : 1));
    }
  }

  function updateShells(dt) {
    for (const shell of shells) {
      if (!shell.mesh.visible) continue;
      shell.age += dt;
      const t = shell.age / SHELL_LIFE_MS;
      if (t >= 1) {
        shell.mesh.visible = false;
        continue;
      }
      const reach = SHELL_REACH * (0.75 + shell.strength * 0.35);
      shell.mesh.scale.setScalar(shell.startScale * (1.04 + easeOutCubic(t) * reach));
      shell.mesh.rotation.x += shell.spin.x * dt * 0.001;
      shell.mesh.rotation.y += shell.spin.y * dt * 0.001;
      shell.mesh.rotation.z += shell.spin.z * dt * 0.001;
      const fadeIn = clamp(t / 0.08, 0, 1);
      shell.material.uniforms.uIntensity.value =
        shell.strength * fadeIn * Math.pow(1 - t, 1.5) * 0.95;
    }
  }

  return {
    resize(width, height, dpr) {
      glRenderer.setPixelRatio(dpr);
      glRenderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      skyMaterial.uniforms.uResolution.value.set(width * dpr, height * dpr);
      dustMaterial.uniforms.uPixelRatio.value = dpr;
    },

    render(frame) {
      const { audio, flags } = frame;
      subjectScale = subjectScaleFor(frame.size.width, frame.size.height);
      const motion = flags.reducedMotion ? 0.3 : 1;
      const dt = frame.time.deltaMs;
      const dts = (dt / 1000) * motion;

      followTrack(frame.trackMetadata);
      syncPalette(frame.trackMetadata.artColors);
      easePalette(dt);

      clockMs += dt * motion;
      time.value = clockMs / 1000;
      const t = time.value;

      energySmooth += (audio.overallEnergy - energySmooth) * (1 - Math.exp(-dt / 180));
      bassSmooth += (audio.bassEnergy - bassSmooth) * (1 - Math.exp(-dt / 90));
      midSmooth += (audio.midEnergy - midSmooth) * (1 - Math.exp(-dt / 140));
      trebleSmooth += (audio.trebleEnergy - trebleSmooth) * (1 - Math.exp(-dt / 120));
      pulse.value *= Math.exp(-dt / 320);

      detectPulse(audio, dt, flags.reducedMotion);
      updateShells(dt);

      const drive = 1 + energySmooth * 0.45;
      for (const visit of visits) {
        const spin = visit.dancing ? drive : 0.35;
        visit.mesh.rotation.x += SPIN.x * dts * spin;
        visit.mesh.rotation.y += SPIN.y * dts * spin;
        visit.mesh.rotation.z += SPIN.z * dts * spin;
      }

      const cube = activeVisit();
      const restScale = CUBE_SCALE * subjectScale;
      for (const visit of visits) {
        if (visit !== cube) visit.mesh.scale.setScalar(restScale);
      }
      if (cube) {
        if (audio.isPlaying && audio.waveform.length > 0) {
          waveformFaces(audio.waveform, faceTargets);
        } else {
          idleFaces(faceTargets, 0.7);
        }
        easeFaces(cube.material.uniforms.uLevels.value, faceTargets, dt, 28, 120);

        const breathe = 1 + Math.sin(t * 0.6) * 0.012;
        cube.mesh.scale.setScalar(
          restScale * (breathe + midSmooth * 0.4 + bassSmooth * 0.22),
        );
        cube.material.uniforms.uIntensity.value = 0.28 + midSmooth * 0.4 + trebleSmooth * 0.5;
        cube.material.uniforms.uEdgeWidth.value = 0.04 + trebleSmooth * 0.06;
        cube.material.uniforms.uColorA.value.copy(colors.accent);
        cube.material.uniforms.uColorB.value.copy(colors.secondary);
      }

      const panDuration = flags.reducedMotion ? 400 : PAN_MS;
      if (panElapsed < panDuration) {
        panElapsed += dt;
        const eased = easeInOutCubic(clamp(panElapsed / panDuration, 0, 1));
        focus.lerpVectors(panFrom, panTo, eased);
      }
      const panT = clamp(panElapsed / panDuration, 0, 1);
      const listenTarget = panT > 0.9 ? 1 : 0;
      const shapeTau = listenTarget === 0 ? 240 : 45;
      cloudShape += (listenTarget - cloudShape) * (1 - Math.exp(-dt / shapeTau));
      if (listenTarget === 0) {
        cloudBeat = 0;
      } else {
        cloudBeat += (1 - cloudBeat) * (1 - Math.exp(-dt / 45));
      }

      for (let i = 0; i < ORBIT_COUNT; i++) {
        const mote = orbitSeeds[i];
        const theta = mote.theta + t * mote.speed * (0.4 + 0.6 * cloudShape);
        const phi = mote.phi + Math.sin(t * 0.4 + mote.wobble) * 0.15;
        const radius =
          (0.68 + 0.37 * cloudShape) * subjectScale +
          bassSmooth * 2.15 * cloudBeat * (0.55 + 0.45 * subjectScale) +
          Math.sin(t * 1.3 + mote.wobble) * (0.05 + 0.15 * cloudShape) * subjectScale;
        const sinPhi = Math.sin(phi);
        orbitPositions[i * 3] = Math.cos(theta) * sinPhi * radius;
        orbitPositions[i * 3 + 1] = Math.cos(phi) * radius;
        orbitPositions[i * 3 + 2] = Math.sin(theta) * sinPhi * radius;
      }
      orbitGeometry.attributes.position.needsUpdate = true;
      orbitMaterial.color.copy(colors.accent);
      const arrivedOpacity = 0.42 + (energySmooth * 0.5 + trebleSmooth * 0.4) * cloudBeat;
      const arrivedSize = 0.08 + (midSmooth * 0.14 + bassSmooth * 0.06) * cloudBeat;
      const tightness = stageTightness(subjectScale);
      const field = fieldEased(frame.size.height);
      const wispBoost = 1 + field * 1.45;
      orbitMaterial.opacity = Math.min(
        1,
        (0.55 + (arrivedOpacity - 0.55) * cloudShape) * (1 + field * 0.22),
      );
      orbitMaterial.size = (0.09 + (arrivedSize - 0.09) * cloudShape) * wispBoost;

      const haloBoost = 1 + (subjectScale - 1) * 0.42;
      halo.scale.setScalar((3.4 + energySmooth * 2.2 + bassSmooth * 1.2) * haloBoost);
      haloMaterial.uniforms.uOpacity.value = 0.05 + energySmooth * 0.16 + bassSmooth * 0.14;

      for (const floater of floaters) {
        floater.mesh.position.y = floater.base.y + Math.sin(t * 0.22 + floater.phase) * 0.35;
        floater.mesh.rotation.x += floater.spin * dts;
        floater.mesh.rotation.y += floater.spin * 0.7 * dts;
        floater.mesh.scale.setScalar(floater.baseScale * (1 + energySmooth * 0.3));
      }

      skyMaterial.uniforms.uEnergy.value = energySmooth;
      dustGeometry.setDrawRange(
        0,
        Math.max(1, Math.round(PARTICLE_COUNT * (1 - tightness * 0.72))),
      );
      dustMaterial.uniforms.uPointScale.value = 1 - field * 0.72;
      dustMaterial.uniforms.uSizeCap.value = 4.2 - field * 3.05;
      dustMaterial.uniforms.uPush.value = bassSmooth * 1.2 + pulse.value * 0.75;
      dustMaterial.uniforms.uTreble.value = trebleSmooth;
      dustMaterial.uniforms.uOpacity.value =
        (0.4 + energySmooth * 0.4 + trebleSmooth * 0.45) * (1 - field * 0.5);

      cloud.position.copy(focus);
      halo.position.copy(cube ? cube.mesh.position : focus);
      camera.position.set(
        focus.x + Math.sin(t * 0.05) * 0.7,
        focus.y + Math.sin(t * 0.037) * 0.45,
        focus.z + 6.2 + Math.sin(t * 0.029) * 0.3,
      );
      camera.lookAt(focus);
      halo.quaternion.copy(camera.quaternion);

      glRenderer.render(scene, camera);
    },

    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      glowTexture.dispose();
      scene.clear();
      glRenderer.dispose();
    },
  };
}
