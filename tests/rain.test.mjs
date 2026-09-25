import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { SHADER_TIME_WRAP } from '../scene/src/wind.js';
import { createRain, dropScale, rainLean, roofPath, roofSpread, COUNTS } from '../scene/src/rain.js';
import { impact, veil } from '../scene/src/rain-weather.js';

const layers = () => {
  const rain = createRain(createRandom(1));
  const [streaks, streams, splashes, mist] = rain.group.children;
  return { rain, streaks, streams, splashes, mist };
};
const perDrop = (mesh, name) => {
  const a = mesh.geometry.getAttribute(name);
  return Array.from({ length: a.count }, (_, i) => Array.from(a.array.slice(i * a.itemSize, (i + 1) * a.itemSize)));
};

test('4,500 streaks in three depths (far, middle, near), 22 roof streams (a ribbon and 28 beads each) and 120 splashes of three droplets', () => {
  const { streaks, streams, splashes } = layers();
  assert.deepEqual([streaks, streams, splashes].map((m) => m.geometry.instanceCount), [4500, 22 * 29, 360]);
  const looks = perDrop(streaks, 'iLook');
  const drops = perDrop(streaks, 'iDrop').map(([, , speed], i) => ({ speed, width: looks[i][1] }));
  const depth = (lo, hi, w0, w1) => drops.filter((d) => d.speed >= lo && d.speed < hi && d.width >= w0 && d.width < w1).length;
  // Real rain: a drop crosses the wall (about 3 m) in about a third of a second; far ones look slower.
  assert.deepEqual([depth(1900, 2300, 0.7, 0.9), depth(2300, 2800, 0.9, 1.1), depth(2800, 3400, 1.1, 1.4)], [2250, 1440, 810]);
});

test('a streak is as long as its drop falls in one frame, so rain pours instead of hopping', () => {
  const { rain, streaks } = layers();
  const u = streaks.material.uniforms, wet = { level: 0.6, wet: 1, overcast: 1 }, gust = { start: -1e4, strength: 0 };
  assert.ok(Math.abs(u.uFrameDt.value - 1 / 30) < 1e-9, 'starts at 30 fps');
  for (let i = 0; i < 60; i++) rain.update(i / 15, i / 15, gust, wet, 1, 2, 1 / 15);
  assert.ok(Math.abs(u.uFrameDt.value - 1 / 15) < 1e-4, `follows the real frame time (15 fps): ${u.uFrameDt.value}`);
  rain.update(4, 4, gust, wet, 1, 2, 0);
  assert.ok(Math.abs(u.uFrameDt.value - 1 / 15) < 1e-4, 'a frozen frame (dt 0) keeps it');
  rain.update(5, 5, gust, wet, 1, 2, 1 / 30);
  assert.ok(u.uFrameDt.value > 1 / 30 && u.uFrameDt.value < 1 / 15, 'and it eases, so one slow frame does not stretch every streak');
});

test('each drop shows above its own threshold, so a level of 0.5 shows about half the rain', () => {
  const { streaks } = layers();
  const thresholds = perDrop(streaks, 'iLook').map(([, , threshold]) => threshold);
  assert.ok(thresholds.every((v) => v >= 0 && v < 1));
  const shown = thresholds.filter((v) => v < 0.5).length / thresholds.length;
  assert.ok(shown > 0.45 && shown < 0.55, `shown ${shown}`);
});

test('dry, the rain is hidden; raining, it gets the level and the wrapped fall time', () => {
  const { rain } = layers();
  const gust = { start: SHADER_TIME_WRAP + 1, strength: 0.9 };
  rain.update(5, 5, gust, { level: 0, wet: 0.4, overcast: 0 }, 1, 2);
  assert.equal(rain.group.visible, false, 'nothing falls at level 0, even while the leaves are still wet');
  rain.update(SHADER_TIME_WRAP + 5, SHADER_TIME_WRAP + 2, gust, { level: 0.6, wet: 1, overcast: 1 }, 1.3, 2);
  assert.equal(rain.group.visible, true);
  const u = rain.group.children[0].material.uniforms;
  assert.ok(Math.abs(u.uFall.value - 5) < 1e-9, 'fall time wraps');
  assert.deepEqual([u.uLevel.value, u.uPxPerUnit.value], [0.6, 2]);
});

