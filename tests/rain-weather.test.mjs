import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { createRainWeather, stormBoost, knockCount, impact, veil, RAIN, MODES } from '../scene/src/rain-weather.js';

const DT = 1 / 30;
const [, DRIZZLE, STEADY, MONSOON] = [0, 1, 2, 3];
/** Every frame's weather from `from` to `to` seconds. */
function run(weather, from, to) {
  const out = [];
  for (let t = from; t < to; t += DT) out.push({ t, ...weather.at(t) });
  return out;
}
const mean = (frames, key = 'level') => frames.reduce((s, w) => s + w[key], 0) / frames.length;

test('dry until a rain mode is chosen', () => {
  const weather = createRainWeather(createRandom(1));
  for (const w of run(weather, 0, 30)) assert.deepEqual([w.level, w.wet, w.overcast], [0, 0, 0], `at ${w.t}`);
  assert.equal(weather.mode, 0);
});

test('steady rain builds up over about 6 s, then stays between a light rain and full', () => {
  const weather = createRainWeather(createRandom(1));
  weather.at(10);
  weather.setMode(STEADY, 10);
  const frames = run(weather, 10, 10 + 30 * 60);
  const early = frames.find((w) => w.t >= 11);
  assert.ok(early.level > 0 && early.level < MODES[STEADY].floor, `1 s in: ${early.level}`);
  for (const w of frames.filter((f) => f.t >= 10 + RAIN.buildUp + DT)) {
    assert.ok(w.level >= MODES[STEADY].floor - 1e-9 && w.level <= 1, `level ${w.level} at ${w.t}`);
  }
});

test('Drizzle is lighter than Steady rain, and a Monsoon heavier still', () => {
  const levels = [DRIZZLE, STEADY, MONSOON].map((mode) => {
    const weather = createRainWeather(createRandom(2));
    weather.setMode(mode, 0);
    return run(weather, 20, 20 + 10 * 60);
  });
  const [drizzle, steady, monsoon] = levels.map((frames) => mean(frames));
  assert.ok(drizzle < steady - 0.15 && steady < monsoon - 0.15, `means ${drizzle} ${steady} ${monsoon}`);
  assert.ok(levels[0].every((w) => w.level < 0.5), 'a drizzle never gets heavy');
  assert.ok(levels[2].every((w) => w.level >= MODES[MONSOON].floor - 1e-9), 'a monsoon never lets up');
});

test('a heavier burst comes within the first 9 minutes of steady rain', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const weather = createRainWeather(createRandom(seed));
    weather.setMode(STEADY, 0);
    const heaviest = Math.max(...run(weather, 0, 9 * 60).map((w) => w.level));
    assert.ok(heaviest >= 0.8, `seed ${seed}: heaviest ${heaviest}`);
  }
});

test('it never repeats: two 5-minute stretches of rain differ', () => {
  const weather = createRainWeather(createRandom(3));
  weather.setMode(STEADY, 0);
  const a = run(weather, 60, 360).map((w) => w.level), b = run(weather, 360, 660).map((w) => w.level);
  const diff = a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
  assert.ok(diff > 0.03, `mean difference ${diff}`);
});

test('switching modes eases over a few seconds, never jumping', () => {
  const weather = createRainWeather(createRandom(1));
  weather.setMode(STEADY, 0);
  run(weather, 0, 60);
  weather.setMode(MONSOON, 60);
  let previous = weather.at(60).level;
  const frames = run(weather, 60, 80);
  for (const w of frames) {
    assert.ok(Math.abs(w.level - previous) < 0.05, `jump from ${previous} to ${w.level} at ${w.t}`);
    previous = w.level;
  }
  assert.ok(mean(frames.filter((w) => w.t >= 72)) >= MODES[MONSOON].floor, 'a monsoon within about 12 s');
  assert.equal(weather.mode, MONSOON);
});

