import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { generateLeaves } from '../scene/src/leaf-layout.js';
import { createSprings } from '../scene/src/leaf-springs.js';
import { createLeaves } from '../scene/src/leaves.js';
import { createButterflies } from '../scene/src/butterflies.js';

// Three.js draws every opaque object first and every transparent one after, sorting by
// renderOrder only within each list. This mirrors that, so tests see the real order.
function drawOrder(root) {
  const meshes = [];
  root.traverse((o) => { if (o.material) meshes.push(o); });
  const by = (list) => list.sort((a, b) => a.renderOrder - b.renderOrder);
  return [...by(meshes.filter((m) => !m.material.transparent)), ...by(meshes.filter((m) => m.material.transparent))];
}

const green = () => {
  const width = 40, height = 27, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([60, 110, 40, 255], i * 4);
  return { data, width, height };
};

test('leaf shadows are really drawn under the stems and leaves', () => {
  const data = generateLeaves(createRandom(7));
  const { group } = createLeaves(data, green(), createRandom(2), createSprings(data));
  const [shadow, stems, blades] = group.children;
  const order = drawOrder(group);
  assert.ok(order.indexOf(shadow) < order.indexOf(stems) && order.indexOf(stems) < order.indexOf(blades),
    `drawn as ${order.map((m) => m.renderOrder).join(', ')}`);
});

test('butterfly shadows are really drawn under the butterflies', () => {
  const b = createButterflies();
  b.update([{ id: 1, species: 'orange', x: 500, y: 400, heading: 0, flap: 1, state: 'wandering' }]);
  const order = drawOrder(b.group);
  const lastShadow = Math.max(...order.map((m, i) => (m.renderOrder < 50 ? i : -1)));
  const firstBody = order.findIndex((m) => m.renderOrder >= 50);
  assert.ok(lastShadow < firstBody, `drawn as ${order.map((m) => m.renderOrder).join(', ')}`);
});

test('rain is drawn over every other layer', async () => {
  const THREE = await import('../scene/vendor/three.module.js');
  const { createLights } = await import('../scene/src/lights.js');
  const { createLogoGlow } = await import('../scene/src/logo-glow.js');
  const { createRain } = await import('../scene/src/rain.js');
  const data = generateLeaves(createRandom(7));
  const root = new THREE.Group();
  const butterflies = createButterflies();
  butterflies.update([{ id: 1, species: 'orange', x: 500, y: 400, heading: 0, flap: 1, state: 'wandering' }]);
  const rain = createRain(createRandom(3));
  root.add(createLeaves(data, green(), createRandom(2), createSprings(data)).group, butterflies.group,
    createLights(createRandom(4)).group, createLogoGlow(new THREE.Texture()).mesh, rain.group);
  const order = drawOrder(root);
  const firstRain = order.findIndex((m) => rain.group.children.includes(m));
  assert.equal(firstRain, order.length - rain.group.children.length, `drawn as ${order.map((m) => m.renderOrder).join(', ')}`);
});

test('snow is drawn over every other layer, the rain too (for the moment of sleet as one gives way to the other)', async () => {
  const THREE = await import('../scene/vendor/three.module.js');
  const { createRain } = await import('../scene/src/rain.js');
  const { createSnow } = await import('../scene/src/snow.js');
  const data = generateLeaves(createRandom(7));
  const root = new THREE.Group();
  const snow = createSnow(createRandom(6));
  root.add(createLeaves(data, green(), createRandom(2), createSprings(data)).group, createRain(createRandom(3)).group, snow.group);
  const order = drawOrder(root);
  const firstSnow = order.findIndex((m) => snow.group.children.includes(m));
  assert.equal(firstSnow, order.length - snow.group.children.length, `drawn as ${order.map((m) => m.renderOrder).join(', ')}`);
});