test('the layers share one set of uniforms and draw after everything else: mist, splashes, streams, streaks on top', () => {
  const { streaks, streams, splashes, mist } = layers();
  for (const m of [streams, splashes, mist]) assert.equal(m.material.uniforms, streaks.material.uniforms);
  assert.deepEqual([mist.renderOrder, splashes.renderOrder, streams.renderOrder, streaks.renderOrder], [99, 100, 101, 102]);
});

test('the roof streams pour from the beam, one in each stretch of its length', () => {
  const { streams } = layers();
  const xs = [...new Set(perDrop(streams, 'iBead').map(([x]) => x))].sort((a, b) => a - b);
  assert.equal(xs.length, 22);
  const ribbons = perDrop(streams, 'iBead').filter(([, , k]) => k < 0);
  assert.equal(ribbons.length, 22, 'every stream starts as a ribbon at the edge');
  xs.forEach((x, i) => assert.ok(x >= (i * 1600) / 22 && x < ((i + 1) * 1600) / 22, `stream ${i} at x=${x}`));
});

test('the mist follows the overcast', () => {
  const { rain, mist } = layers();
  rain.update(1, 1, { start: -1e4, strength: 0 }, { level: 0.5, wet: 1, overcast: 0.7 }, 1, 2, 1 / 30);
  assert.equal(mist.material.uniforms.uOvercast.value, 0.7);
});

test('every layer draws both sides: wall y runs down, which flips the quads into back faces', async () => {
  const THREE = await import('../scene/vendor/three.module.js');
  const { rain } = layers();
  for (const mesh of rain.group.children) assert.equal(mesh.material.side, THREE.DoubleSide);
});

test('drops fall slower in a drizzle and a little faster in a monsoon, on their own clock', () => {
  const { rain, streaks } = layers();
  const u = streaks.material.uniforms, gust = { start: -1e4, strength: 0 };
  const fallFor = (size, seconds) => {
    const start = u.uFallClock.value;
    for (let i = 0; i < seconds * 30; i++) rain.update(i / 30, i / 30, gust, { level: 0.5, wet: 1, overcast: 1, size }, 1, 2, 1 / 30);
    return u.uFallClock.value - start;
  };
  assert.ok(Math.abs(fallFor(0.5, 1) - 1) < 0.02, 'steady rain falls at full speed');
  assert.ok(Math.abs(fallFor(0, 1) - 0.25) < 0.02, 'a drizzle at a quarter: 1.3 to 2.4 m/s, like real drizzle');
  assert.ok(Math.abs(fallFor(1, 1) - 1.12) < 0.02, 'a monsoon a little faster');
  const before = u.uFallClock.value;
  rain.update(5, 5, gust, { level: 0.5, wet: 1, overcast: 1, size: 1 }, 1, 2, 0);
  assert.equal(u.uFallClock.value, before, 'a frozen frame does not advance it');
  assert.equal(u.uSize.value, 1);
});

test('a drizzle is a veil of many fine, slow drops that lean further and drift with the air; steady rain and a monsoon keep theirs', () => {
  const near = (a, b) => Object.keys(b).every((k) => Math.abs(a[k] - b[k]) < 1e-9);
  assert.ok(near(dropScale(0.5), { speed: 1, width: 1, alpha: 1, count: 1, lean: 1, drift: 0 }), JSON.stringify(dropScale(0.5)));
  assert.ok(near(dropScale(1), { speed: 1.12, width: 1.3, alpha: 1, count: 1, lean: 1, drift: 0 }), JSON.stringify(dropScale(1)));
  const drizzle = dropScale(0);
  assert.ok(drizzle.count >= 2, `over twice the drops for its level: ${drizzle.count}`);
  assert.ok(drizzle.width <= 0.5, `hairlines: ${drizzle.width}`);
  assert.ok(drizzle.lean > 1.3, `light drops lean further in the same wind: ${drizzle.lean}`);
  assert.ok(drizzle.drift > 4, `and drift with the air: ${drizzle.drift} units`);
  let previous = dropScale(0);
  for (let size = 0.05; size <= 1; size += 0.05) {
    const d = dropScale(size);
    assert.ok(Math.abs(d.count - previous.count) < 0.2 && Math.abs(d.drift - previous.drift) < 1, `eases between modes at ${size}`);
    previous = d;
  }
});

