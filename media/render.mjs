// Renders the README's pictures: media/icon.png, the app's icon, and from the scene
// media/hero.gif, a few seconds of the wall moving, a still for each weather, and
// build/reel.mp4, the wall and its weathers in motion. Each frame is the page frozen at one
// instant (?t=), which runs the seeded simulation from 0 in fixed 1/30 s steps, so consecutive
// instants are consecutive frames of the same wall. Needs Google Chrome, ffmpeg and the Xcode
// command line tools: npm run media.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../serve.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEW = { width: 1920, height: 1080 };   // a 16:9 desktop, cropped from the photo as on a monitor

// The hero: `start` to `start + length` s, crossfaded over its last `fade` s into its first
// frames so it loops without a jump. Chosen (for the default seed) so the light sweeps the
// logo while a butterfly rests on one leaf by the O from the first frame to the last. The
// foliage changes every pixel of every frame, which GIF compresses badly: few colours and no
// dithering keep it near 7 MB, and the leaves hide the banding.
const HERO = { start: 84, length: 5, fade: 0.5, fps: 15, width: 880, colours: 48 };
const STILLS = [
  { name: 'rain', query: 't=40&rain=2' },          // Steady
  { name: 'monsoon', query: 't=40&rain=3' },
  { name: 'snow', query: 't=200&snow=3' },          // a blizzard, settled
];
const STILL_WIDTH = 1280;
const ICON_PIXELS = 256;   // shown at 128 points, so sharp on a Retina display
// The reel: the dry wall, then each weather once it has built up (snow once it has settled),
// crossfaded over `fade` s. It is not kept in the repository: GitHub plays only a video
// uploaded through its editor, so it goes to build/ for that. GitHub takes up to 10 MB on a
// free plan, and rain on foliage costs a lot of bits: 1440 wide at CRF 29 keeps it near 8 MB.
const REEL = {
  fps: 30, fade: 0.6, width: 1440, crf: 29,
  clips: [
    { start: 84, seconds: 4.5 },                    // dry, the light sweeping the logo
    { query: 'rain=2', start: 40, seconds: 3.5 },   // Steady
    { query: 'rain=3', start: 40, seconds: 3.5 },   // Monsoon
    { query: 'snow=3', start: 200, seconds: 4 },    // a blizzard, settled
  ],
};

