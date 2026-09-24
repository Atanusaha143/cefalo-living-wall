import test from 'node:test';
import assert from 'node:assert/strict';
import { createSprings, SPRING } from '../scene/src/leaf-springs.js';

// One upright leaf: stem base at (100, 100), midpoint 24 units above it.
const upright = () => [{ x: 100, y: 100, midX: 100, midY: 76, ux: 1, uy: 0 }];
// step() caps one call at 0.25 s (a stall must not become a burst), so simulate frame by frame.
const run = (s, seconds, fps = 60) => { for (let i = 0; i < seconds * fps; i++) s.step(1 / fps); };

test('bends away from a cursor on its right', () => {
  const s = createSprings(upright());
  s.setPointer(115, 76, 0);
  run(s, 0.5);
  assert.ok(s.angle[0] < -5, `angle ${s.angle[0]}`);
});

test('bends away from a cursor on its left', () => {
  const s = createSprings(upright());
  s.setPointer(85, 76, 0);
  run(s, 0.5);
  assert.ok(s.angle[0] > 5, `angle ${s.angle[0]}`);
});

test('ignores a cursor out of reach', () => {
  const s = createSprings(upright());
  s.setPointer(400, 400, 0);
  run(s, 0.5);
  assert.equal(s.angle[0], 0);
});

test('returns to rest within 2 s after the cursor leaves', () => {
  const s = createSprings(upright());
  s.setPointer(110, 76, 0);
  run(s, 0.5);
  s.pointerOut();
  run(s, 2);
  assert.ok(Math.abs(s.angle[0]) < 0.05);
  assert.equal(s.activeCount, 0);
});

test('a cursor right beside a leaf bends it hard (lively, user choice)', () => {
  const s = createSprings(upright());
  s.setPointer(110, 76, 0);
  run(s, 1);
  assert.ok(s.angle[0] < -40, `angle ${s.angle[0]}`);
});

test('a calmer motion setting bends leaves less', () => {
  const calm = createSprings(upright()), wild = createSprings(upright());
  calm.setStrength(0.35); wild.setStrength(1.6);
  for (const s of [calm, wild]) { s.setPointer(110, 76, 0); run(s, 1); }
  assert.ok(Math.abs(calm.angle[0]) < 25 && Math.abs(wild.angle[0]) > 50, `calm ${calm.angle[0]} wild ${wild.angle[0]}`);
});

test('the cursor reaches leaves 120 units away', () => {
  const s = createSprings(upright());
  s.setPointer(220, 76, 0);
  run(s, 1);
  assert.ok(s.angle[0] < -0.5, `angle ${s.angle[0]}`);
});

test('never exceeds the clamp, even when flicked hard', () => {
  const s = createSprings(upright());
  let max = 0;
  for (let i = 0; i < 200; i++) {
    s.setPointer(60 + (i % 2) * 80, 76, i / 60);
    s.step(1 / 60);
    max = Math.max(max, Math.abs(s.angle[0]));
  }
  assert.ok(max <= SPRING.clamp, `max ${max}`);
});

test('same result at 15, 30 and 60 fps', () => {
  const at = (fps) => {
    const s = createSprings(upright());
    s.setPointer(112, 80, 0);
    run(s, 1, fps);
    return s.angle[0];
  };
  const a60 = at(60);
  assert.ok(Math.abs(at(30) - a60) < 1e-4 && Math.abs(at(15) - a60) < 1e-4);
});

test('a held leaf stays bent until released', () => {
  const s = createSprings(upright());
  s.setHold(0, 4);
  run(s, 3);
  assert.ok(Math.abs(s.angle[0] - 4) < 0.1);
  s.setHold(0, 0);
  run(s, 3);
  assert.ok(Math.abs(s.angle[0]) < 0.05);
});

test('one long step is capped at 0.25 s', () => {
  const a = createSprings(upright()), b = createSprings(upright());
  a.setPointer(110, 76, 0); b.setPointer(110, 76, 0);
  a.step(5); run(b, 0.25);
  assert.equal(a.angle[0], b.angle[0]);
});

test('reports which leaves changed', () => {
  const s = createSprings(upright());
  assert.deepEqual(s.takeDirty(), []);
  s.setPointer(110, 76, 0);
  s.step(1 / 60);
  assert.deepEqual(s.takeDirty(), [0]);
});