test('the whole curtain leans at once as a gust passes, easing in and out, never past 25 degrees', () => {
  const calm = { start: -1e4, strength: 0 };
  for (let t = 0; t < 20; t += 0.1) {
    const lean = rainLean(t, calm, 1);
    assert.ok(lean >= 3 - 1e-9 && lean <= 9 + 1e-9, `a breeze: ${lean} at ${t}`);
  }
  const gust = { start: 10, strength: 1.2 };
  let most = 0, previous = rainLean(10, gust, 1);
  for (let t = 10; t < 20; t += 1 / 30) {
    const lean = rainLean(t, gust, 1);
    assert.ok(Math.abs(lean - previous) < 1, `jumped from ${previous} to ${lean} at ${t}`);
    most = Math.max(most, lean);
    previous = lean;
  }
  assert.ok(most >= 12, `a gust leans the rain well past the breeze: ${most}`);
  const monsoon = Array.from({ length: 200 }, (_, i) => rainLean(10 + i * 0.05, gust, 2.2));
  assert.ok(Math.max(...monsoon) >= 20 && Math.max(...monsoon) <= 25 + 1e-9, `a monsoon's gust at Wild: ${Math.max(...monsoon)}`);
});

test('water off the roof bends out in the wind and falls steeper as it speeds up, and breaks up the harder it blows', () => {
  const H = 964, tan15 = Math.tan((15 * Math.PI) / 180);
  assert.equal(roofPath(0, 15), 0, 'it leaves the edge where it hangs');
  assert.ok(roofPath(H / 4, 15) > 1.3 * (H / 4) * tan15, `bent out near the edge: ${roofPath(H / 4, 15)}`);
  assert.ok(Math.abs(roofPath(H, 15) - H * tan15) < 1, 'lands where a straight line would');
  for (const y of [0, 100, 500, H]) assert.equal(roofPath(y, 0), 0, 'straight down in still air');
  assert.ok(roofSpread(0) >= 10 && roofSpread(0) <= 20, `a little scatter in still air: ${roofSpread(0)}`);
  assert.ok(roofSpread(15) > 3 * roofSpread(0), `scattered in a gust: ${roofSpread(15)}`);
});

test('update hands the shaders how many drops show, how hard they hit, the drips, the lean and the veil', () => {
  const { rain, streaks } = layers();
  const u = streaks.material.uniforms, gust = { start: -1e4, strength: 0 };
  const rad = (deg) => (deg * Math.PI) / 180, close = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`);
  const drizzle = { level: 0.3, wet: 0.5, overcast: 0.5, size: 0 };
  rain.update(1, 1, gust, drizzle, 1, 2, 1 / 30);
  close(u.uShow.value, Math.min(1, 0.3 * dropScale(0).count), 'a drizzle shows more of its fine drops');
  close(u.uImpact.value, impact(drizzle), 'and they hit nothing');
  close(u.uDrip.value, (COUNTS.drips / COUNTS.rate) * 0.5, 'the roof drips as it gets wet');
  close(u.uLean.value, Math.atan(Math.tan(rad(rainLean(1, gust, 1))) * dropScale(0).lean), 'light drops lean further');
  close(u.uRoofLean.value, rad(0.6 * rainLean(1, gust, 1)), 'the roof water leans less than the rain');
  close(u.uVeil.value, 0, 'no veil');
  const monsoon = { level: 0.9, wet: 1, overcast: 1, size: 1 };
  rain.update(2, 2, gust, monsoon, 2, 2, 1 / 30);
  close(u.uShow.value, 0.9, 'a monsoon shows as much as it rains');
  close(u.uImpact.value, 0.9, 'and hits as hard');
  close(u.uLean.value, rad(rainLean(2, gust, 2)), 'big drops lean with the wind');
  close(u.uVeil.value, veil(0.9), 'behind a veil');
});
