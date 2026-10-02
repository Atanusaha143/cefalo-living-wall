import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { SHADER_TIME_WRAP, GUST_CROSSING, createWind } from '../scene/src/wind.js';
import { createSnow, flakeScale, breezeSpeed, gustSpeed, gustAir, gustDrift, GUST_DRIFT, COUNTS, CLOSE, DEPTHS, CARRIED, WIND, SPAN, BLOWN } from '../scene/src/snow.js';
import { whiteout } from '../scene/src/snow-weather.js';

const calm = { start: -1e4, strength: 0 };
const steady = { level: 0.55, cover: 0.5, chill: 0.85, size: 0.5, storm: 0.2, wet: 0 };
const layers = () => {
  const snow = createSnow(createRandom(1));
  const [flakes, puffs, haze] = snow.group.children;
  return { snow, flakes, puffs, haze };
};
const perFlake = (mesh, name) => {
  const a = mesh.geometry.getAttribute(name);
  return Array.from({ length: a.count }, (_, i) => Array.from(a.array.slice(i * a.itemSize, (i + 1) * a.itemSize)));
};

test('9,800 flakes in three depths and 200 close to the eye; 30 puffs of 14 clumps and 4 powder discs', () => {
  const { flakes, puffs } = layers();
  assert.equal(flakes.geometry.instanceCount, COUNTS.flakes + CLOSE.count);
  assert.equal(puffs.geometry.instanceCount, COUNTS.puffs * (COUNTS.clumps + COUNTS.powder));
  const fall = perFlake(flakes, 'iFall'), look = perFlake(flakes, 'iLook');
  const count = (depth) => fall.filter((f) => f[3] === depth).length;
  assert.deepEqual([0, 1, 2, 3].map(count), [4900, 3430, 1470, 200]);
  // Real snow: about 1 m/s, so a flake takes 3-6 s to cross the wall; nearer ones bigger and faster.
  fall.forEach(([, , speed, depth], i) => {
    const d = depth < 3 ? DEPTHS[depth] : CLOSE, [size, opacity] = look[i];
    assert.ok(speed >= d.speed[0] && speed < d.speed[1] && size >= d.size[0] && size < d.size[1], `flake ${i}`);
    assert.ok(opacity >= d.opacity[0] && opacity < d.opacity[1], `flake ${i} opacity ${opacity}`);
  });
});

test('each flake shows above its own threshold, so a level of 0.5 shows about half the snow', () => {
  const thresholds = perFlake(layers().flakes, 'iLook').map(([, , threshold]) => threshold);
  const shown = thresholds.filter((v) => v < 0.5).length / thresholds.length;
  assert.ok(shown > 0.45 && shown < 0.55, `shown ${shown}`);
});

test("Flurries' flakes are big, lazy and slow; a blizzard's small and fast, fluttering less", () => {
  const near = (a, b) => Object.keys(b).every((k) => Math.abs(a[k] - b[k]) < 1e-9);
  assert.ok(near(flakeScale(0.5), { size: 1, speed: 1, flutter: 1, count: 0.41 }), JSON.stringify(flakeScale(0.5)));
  assert.ok(near(flakeScale(0), { size: 1.4, speed: 0.7, flutter: 1.3, count: 0.18 }), JSON.stringify(flakeScale(0)));
  assert.ok(near(flakeScale(1), { size: 0.7, speed: 1.5, flutter: 0.5, count: 1.05 }), JSON.stringify(flakeScale(1)));
});