test('switched off, it thins out within 8 s, then the leaves dry within a minute', () => {
  const weather = createRainWeather(createRandom(1));
  weather.setMode(STEADY, 0);
  run(weather, 0, 120);
  assert.equal(weather.at(120).wet, 1, 'soaked after two minutes of rain');
  weather.setMode(0, 120);
  const frames = run(weather, 120, 200);
  const stopped = frames.find((w) => w.level === 0);
  assert.ok(stopped && stopped.t <= 120 + RAIN.taper + DT, `stopped at ${stopped?.t}`);
  assert.ok(frames.filter((w) => w.t < stopped.t).every((w) => w.wet === 1), 'still soaked while it thins');
  const dry = frames.find((w) => w.wet === 0);
  assert.ok(dry && dry.t <= stopped.t + RAIN.dryOver + DT, `dry at ${dry?.t}`);
});

test('the leaves take about 10 s to get soaked', () => {
  const weather = createRainWeather(createRandom(1));
  weather.setMode(STEADY, 0);
  assert.ok(weather.at(5).wet > 0.3 && weather.at(5).wet < 0.7, `5 s: ${weather.at(5).wet}`);
  assert.equal(weather.at(RAIN.wetUp + 0.5).wet, 1);
});

test('overcast follows the build-up, not the swells, and deepens with the mode', () => {
  const weather = createRainWeather(createRandom(2));
  weather.setMode(STEADY, 0);
  const shower = MODES[STEADY].overcast;
  assert.ok(Math.abs(weather.at(3).overcast - shower / 2) < 0.01, `half-way through the build-up: ${weather.at(3).overcast}`);
  for (const w of run(weather, RAIN.buildUp, 600)) assert.ok(Math.abs(w.overcast - shower) < 1e-9, `${w.overcast} at ${w.t}`);
  weather.setMode(0, 600);
  assert.ok(Math.abs(weather.at(604).overcast - shower / 2) < 0.01, `half-way through the taper: ${weather.at(604).overcast}`);
  assert.ok(MODES[DRIZZLE].overcast < shower && shower < MODES[MONSOON].overcast && MODES[MONSOON].overcast <= 1);
});

test('toggling mid-way carries on from where it is, never jumping', () => {
  const weather = createRainWeather(createRandom(1));
  weather.setMode(STEADY, 0);
  run(weather, 0, 3);
  weather.setMode(0, 3);
  weather.at(4);
  weather.setMode(STEADY, 4);
  let previous = weather.at(4).level;
  for (const w of run(weather, 4, 20)) {
    assert.ok(Math.abs(w.level - previous) < 0.05, `jump from ${previous} to ${w.level} at ${w.t}`);
    previous = w.level;
  }
});

test('a mode out of range is clamped: below Off is Off, above Monsoon is Monsoon', () => {
  const weather = createRainWeather(createRandom(1));
  weather.setMode(9, 0);
  assert.equal(weather.mode, MONSOON);
  weather.setMode(-2, 1);
  assert.equal(weather.mode, 0);
});

test('the same seed gives the same weather', () => {
  const levels = (seed) => {
    const weather = createRainWeather(createRandom(seed));
    weather.setMode(STEADY, 0);
    return run(weather, 0, 900).map((w) => w.level);
  };
  assert.deepEqual(levels(4), levels(4));
});

test('hours of rain keep only a few scheduled swells and bursts in memory', () => {
  const weather = createRainWeather(createRandom(1));
  weather.setMode(STEADY, 0);
  for (let t = 0; t < 6 * 3600; t += 1) weather.at(t);
  assert.ok(weather.scheduled <= 6, `scheduled ${weather.scheduled}`);
});

