import * as THREE from '../vendor/three.module.js';
import { WALL_W, WALL_H, LIGHTS } from './wall.js';
import { swayAt, gustAt, shaderTime } from './wind.js';
import { leafColour } from './leaf-colour.js';
import { WIND_GLSL } from './photo-layer.js';

const PETIOLE = 6, BLADE = 38;   // matches LEAF_LENGTH (44) in leaf-layout.js
const SEGMENTS = 10;

// One blade template: SEGMENTS rows along the midrib, three columns (left edge,
// midrib, right edge). The vertex shader gives it each leaf's shape, size and pose.
function bladeGeometry(count) {
  const blade = [], index = [];
  for (let i = 0; i <= SEGMENTS; i++) for (const side of [-1, 0, 1]) blade.push(side, i / SEGMENTS);
  for (let i = 0; i < SEGMENTS; i++) {
    for (let c = 0; c < 2; c++) {
      const a = i * 3 + c, b = a + 1, d = a + 3, e = a + 4;
      index.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 2));
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((blade.length / 2) * 3), 3));
  g.setIndex(index);
  g.instanceCount = count;
  return g;
}

const VERTEX = /* glsl */ `
  ${WIND_GLSL}
  attribute vec2 aBlade;                 // side (-1 left edge .. 1 right edge), s (0 base .. 1 tip)
  attribute vec2 iBase;                  // stem base, wall units
  attribute float iAngle, iBend, iDeep;  // degrees clockwise from up; cursor bend; deep leaf
  attribute vec3 iSize;                  // scale, foreshortening, shape (0 heart, 1 lance, 2 ovate)
  attribute vec3 iColour;
  attribute vec4 iWind;                  // sway amplitude (deg), sway phase (s), gust amplitude (deg), gust delay (s)
  uniform vec2 uOffset;                  // shadow offset, world units
  varying vec3 vColour, vNormal;
  varying vec2 vWall;
  varying float vSide, vDeep;
  float halfWidth(float shape, float s) {
    if (shape < 0.5) return 11.5 * pow(max(sin(3.14159 * pow(s, 0.7)), 0.0), 0.9);
    if (shape < 1.5) return 7.0 * pow(max(sin(3.14159 * s), 0.0), 0.8);
    return 12.5 * pow(max(sin(3.14159 * pow(s, 0.85)), 0.0), 0.8);
  }
  void main() {
    float side = aBlade.x, s = aBlade.y;
    vec2 local = vec2(side * halfWidth(iSize.z, s) * iSize.y, ${PETIOLE.toFixed(1)} + s * ${BLADE.toFixed(1)}) * iSize.x;
    vec3 n = normalize(vec3(-side * 0.45 * iSize.y, -0.3 * (s - 0.5), 1.0));   // midrib fold + curl
    float deg = iAngle + iWind.x * swayAt(iBase.x, iWind.y) + iWind.z * gustAt(iBase.x, iWind.w) + iBend;
    float c = cos(radians(deg)), k = sin(radians(deg));
    // Clockwise on screen, world y up: local (0, 1) -> (sin, cos).
    vec2 r = vec2(local.x * c + local.y * k, -local.x * k + local.y * c);
    vNormal = normalize(vec3(n.x * c + n.y * k, -n.x * k + n.y * c, n.z));
    vec3 world = vec3(iBase.x + r.x + uOffset.x, -iBase.y + r.y + uOffset.y, 0.0);
    vWall = vec2(world.x, -world.y);
    vColour = iColour; vSide = side; vDeep = iDeep;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uLights[${LIGHTS.length}];
  uniform float uWet, uShadow;
  varying vec3 vColour, vNormal;
  varying vec2 vWall;
  varying float vSide, vDeep;
  void main() {
    if (uShadow > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.28); return; }
    vec3 n = normalize(vNormal), p = vec3(vWall.x, -vWall.y, 0.0);
    vec3 light = vec3(0.92), spec = vec3(0.0);
    for (int i = 0; i < ${LIGHTS.length}; i++) {
      vec3 L = uLights[i] - p;
      float d = length(L);
      L /= d;
      float fall = 1.0 / (1.0 + (d / 260.0) * (d / 260.0));
      light += vec3(1.0, 0.86, 0.64) * max(dot(n, L), 0.0) * fall * 0.18;
      vec3 h = normalize(L + vec3(0.0, 0.0, 1.0));
      spec += vec3(1.0, 0.92, 0.78) * pow(max(dot(n, h), 0.0), mix(28.0, 70.0, uWet)) * fall * mix(0.25, 0.7, uWet);
    }
    float edge = smoothstep(0.6, 1.0, abs(vSide)), rib = 1.0 - smoothstep(0.0, 0.07, abs(vSide));
    vec3 albedo = vColour * mix(1.0, 0.85, uWet) * (1.0 - 0.22 * edge) + vec3(0.05, 0.07, 0.03) * rib;
    gl_FragColor = vec4(albedo * light + spec * (1.0 - 0.6 * vDeep), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// Thin static stems from each planter pocket to its leaf's base.
function stemGeometry(leaves, random) {
  const pos = [], width = 0.65;
  for (const l of leaves) {
    const cx = (l.pocketX + l.x) / 2 + random.range(-3, 3), cy = (l.pocketY + l.y) / 2 + random.range(-3, 3);
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const u = i / 5, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
      pts.push([a * l.pocketX + b * cx + c * l.x, a * l.pocketY + b * cy + c * l.y]);
    }
    for (let i = 0; i < 5; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1, nx = (-(y1 - y0) / len) * width, ny = ((x1 - x0) / len) * width;
      const q = [[x0 + nx, y0 + ny], [x0 - nx, y0 - ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny]].map(([x, y]) => [x, -y, 0]);
      pos.push(...q[0], ...q[1], ...q[2], ...q[1], ...q[3], ...q[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/**
 * The front leaves. `leaves` comes from generateLeaves(); `pixels` is the photo
 * scaled down (ImageData) for colours; `springs` from createSprings().
 */
export function createLeaves(leaves, pixels, random, springs) {
  const n = leaves.length;
  const g = bladeGeometry(n);
  const attr = (name, size, fill, usage) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
    leaves.forEach((l, i) => a.array.set(fill(l, i), i * size));
    if (usage) a.setUsage(usage);
    g.setAttribute(name, a);
    return a;
  };
  const colour = new THREE.Color();
  attr('iBase', 2, (l) => [l.x, l.y]);
  attr('iAngle', 1, (l) => [l.angle]);
  attr('iDeep', 1, (l) => [l.deep ? 1 : 0]);
  attr('iSize', 3, (l) => [l.scale, l.foreshorten, l.shape]);
  attr('iWind', 4, (l) => [l.swayAmp, l.swayPhase, l.gustAmp, l.gustDelay]);
  attr('iColour', 3, (l) => {
    const [r, gr, b] = leafColour(pixels, l.midX, l.midY, WALL_W, WALL_H, random, l.deep ? 0.78 : 1);
    return colour.setRGB(r / 255, gr / 255, b / 255, THREE.SRGBColorSpace).toArray();
  });
  const bend = attr('iBend', 1, () => [0], THREE.DynamicDrawUsage);

  const uniforms = {
    uTime: { value: 0 }, uGustStart: { value: -1e4 }, uGustStrength: { value: 0 },
    uLights: { value: LIGHTS.map(([x, y]) => new THREE.Vector3(x, -y, 60)) },
    uWet: { value: 0 }, uShadow: { value: 0 }, uOffset: { value: new THREE.Vector2(0, 0) },
  };
  const make = (shadow, order) => {
    const material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uShadow: { value: shadow ? 1 : 0 }, uOffset: { value: new THREE.Vector2(shadow ? 2 : 0, shadow ? -3 : 0) } },
      // All leaf layers sit in Three's transparent list (drawn after every opaque
      // object), so renderOrder alone decides shadow → stems → blades; single pass
      // keeps the double-sided blades from being drawn twice.
      vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide, forceSinglePass: true,
      transparent: true, depthTest: false, depthWrite: false,
    });
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    return mesh;
  };
  const stems = new THREE.Mesh(stemGeometry(leaves, random), new THREE.MeshBasicMaterial({ color: '#2a4a1c', transparent: true, depthTest: false, depthWrite: false }));
  stems.renderOrder = 2;
  const group = new THREE.Group();
  group.add(make(true, 1), stems, make(false, 3));

  let time = 0, gust = { start: -1e4, strength: 0 };
  return {
    group,
    /** Wind time and gust for this frame, plus how wet the leaves look (0..1). */
    update(t, currentGust, wet = 0) {
      time = t; gust = currentGust;
      const wrapped = shaderTime(t, gust);
      uniforms.uTime.value = wrapped.time;
      uniforms.uGustStart.value = wrapped.gustStart;
      uniforms.uGustStrength.value = gust.strength;
      uniforms.uWet.value = wet;
    },
    /** Copy the springs' bends into the GPU buffer, uploading only the changed span. */
    applyBends() {
      const dirty = springs.takeDirty();
      if (!dirty.length) return;
      let lo = n, hi = -1;
      for (const i of dirty) { bend.array[i] = springs.angle[i]; lo = Math.min(lo, i); hi = Math.max(hi, i); }
      bend.clearUpdateRanges();
      bend.addUpdateRange(lo, hi - lo + 1);
      bend.needsUpdate = true;
    },
    /** Where leaf i's midpoint is right now (wall units), matching the shader. */
    midpoint(i) {
      const l = leaves[i];
      const deg = l.angle + l.swayAmp * swayAt(l.x, time, l.swayPhase)
        + l.gustAmp * gustAt(l.x, time, gust.start, gust.strength, l.gustDelay) + springs.angle[i];
      const len = (PETIOLE + 0.5 * BLADE) * l.scale, a = (deg * Math.PI) / 180;
      return { x: l.x + Math.sin(a) * len, y: l.y - Math.cos(a) * len };
    },
  };
}