test('how much snow shows follows the mode, not the size of its flakes: Flurries sparse, a blizzard dense', async () => {
  // At each mode's base level. Measured on screen at acceptance (both displays): Flurries cover a
  // third to a half as much of the view as steady snow, a blizzard about three times as much.
  const { SNOW_MODES } = await import('../scene/src/snow-weather.js');
  const { snow, flakes } = layers();
  const shows = (mode) => {
    const m = SNOW_MODES[mode];
    snow.update(1, 1, calm, { level: m.base, cover: 0.5, chill: m.chill, size: m.size, storm: m.storm }, 1.3, 2, 1 / 30);
    return flakes.material.uniforms.uShow.value;
  };
  const [flurries, steady, blizzard] = [1, 2, 3].map(shows);
  assert.ok(flurries / steady > 0.15 && flurries / steady < 0.25, `Flurries show ${flurries}, steady snow ${steady}`);
  assert.ok(blizzard / steady > 4 && blizzard / steady < 4.5, `a blizzard shows ${blizzard}`);
  assert.ok(blizzard <= 1, 'never more than every flake');
});

test('the wind carries every depth at the same angle: flurries lean a little, a blizzard far over, more in a gust', () => {
  // A mode's storm and size: flurries 0 and 0, steady 0.2 and 0.5, a blizzard 1 and 1 (snow-weather.js).
  const STORM = { 0: 0, 0.5: 0.2, 1: 1 };
  // Sideways: the breeze, and at a gust's peak (strength 1.2) its air too.
  const lean = (size, gust) => {
    const sideways = breezeSpeed(1.3, STORM[size]) + (gust ? gustSpeed(1.3, STORM[size]) * gust.strength : 0);
    return (Math.atan(sideways / (210 * flakeScale(size).speed)) * 180) / Math.PI;
  };
  const calm = null, gust = { strength: 1.2 };
  // At Lively (strength 1.3): about 10, 17 and 35 degrees in the breeze (the spec's §3.2).
  assert.ok(Math.abs(lean(0, calm) - 10) < 1.5, `flurries: ${lean(0, calm)}`);
  assert.ok(Math.abs(lean(0.5, calm) - 17) < 1.5, `steady snow: ${lean(0.5, calm)}`);
  assert.ok(Math.abs(lean(1, calm) - 35) < 2, `a blizzard: ${lean(1, calm)}`);
  assert.ok(lean(1, gust) > lean(1, calm) + 10, `a blizzard's gust: ${lean(1, gust)}`);
  assert.equal(CARRIED[1], 1, 'the middle depth is carried as the carry says');
  assert.ok(CARRIED[0] < 1 && CARRIED[2] > 1 && CARRIED[3] > CARRIED[2], 'far flakes less, near ones more: as far as each falls');
});

test("the carry wraps with the flakes' span, so days of wind never lose precision or jump", () => {
  const { snow, flakes } = layers();
  const u = flakes.material.uniforms, gust = { start: -1e4, strength: 0 };
  for (let i = 0; i < 30 * 600; i++) snow.update(i / 30, i / 30, gust, { ...steady, storm: 1 }, 1.7, 2, 1 / 30);
  for (const c of u.uCarry.value.toArray()) assert.ok(c >= 0 && c < 2100, `carry ${c}`);
  const before = u.uCarry.value.toArray();
  snow.update(600, 600, gust, steady, 1.7, 2, 0);
  assert.deepEqual(u.uCarry.value.toArray(), before, 'a frozen frame does not move the snow');
  assert.ok(Math.abs(u.uCarrySpeed.value.y - breezeSpeed(1.7, 0.2)) < 1e-9, 'the middle depth drifts at the breeze');
});

