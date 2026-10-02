import test from 'node:test';
import assert from 'node:assert/strict';
import { noteAt, onFace, stamp, NOTES, HUD } from '../scene/src/hud.js';
import { FACE, LOGO_BOX } from '../scene/src/wall.js';
import { EYE_BOX } from '../scene/src/watcher.js';

test('the notes take turns, each for a while', () => {
  assert.equal(noteAt(0), NOTES[0]);
  assert.equal(noteAt(HUD.every - 0.1), NOTES[0]);
  assert.equal(noteAt(HUD.every), NOTES[1]);
  assert.equal(noteAt(HUD.every * NOTES.length), NOTES[0]);
});

test('HR notices: a cursor on his face, a minute of idling, the weather', () => {
  assert.match(noteAt(0, { near: true }), /step back/);
  assert.equal(noteAt(0, { idle: 185 }), 'Subject idle for 3 min');
  assert.equal(noteAt(0, { idle: 30 }), NOTES[0]);
  assert.match(noteAt(HUD.every, { rain: 2 }), /Rain/);
  assert.match(noteAt(HUD.every, { snow: 1 }), /Snow/);
});

test('his face is where the photo has him: over the sign, round his eyes', () => {
  assert.ok(onFace({ x: FACE.cx, y: FACE.cy }));
  assert.ok(!onFace(null) && !onFace({ x: 200, y: 800 }));
  assert.ok(FACE.cy + FACE.ry < LOGO_BOX.y0, 'his head clears the sign');
  for (const [x, y] of [[EYE_BOX.x0, EYE_BOX.y0], [EYE_BOX.x1, EYE_BOX.y1]]) assert.ok(onFace({ x, y }), `eye box corner ${x},${y}`);
});

test('the camera prints the time as CCTV does', () => {
  assert.equal(stamp(new Date(2026, 9, 2, 7, 5, 9)), '2026-10-02 07:05:09');
});
