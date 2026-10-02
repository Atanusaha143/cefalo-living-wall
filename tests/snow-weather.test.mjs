import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { createSnowWeather, snowStorm, whiteout, SNOW, SNOW_MODES } from '../scene/src/snow-weather.js';
import { stormBoost } from '../scene/src/rain-weather.js';

const DT = 1 / 30;
const [, FLURRIES, STEADY, BLIZZARD] = [0, 1, 2, 3];
/** Every frame's weather from `from` to `to` seconds. */
function run(weather, from, to) {
  const out = [];
  for (let t = from; t < to; t += DT) out.push({ t, ...weather.at(t) });
  return out;
}
const snowing = (mode, seed = 1) => {
  const weather = createSnowWeather(createRandom(seed));
  weather.setMode(mode, 0);
  return weather;
};

test('no snow, nothing settled, until a snow mode is chosen', () => {
  const weather = createSnowWeather(createRandom(1));
  for (const w of run(weather, 0, 30)) assert.deepEqual([w.level, w.cover, w.chill, w.wet], [0, 0, 0, 0], `at ${w.t}`);
  assert.equal(weather.mode, 0);
});

test('each mode builds up over about 8 s, then snows between its floor and full', () => {
  for (const mode of [FLURRIES, STEADY, BLIZZARD]) {
    const weather = snowing(mode, 2);
    const frames = run(weather, 0, 20 * 60);
    assert.ok(frames.find((w) => w.t >= 1).level < SNOW_MODES[mode].floor + 0.05, `${SNOW_MODES[mode].name} starts gently`);
    for (const w of frames.filter((f) => f.t >= SNOW.buildUp + DT)) {
      assert.ok(w.level >= SNOW_MODES[mode].floor - 1e-9 && w.level <= 1, `${SNOW_MODES[mode].name}: ${w.level} at ${w.t}`);
    }
  }
});

test('flurries come and go: within 10 minutes they nearly stop', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const lightest = Math.min(...run(snowing(FLURRIES, seed), SNOW.buildUp, 10 * 60).map((w) => w.level));
    assert.ok(lightest < 0.1, `seed ${seed}: lightest ${lightest}`);
  }
});

test('Flurries are lighter than Steady snow, and a Blizzard heavier still', () => {
  const mean = (mode) => { const f = run(snowing(mode, 3), 20, 620); return f.reduce((s, w) => s + w.level, 0) / f.length; };
  const [flurries, steady, blizzard] = [FLURRIES, STEADY, BLIZZARD].map(mean);
  assert.ok(flurries < steady - 0.15 && steady < blizzard - 0.15, `means ${flurries} ${steady} ${blizzard}`);
});

test('steady snow dusts the wall within 20 s and settles to 90 % of its cover within 3 minutes', () => {
  const weather = snowing(STEADY);
  run(weather, 0, 20);
  assert.ok(weather.at(20).cover >= 0.1, `20 s: ${weather.at(20).cover}`);
  run(weather, 20, 180);
  const cover = weather.at(180).cover;
  assert.ok(cover >= 0.9 * SNOW_MODES[STEADY].cover && cover <= SNOW_MODES[STEADY].cover, `3 min: ${cover}`);
});

test('Flurries leave a dusting, Steady covers well, a Blizzard covers it all', () => {
  const settled = (mode) => { const w = snowing(mode); run(w, 0, 900); return w.at(900).cover; };
  const [flurries, steady, blizzard] = [FLURRIES, STEADY, BLIZZARD].map(settled);
  assert.ok(Math.abs(flurries - 0.3) < 0.01 && Math.abs(steady - 0.75) < 0.01 && Math.abs(blizzard - 1) < 0.01, `${flurries} ${steady} ${blizzard}`);
});

test('lighter snowfall keeps what has settled', () => {
  const weather = snowing(BLIZZARD);
  run(weather, 0, 600);
  const deep = weather.at(600).cover;
  weather.setMode(FLURRIES, 600);
  for (const w of run(weather, 600, 900)) assert.ok(w.cover >= deep - 1e-9, `${w.cover} at ${w.t}`);
});

test('switched off, a full cover melts within 3 minutes, a dusting sooner', () => {
  const melt = (mode) => {
    const weather = snowing(mode);
    run(weather, 0, 900);
    weather.setMode(0, 900);
    return run(weather, 900, 1200).find((w) => w.cover === 0).t - 900;
  };
  const full = melt(BLIZZARD), dusting = melt(FLURRIES);
  assert.ok(full <= SNOW.meltOver + DT && full > 150, `a full cover melts in ${full} s`);
  assert.ok(dusting < full / 2, `a dusting in ${dusting} s`);
});