test('with no snow and no puff in the air, the snow is hidden; snowing, it gets the level, the wrapped time and the veil', () => {
  const { snow, flakes } = layers();
  snow.update(5, 5, calm, { level: 0, cover: 0.8, chill: 0, size: 0.5, storm: 0 }, 1, 2, 1 / 30);
  assert.equal(snow.group.visible, false, 'nothing falls at level 0, even with snow still settled');
  const blizzard = { level: 0.9, cover: 1, chill: 1, size: 1, storm: 1 };
  snow.update(SHADER_TIME_WRAP + 5, SHADER_TIME_WRAP + 2, { start: SHADER_TIME_WRAP + 1, strength: 0.9 }, blizzard, 1.3, 2, 1 / 30);
  assert.equal(snow.group.visible, true);
  const u = flakes.material.uniforms;
  assert.ok(Math.abs(u.uFall.value - 5) < 1e-9 && Math.abs(u.uTime.value - 2) < 1e-9, 'both clocks wrap');
  assert.deepEqual([u.uShow.value, u.uSize.value, u.uWhiteout.value], [Math.min(1, 0.9 * flakeScale(1).count), flakeScale(1).size, whiteout(blizzard)]);
  assert.ok(Math.abs(u.uGustSpeed.value - gustSpeed(1.3, 1) * 0.9) < 1e-9, 'a gust carries a blizzard hardest');
  assert.ok(Math.abs(u.uSwirl.value - 1.3 * (WIND.swirl + WIND.swirlStorm)) < 1e-9, 'and swirls it most');
  snow.update(SHADER_TIME_WRAP + 6, SHADER_TIME_WRAP + 3, calm, { ...steady, size: 0 }, 1, 2, 1 / 30);
  assert.equal(u.uHaze.value, 0, 'flurries fall in clear air');
});

test('a shed takes a puff until it has fallen; the others stay free, and the snow shows while one falls', () => {
  const { snow, puffs } = layers();
  snow.update(10, 10, calm, { ...steady, level: 0 }, 1, 2, 1 / 30);
  snow.shed([{ x: 400, y: 300, amount: 0.8, flick: 12 }], 10);
  assert.equal(snow.freePuffs, COUNTS.puffs - 1);
  const at = puffs.geometry.getAttribute('iPuff');
  assert.deepEqual(Array.from(at.array.slice(0, 4)).map((v) => +v.toFixed(3)), [400, 300, 10, 0.8]);
  snow.update(10.5, 10.5, calm, { ...steady, level: 0 }, 1, 2, 1 / 30);
  assert.equal(snow.group.visible, true, 'the snow has stopped, but the puff is still falling');
  snow.update(11, 11, calm, { ...steady, level: 0 }, 1, 2, 1 / 30);
  assert.equal(snow.freePuffs, COUNTS.puffs, 'fallen within 0.9 s');
  assert.equal(snow.group.visible, false);
  snow.shed(Array.from({ length: 40 }, () => ({ x: 1, y: 1, amount: 1, flick: 0 })), 12);
  assert.equal(snow.freePuffs, 0, 'never more than 30 at once');
});

test('every layer draws both sides and draws after the rain: haze, puffs, flakes on top', async () => {
  const THREE = await import('../scene/vendor/three.module.js');
  const { flakes, puffs, haze } = layers();
  for (const m of [flakes, puffs, haze]) assert.equal(m.material.side, THREE.DoubleSide);
  assert.deepEqual([haze.renderOrder, puffs.renderOrder, flakes.renderOrder], [103, 104, 105]);
  for (const m of [puffs, haze]) assert.equal(m.material.uniforms, flakes.material.uniforms);
});

test("a blizzard's blowing veil drifts a whole number of noise periods each time the carry wraps, so it never jumps", () => {
  const periods = (SPAN * BLOWN.drift) / BLOWN.scale;
  assert.ok(Math.abs(periods - Math.round(periods)) < 1e-9, `${periods} periods per wrap`);
  // GLSL does not run in Node: this checks the shader uses those values (the smoke test draws it).
  const { haze } = layers();
  assert.ok(haze.material.fragmentShader.includes(`(p - vec2(blowing * ${BLOWN.drift.toFixed(1)}, 0.0)) / ${BLOWN.scale.toFixed(1)}`));
});

