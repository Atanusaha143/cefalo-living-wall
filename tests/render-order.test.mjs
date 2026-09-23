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
