import * as THREE from '../vendor/three.module.js';

// Draws what butterfly-brain.js decides: up to two butterflies, each a body and two
// hinged wing pairs that fold toward the viewer to flap, plus a soft shadow.
const PALETTES = {
  orange: { inner: '#ffb347', outer: '#e06a12', edge: '#241208', spot: '#ffffff', body: '#241208' },
  cream: { inner: '#fffaf0', outer: '#eadba6', edge: '#5a4a2a', spot: '#3a3020', body: '#3a3020' },
};
const MAX_FOLD = 1.35;   // radians of wing fold when fully closed

// One side's wings, head toward +x, wings toward +y (world, y up).
function wingShapes() {
  const fore = new THREE.Shape();
  fore.moveTo(1, 1);
  fore.bezierCurveTo(3, 9, 7, 15, 7.5, 18.5);
  fore.bezierCurveTo(3, 19.5, -3.5, 15.5, -4.5, 10.5);
  fore.bezierCurveTo(-4.5, 6, -2.5, 3, 1, 1);
  const hind = new THREE.Shape();
  hind.moveTo(-1, 1);
  hind.bezierCurveTo(-3, 6, -6, 11, -9.5, 11.5);
  hind.bezierCurveTo(-12.5, 11, -11.5, 5.5, -7.5, 2.5);
  hind.bezierCurveTo(-5, 1, -3, 0.6, -1, 1);
  return [fore, hind];
}

function wingMesh(shape, palette, shadow, order) {
  const g = new THREE.ShapeGeometry(shape, 8);
  const inner = new THREE.Color(palette.inner), outer = new THREE.Color(palette.outer), c = new THREE.Color();
  const p = g.getAttribute('position'), colours = [];
  for (let i = 0; i < p.count; i++) {
    c.copy(inner).lerp(outer, Math.min(1, Math.hypot(p.getX(i), p.getY(i)) / 17));
    colours.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const fill = new THREE.Mesh(g, shadow
    ? new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthTest: false, depthWrite: false })
    : new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
  fill.renderOrder = order + 1;
  if (shadow) return [fill];
  const edge = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: palette.edge, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
  edge.scale.setScalar(1.1);
  edge.renderOrder = order;
  return [edge, fill];
}

function makeRig(species, shadow) {
  const palette = PALETTES[species], order = shadow ? 4 : 5;
  const root = new THREE.Group(), sides = [];
  for (const sign of [1, -1]) {
    const side = new THREE.Group();
    for (const shape of wingShapes()) for (const mesh of wingMesh(shape, palette, shadow, order * 10)) side.add(mesh);
    if (!shadow) {
      const spot = new THREE.Mesh(new THREE.CircleGeometry(0.8, 8), new THREE.MeshBasicMaterial({ color: palette.spot, depthTest: false, depthWrite: false }));
      spot.position.set(5.8, 16.6, 0);
      spot.renderOrder = order * 10 + 2;
      side.add(spot);
    }
    side.scale.y = sign;          // the -y side is a mirror image
    sides.push(side);
    root.add(side);
  }
  if (!shadow) {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 11, 4, 8), new THREE.MeshBasicMaterial({ color: palette.body, depthTest: false, depthWrite: false }));
    body.rotation.z = Math.PI / 2;
    body.renderOrder = order * 10 + 3;
    root.add(body);
  }
  return { root, sides };
}

export function createButterflies() {
  const group = new THREE.Group();
  const rigs = new Map();                       // flyer id -> { main, shadow }
  const pool = { orange: [], cream: [] };
  const take = (species) => pool[species].pop() ?? (() => {
    const pair = { species, main: makeRig(species, false), shadow: makeRig(species, true) };
    group.add(pair.shadow.root, pair.main.root);
    return pair;
  })();
  const pose = (rig, b, dx, dy) => {
    rig.root.visible = true;
    rig.root.position.set(b.x + dx, -b.y + dy, 0);
    rig.root.rotation.z = -b.heading;
    const fold = (1 - b.flap) * MAX_FOLD;
    rig.sides[0].rotation.x = -fold;
    rig.sides[1].rotation.x = fold;
  };
  return {
    group,
    /** flyers: butterfly-brain's list. */
    update(flyers) {
      const seen = new Set();
      for (const b of flyers) {
        seen.add(b.id);
        if (!rigs.has(b.id)) rigs.set(b.id, take(b.species));
        const pair = rigs.get(b.id);
        const lift = b.state === 'resting' ? 1.5 : 4;   // the shadow falls further while flying
        pose(pair.main, b, 0, 0);
        pose(pair.shadow, b, lift, -lift * 1.6);
      }
      for (const [id, pair] of rigs) {
        if (seen.has(id)) continue;
        pair.main.root.visible = pair.shadow.root.visible = false;
        pool[pair.species].push(pair);
        rigs.delete(id);
      }
    },
  };
}