test('shed snow blows with the wind as it falls, as the flakes do, clumps and powder alike', () => {
  // GLSL does not run in Node: this checks the puffs read the carry's speed before their
  // clumps and powder part ways (the smoke test draws them).
  const vertex = layers().puffs.material.vertexShader, body = vertex.slice(vertex.indexOf('void main()'));
  const blown = body.indexOf('p.x += (uCarrySpeed.y + uGustSpeed * gustAir(gustTau(iPuff.x)) * uWindRate) * tau;');
  assert.ok(blown > 0, 'the puff is carried at the middle depth\'s speed: the breeze and a gust\'s air');
  assert.ok(blown < body.indexOf('if (powder)'), 'before the clumps and the powder part ways');
});

test("a gust's air only blows downwind: it rises over a second and eases off over three, and how far it carries is its integral", () => {
  for (let tau = -1; tau < 6; tau += 0.01) assert.ok(gustAir(tau) >= 0 && gustAir(tau) <= 1, `air ${gustAir(tau)} at ${tau}`);
  assert.equal(gustAir(1), 1);
  assert.deepEqual([gustAir(0), gustAir(4), gustDrift(0), gustDrift(9)], [0, 0, 0, GUST_DRIFT]);
  let integral = 0, previous = 0;
  for (let tau = 0; tau < 4.5; tau += 0.001) {
    integral += gustAir(tau + 0.0005) * 0.001;
    assert.ok(Math.abs(gustDrift(tau + 0.001) - integral) < 1e-4, `drift ${gustDrift(tau + 0.001)} vs ${integral} at ${tau}`);
    assert.ok(gustDrift(tau) >= previous - 1e-12, 'never back');
    previous = gustDrift(tau);
  }
  assert.equal(GUST_DRIFT, 2, 'a gust carries as far as two seconds at its peak');
});

test('in a gust a flake is carried downwind, never back, and each passing gust joins the drift without a jump', () => {
  // A middle-depth flake mid-wall, moved as the flake shader moves it: the carry, and the
  // current gust's drift where it is (gustDrift at its gust time).
  for (const [storm, size] of [[0, 0], [0.2, 0.5], [1, 1]]) {
    const { snow, flakes } = layers(), u = flakes.material.uniforms, wind = createWind(createRandom(4));
    const weather = { level: 0.6, cover: 0.5, chill: 0.8, size, storm };
    let previous = null, fastest = 0, slowest = Infinity, windTime = 0;
    for (let i = 0; i < 30 * 60; i++) {
      windTime += (1.3 * 1.2) / 30;   // Lively, a little boosted
      snow.update(i / 30, windTime, wind.current(windTime), weather, 1.3, 2, 1 / 30);
      const tau = u.uTime.value - u.uGustStart.value - 0.5 * GUST_CROSSING;
      const x = u.uCarry.value.y + u.uGustSpeed.value * gustDrift(tau);
      if (previous !== null) {
        let step = x - previous;
        if (step < -SPAN / 2) step += SPAN;   // the carry wrapped
        assert.ok(step > -1e-6, `storm ${storm}: moved ${step} upwind at ${i / 30} s`);
        assert.ok(step < 40, `storm ${storm}: jumped ${step} at ${i / 30} s`);
        fastest = Math.max(fastest, step * 30); slowest = Math.min(slowest, step * 30);
      }
      previous = x;
    }
    assert.ok(fastest > 2 * slowest, `storm ${storm}: a gust carries it at least twice as fast as the breeze (${slowest} to ${fastest} units/s)`);
  }
});

test('the flakes, the blizzard\'s veil and the shed puffs all move with the gust\'s air, not the leaves\' springy gust', () => {
  // GLSL does not run in Node: this checks each shader reads the air (the smoke test draws them).
  const { flakes, puffs, haze } = layers();
  assert.ok(flakes.material.vertexShader.includes('gustDrift(') && !flakes.material.vertexShader.includes('gustAt('), 'flakes');
  assert.ok(haze.material.fragmentShader.includes('gustDrift('), 'the veil');
  assert.ok(puffs.material.vertexShader.includes('gustAir('), 'the puffs');
});