test('the rain brings wind: heavier rain sways the leaves faster and harder', () => {
  const dry = stormBoost(0), drizzle = stormBoost(0.3), shower = stormBoost(0.55), monsoon = stormBoost(0.9), full = stormBoost(1);
  assert.deepEqual(dry, { speed: 1, strength: 1 }, 'dry: the Motion level alone');
  assert.ok(drizzle.speed < 1.1 && drizzle.strength < 1.15, `a drizzle barely stirs them: ${JSON.stringify(drizzle)}`);
  assert.ok(shower.speed > 1.2 && shower.strength > 1.35, `steady rain livens them: ${JSON.stringify(shower)}`);
  assert.ok(monsoon.speed > 1.45 && monsoon.strength > 1.8, `a monsoon shakes them: ${JSON.stringify(monsoon)}`);
  assert.ok(full.speed <= 1.6 + 1e-9 && full.strength <= 2 + 1e-9, `never more: ${JSON.stringify(full)}`);
  let previous = dry;
  for (let level = 0; level <= 1; level += 0.05) {
    const b = stormBoost(level);
    assert.ok(b.speed >= previous.speed && b.strength >= previous.strength, `rises with the rain at ${level}`);
    previous = b;
  }
});

test('drops knock leaves: a few a second when they hit lightly, dozens in a monsoon, none when dry', () => {
  const rate = (level) => {
    const random = createRandom(5);
    let n = 0;
    for (let t = 0; t < 60; t += DT) n += knockCount(level, DT, random);
    return n / 60;
  };
  const [dry, light, shower, monsoon] = [0, 0.3, 0.55, 0.9].map(rate);
  assert.equal(dry, 0);
  assert.ok(light > 1 && light < 8, `light ${light}/s`);
  assert.ok(shower > 12 && shower < 30, `shower ${shower}/s`);
  assert.ok(monsoon > 55, `monsoon ${monsoon}/s`);
});

test('drops are fine in a drizzle and big in a monsoon, and a change of mode eases', () => {
  const size = (mode) => {
    const weather = createRainWeather(createRandom(1));
    weather.setMode(mode, 0);
    return weather.at(30).size;
  };
  assert.deepEqual([size(DRIZZLE), size(STEADY), size(MONSOON)], [0, 0.5, 1]);
  const weather = createRainWeather(createRandom(1));
  weather.setMode(DRIZZLE, 0);
  run(weather, 0, 30);
  weather.setMode(MONSOON, 30);
  let previous = weather.at(30).size;
  for (const w of run(weather, 30, 45)) {
    assert.ok(Math.abs(w.size - previous) < 0.05, `size jumped from ${previous} to ${w.size}`);
    previous = w.size;
  }
  assert.ok(previous > 0.95, `big drops within 15 s: ${previous}`);
});

test("a drizzle's fine drops neither knock nor shake the leaves; from steady rain up, they hit as hard as it rains", () => {
  assert.equal(impact({ level: 0.3, size: 0 }), 0, 'a drizzle');
  assert.equal(impact({ level: 0.55, size: 0.5 }), 0.55, 'steady rain');
  assert.equal(impact({ level: 0.9, size: 1 }), 0.9, 'a monsoon');
  assert.ok(Math.abs(impact({ level: 0.4, size: 0.25 }) - 0.2) < 1e-9, 'half-way from a drizzle to steady rain');
  assert.equal(impact({ level: 0.6 }), 0.6, 'drops of unknown size count as steady rain');
  const random = createRandom(5);
  let knocks = 0;
  for (let t = 0; t < 60; t += DT) knocks += knockCount(impact({ level: 0.45, size: 0 }), DT, random);
  assert.equal(knocks, 0, 'not one knock in a minute of heavy drizzle');
});

test('a downpour greys the view behind a veil: none in a drizzle or steady rain, thickest at full', () => {
  for (const level of [0, 0.3, 0.55, 0.6]) assert.equal(veil(level), 0, `none at ${level}`);
  assert.ok(veil(0.85) > 0.1, `a monsoon: ${veil(0.85)}`);
  assert.ok(veil(1) > veil(0.85) && veil(1) <= 0.3, `thickest at full, never opaque: ${veil(1)}`);
  let previous = 0;
  for (let level = 0; level <= 1; level += 0.01) {
    assert.ok(veil(level) >= previous && veil(level) - previous < 0.02, `thickens smoothly at ${level}`);
    previous = veil(level);
  }
});