/** Chrome headless on a page of the scene, driven over the DevTools protocol. */
export async function openScene() {
  const server = createStaticServer(root);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/scene/`;
  const profile = await mkdtemp(join(tmpdir(), 'living-wall-media-'));
  const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, `--window-size=${VIEW.width},${VIEW.height}`, 'about:blank'], { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await new Promise((r) => setTimeout(r, 100));
    port = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').then((s) => s.split('\n')[0], () => null);
  }
  if (!port) throw new Error(`Chrome did not start (${CHROME})`);
  const [page] = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, f) => { socket.onopen = r; socket.onerror = f; });
  let nextId = 1;
  const waiting = new Map();
  socket.onmessage = ({ data }) => {
    const { id, result, error } = JSON.parse(data);
    if (!waiting.has(id)) return;
    const { done, fail } = waiting.get(id);
    waiting.delete(id);
    if (error) fail(new Error(error.message)); else done(result);
  };
  const send = (method, params = {}) => new Promise((done, fail) => {
    const id = nextId++;
    waiting.set(id, { done, fail });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  await send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });

  return {
    /** Load the page frozen at `query` (e.g. "t=12&rain=2") and wait for its first frame. */
    async show(query) {
      await send('Page.navigate', { url: `${base}?${query}` });
      for (let i = 0; i < 300; i++) {
        if (await evaluate(`location.search === ${JSON.stringify(`?${query}`)} && window.wallState?.().drawn >= 1`)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`the scene never drew ?${query}`);
    },
    state: () => evaluate('window.wallState()'),
    async screenshot(file) {
      await writeFile(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    },
    async close() {
      socket.close();
      chrome.kill();
      server.close();
      await new Promise((r) => chrome.once('exit', r));
      await rm(profile, { recursive: true, force: true });
    },
  };
}

/** The app's icon as a PNG, `pixels` square, drawn by the app's own code (mac/AppIcon.swift). */
export async function renderIcon(file, pixels, work) {
  const main = join(work, 'icon.swift'), program = join(work, 'render-icon');
  await writeFile(main, `import AppKit
@main enum RenderIcon {
  static func main() {
    guard let image = AppIcon.image(pixels: ${pixels}),
      let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]),
      (try? png.write(to: URL(fileURLWithPath: ${JSON.stringify(file)}))) != nil else { exit(1) }
  }
}
`);
  execFileSync('swiftc', ['-parse-as-library', '-swift-version', '5', '-o', program,
    join(root, 'mac', 'MenuIcon.swift'), join(root, 'mac', 'AppIcon.swift'), main], { stdio: 'inherit' });
  execFileSync(program, { stdio: 'inherit' });
}

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

/** The page from `start` s for `seconds` s, as dir/f0000.png, f0001.png… `fps` divides 30, so
 *  every frame falls on a simulation step. */
async function renderFrames(scene, dir, { query = '', start, seconds, fps }, label) {
  await mkdir(dir, { recursive: true });
  const step = 30 / fps, first = Math.round(start * 30), count = Math.round(seconds * fps);
  for (let i = 0; i < count; i++) {
    await scene.show(`t=${((first + i * step) / 30).toFixed(4)}${query && `&${query}`}`);
    await scene.screenshot(join(dir, `f${String(i).padStart(4, '0')}.png`));
    process.stdout.write(`\r${label} frame ${i + 1}/${count}`);
  }
  process.stdout.write('\n');
}

async function main() {
  const out = join(root, 'media');
  const work = await mkdtemp(join(tmpdir(), 'living-wall-frames-'));
  const scene = await openScene();
  try {
    await renderIcon(join(out, 'icon.png'), ICON_PIXELS, work);
    console.log('media/icon.png');
    for (const { name, query } of STILLS) {
      await scene.show(query);
      await scene.screenshot(join(work, `${name}.png`));
      ffmpeg('-i', join(work, `${name}.png`), '-vf', `scale=${STILL_WIDTH}:-2:flags=lanczos`, '-q:v', '3', join(out, `${name}.jpg`));
      console.log(`media/${name}.jpg`);
    }
    const { start, length, fade, fps, width, colours } = HERO;
    await renderFrames(scene, join(work, 'hero'), { start, seconds: length + fade, fps }, 'hero');
    // Play the first `length` s, with its last `fade` s blended into the clip's own opening.
    const count = Math.round((length + fade) * fps), fadeFrames = Math.round(fade * fps), body = count - fadeFrames;
    const graph = [
      `[0:v]split=3[a][b][c]`,
      `[a]trim=start_frame=${fadeFrames}:end_frame=${body},setpts=PTS-STARTPTS[main]`,
      `[b]trim=start_frame=${body},setpts=PTS-STARTPTS[tail]`,
      `[c]trim=end_frame=${fadeFrames},setpts=PTS-STARTPTS[head]`,
      `[tail][head]blend=all_expr='A*(1-(N+1)/${fadeFrames + 1})+B*(N+1)/${fadeFrames + 1}'[seam]`,
      `[main][seam]concat=n=2:v=1,scale=${width}:-2:flags=lanczos,split[x][y]`,
      `[x]palettegen=max_colors=${colours}:stats_mode=full[p]`,
      `[y][p]paletteuse=dither=none:diff_mode=rectangle`,
    ].join(';');
    ffmpeg('-framerate', String(fps), '-i', join(work, 'hero', 'f%04d.png'), '-filter_complex', graph, '-loop', '0', join(out, 'hero.gif'));
    console.log('media/hero.gif');

    const inputs = [];
    for (const [i, clip] of REEL.clips.entries()) {
      await renderFrames(scene, join(work, `reel${i}`), { ...clip, fps: REEL.fps }, `reel clip ${i + 1}`);
      inputs.push('-framerate', String(REEL.fps), '-i', join(work, `reel${i}`, 'f%04d.png'));
    }
    // Each crossfade starts `fade` s before the end of what has played so far.
    let joined = '[0:v]', played = 0;
    const fades = REEL.clips.slice(1).map((_, i) => {
      played += REEL.clips[i].seconds - REEL.fade;
      const step = `${joined}[${i + 1}:v]xfade=transition=fade:duration=${REEL.fade}:offset=${played.toFixed(3)}[x${i}]`;
      joined = `[x${i}]`;
      return step;
    });
    await mkdir(join(root, 'build'), { recursive: true });
    const reel = [...fades, `${joined}scale=${REEL.width}:-2:flags=lanczos[reel]`].join(';');
    ffmpeg(...inputs, '-filter_complex', reel, '-map', '[reel]', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(REEL.crf),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(root, 'build', 'reel.mp4'));
    console.log('build/reel.mp4 (for the README on GitHub: drag it into the editor)');
  } finally {
    await scene.close();
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