test('rain melts the snow three times as fast', () => {
  const weather = snowing(BLIZZARD);
  run(weather, 0, 900);
  weather.setMode(0, 900);
  weather.setRaining(true, 900);
  const gone = run(weather, 900, 1200).find((w) => w.cover === 0).t - 900;
  assert.ok(gone <= SNOW.meltOver / SNOW.rainMelt + DT, `gone in ${gone} s`);
});

test('melting snow wets the leaves, and they dry a minute after it has gone', () => {
  const weather = snowing(STEADY);
  const during = run(weather, 0, 600);
  assert.ok(during.every((w) => w.wet === 0), 'falling snow is dry');
  weather.setMode(0, 600);
  const after = run(weather, 600, 1200);
  const gone = after.find((w) => w.cover === 0);
  assert.equal(after.find((w) => w.t >= 600 + SNOW.wetUp + 1).wet, 1, 'soaked while it melts');
  const dry = after.find((w) => w.t > gone.t && w.wet === 0);
  assert.ok(dry && dry.t <= gone.t + SNOW.dryOver + DT, `dry at ${dry?.t}, snow gone at ${gone.t}`);
});

test('the cold light follows the build-up, not the swells, and deepens with the mode', () => {
  const weather = snowing(STEADY, 2);
  const chill = SNOW_MODES[STEADY].chill;
  assert.ok(Math.abs(weather.at(4).chill - chill / 2) < 0.01, `half-way through the build-up: ${weather.at(4).chill}`);
  for (const w of run(weather, SNOW.buildUp, 600)) assert.ok(Math.abs(w.chill - chill) < 1e-9, `${w.chill} at ${w.t}`);
  weather.setMode(0, 600);
  assert.ok(Math.abs(weather.at(605).chill - chill / 2) < 0.01, `half-way through the taper: ${weather.at(605).chill}`);
  assert.ok(SNOW_MODES[FLURRIES].chill < chill && chill < SNOW_MODES[BLIZZARD].chill);
});

test('toggling and switching modes carry on from where they are, never jumping', () => {
  const weather = snowing(STEADY);
  run(weather, 0, 60);
  weather.setMode(0, 60);
  weather.at(64);
  weather.setMode(BLIZZARD, 64);
  let previous = weather.at(64);
  for (const w of run(weather, 64, 100)) {
    assert.ok(Math.abs(w.level - previous.level) < 0.05 && Math.abs(w.cover - previous.cover) < 0.01, `jump at ${w.t}`);
    assert.ok(Math.abs(w.size - previous.size) < 0.05, `the flakes' size jumped at ${w.t}`);
    previous = w;
  }
  assert.ok(previous.size > 0.95 && previous.storm > 0.95, 'a blizzard within half a minute');
});

test('a mode out of range is clamped', () => {
  const weather = createSnowWeather(createRandom(1));
  weather.setMode(7, 0);
  assert.equal(weather.mode, BLIZZARD);
  weather.setMode(-1, 1);
  assert.equal(weather.mode, 0);
});

test('the same seed gives the same weather, and hours of it keep only a few swells in memory', () => {
  const levels = (seed) => run(snowing(STEADY, seed), 0, 900).map((w) => w.level);
  assert.deepEqual(levels(4), levels(4));
  const weather = snowing(STEADY);
  for (let t = 0; t < 6 * 3600; t += 1) weather.at(t);
  assert.ok(weather.scheduled <= 6, `scheduled ${weather.scheduled}`);
});

test('flurries fall in still air; a blizzard brings a monsoon\'s wind', () => {
  assert.deepEqual(snowStorm({ level: 0.4, storm: 0 }), { speed: 1, strength: 1 }, 'flurries');
  const steady = snowStorm({ level: 0.55, storm: 0.2 });
  assert.ok(steady.strength > 1.05 && steady.strength < 1.2, `steady snow livens the leaves a little: ${JSON.stringify(steady)}`);
  assert.deepEqual(snowStorm({ level: 0.9, storm: 1 }), stormBoost(0.9), 'a blizzard');
});

test('only a blizzard whites out the view, never opaque', () => {
  assert.equal(whiteout({ level: 0.4, size: 0 }), 0, 'flurries');
  assert.equal(whiteout({ level: 0.85, size: 0.5 }), 0, 'heavy steady snow');
  const blizzard = whiteout({ level: 0.9, size: 1 });
  assert.ok(blizzard > 0.1 && blizzard <= 0.22, `a blizzard: ${blizzard}`);
});
