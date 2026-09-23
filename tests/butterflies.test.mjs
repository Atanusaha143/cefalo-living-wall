import test from 'node:test';
import assert from 'node:assert/strict';
import { createButterflies } from '../scene/src/butterflies.js';

const flyer = (id, species, flap = 1) => ({ id, species, x: 500, y: 400, heading: 0.5, flap, state: 'wandering' });
const visible = (group) => group.children.filter((c) => c.visible).length;

test('each flyer gets a butterfly and a shadow; leavers are hidden and reused', () => {
  const b = createButterflies();
  b.update([flyer(1, 'orange'), flyer(2, 'cream')]);
  assert.equal(visible(b.group), 4);
  b.update([flyer(2, 'cream')]);
  assert.equal(visible(b.group), 2);
  const built = b.group.children.length;
  b.update([flyer(2, 'cream'), flyer(3, 'orange')]);
  assert.equal(b.group.children.length, built, 'the orange rig was reused');
  b.update([]);
  assert.equal(visible(b.group), 0);
});

test('wings fold toward the viewer as they close', () => {
  const b = createButterflies();
  b.update([flyer(1, 'orange', 1)]);
  const main = b.group.children.find((c) => c.visible && c.children.length === 3);
  assert.ok(Math.abs(main.children[0].rotation.x) < 1e-9, "open wings lie flat");
  b.update([flyer(1, 'orange', 0)]);
  assert.ok(Math.abs(main.children[0].rotation.x + 1.35) < 1e-9 && Math.abs(main.children[1].rotation.x - 1.35) < 1e-9);
});
