import test from 'node:test';
import assert from 'node:assert/strict';
import { coverFit, toWall } from '../scene/src/fit.js';
import { WALL_W, WALL_H, LIGHTS } from '../scene/src/wall.js';

test('a 16:9 screen shows the full width and keeps the downlights in view', () => {
  const fit = coverFit(1920, 1080);
  assert.equal(fit.w, WALL_W);
  assert.ok(Math.abs(fit.h - 900) < 0.01);
  for (const [, y] of LIGHTS) assert.ok(y > fit.y0 && y < fit.y0 + fit.h, `light at y=${y} cropped`);
});

test('a screen narrower than 3:2 shows the full height', () => {
  const fit = coverFit(1200, 1000);
  assert.equal(fit.h, WALL_H);
  assert.equal(fit.y0, 0);
  assert.ok(Math.abs(fit.x0 - (WALL_W - fit.w) / 2) < 1e-9);
});

test('viewport corners map to the visible rectangle', () => {
  const fit = coverFit(1512, 982);
  const tl = toWall(fit, 0, 0, 1512, 982), br = toWall(fit, 1512, 982, 1512, 982);
  assert.deepEqual(tl, { x: fit.x0, y: fit.y0 });
  assert.ok(Math.abs(br.x - (fit.x0 + fit.w)) < 1e-9 && Math.abs(br.y - (fit.y0 + fit.h)) < 1e-9);
});
