// `--check` and `--check-saver`: the real scene and screen saver, run in windows off every
// screen, as install.ps1 and windows/tests/run.ps1 run them. The Windows counterparts of
// SceneCheck and SaverCheck in mac/LivingWall.swift. Each prints what it found and returns 0 only
// if everything passed.
using System.Drawing;
using System.Drawing.Imaging;
using static LivingWall.Native;

namespace LivingWall;

static class Checks
{
    sealed class Failure(string message) : Exception(message);

    static void Expect(bool ok, string otherwise)
    {
        if (!ok) throw new Failure(otherwise);
    }

    static async Task<int> Run(string name, TimeSpan limit, Func<Task<string>> check)
    {
        // As on a PC set to German, which writes 1.5 as 1,5: the numbers the host writes into the
        // page (the fade's length, the cursor) must not follow the PC's language.
        System.Globalization.CultureInfo.CurrentCulture = System.Globalization.CultureInfo.GetCultureInfo("de-DE");
        var work = check();
        try
        {
            if (await Task.WhenAny(work, Task.Delay(limit)) != work) throw new Failure("timed out");
            Console.WriteLine($"{name} passed: {await work}");
            return 0;
        }
        catch (Failure e)
        {
            Console.WriteLine($"{name} FAILED: {e.Message}");
            return 1;
        }
    }

    /// The page's state, polled until `test` holds, or a failure after `tries` half seconds.
    static async Task<string> Poll(Func<Task<string?>> state, string what, Func<string, bool> test, int tries = 20, int every = 500)
    {
        string? last = null;
        for (var i = 0; i < tries; i++)
        {
            last = await state();
            if (last is not null && test(last)) return last;
            await Task.Delay(every);
        }
        throw new Failure($"{what}: {last ?? "no answer"}");
    }

    /// `--check`: the app has its still and its icon; the desktop has a layer for the wall; the
    /// scene, frozen raining and then snowing, draws a real frame each time (so the rain's and the
    /// snow's shaders compile); then a hidden wall, driven exactly as the app drives one, really
    /// stops, restarts, takes the cursor and switches the weather, one at a time.
    public static Task<int> Scene() => Run("Scene check", TimeSpan.FromSeconds(60), async () =>
    {
        Expect(File.Exists(Controller.StillPath), "the app has no still of the wall for the desktop picture");
        using (var still = Image.FromFile(Controller.StillPath))
            Expect(still.Size == SceneStill.WallPixels, $"the still is {still.Width} x {still.Height}, not the whole wall");
        Expect(Environment.ProcessPath is string exe && ExtractIconEx(exe, -1, null, null, 0) > 0, "the program has no icon");
        var layer = DesktopLayer.FindOrMake();
        Expect(layer != 0, "the desktop has no wallpaper layer to put the wall in");
        Console.WriteLine($"Desktop: {DesktopLayer.Describe(layer)}");

        var size = new Size(800, 520);
        using var window = HostWindow.Offscreen(size);
        var view = await LivingWall.Scene.Show("check", window.Handle, size, scale: 1);
        try
        {
            foreach (var query in new[] { "t=10&smoke&rain=2", "t=30&smoke&snow=3" })
            {
                var report = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
                void Watch(PageMessage m)
                {
                    if (m.Type == "failed") report.TrySetException(new Failure($"scene failed: {m.Reason}"));
                    else if (m.Level == "error") report.TrySetException(new Failure($"page error: {m.Text}"));
                    else if (m.Level == "smoke" && m.Text is string text) report.TrySetResult(text);
                }
                view.Message += Watch;
                view.Load(query);
                var line = await report.Task;
                view.Message -= Watch;
                Expect(line.Contains("\"nonBlank\":true") && line.Contains("\"webgl2\":true"), line);
                Console.WriteLine($"Frame check passed ({query}): {line}");
            }
        }
        finally
        {
            view.Dispose();
        }

        using var parent = HostWindow.Offscreen(size);
        using var wall = new Wallpaper("check", new Rectangle(Point.Empty, size), parent.Handle, new Rectangle(Point.Empty, size), "check");
        wall.SetPaused(false);
        wall.SetMotion(3);                            // Gentle: not the default, so the page must have been told
        wall.SetWeather(new WeatherChoice(1, 3));     // a Blizzard, as for a display connected while it snows
        wall.SetRate(0);
        for (var i = 0; i < 100 && !wall.Ready; i++) await Task.Delay(200);
        Expect(wall.Ready, "the wall's scene never said it was ready");
        await Poll(wall.PageState, "the scene kept running after the host asked for 0 fps, or missed Motion or Snow",
            s => s.Contains("\"running\":false") && s.Contains("\"motion\":3") && s.Contains("\"snow\":{\"mode\":3"));
        var stopped = SceneStill.Drawn(await wall.PageState());
        wall.SetRate(30);
        // Running, and really drawing once its window is shown: more than ten frames since.
        await Poll(wall.PageState, "the scene did not restart at 30 fps and draw",
            s => s.Contains("\"running\":true") && s.Contains("\"maxFps\":30") && SceneStill.Drawn(s) > stopped + 10);
        wall.SetPointer(new PointF(300, 300));
        await Poll(wall.PageState, "the cursor did not reach the scene", s => !s.Contains("\"pointerCalls\":0"));
        wall.SetWeather(new WeatherChoice(0, 2));
        await Poll(wall.PageState, "Steady rain did not replace the snow", s => s.Contains("\"rain\":{\"mode\":2") && s.Contains("\"snow\":{\"mode\":0"));
        wall.SetWeather(new WeatherChoice(1, 1));
        await Poll(wall.PageState, "Flurries did not replace the rain", s => s.Contains("\"snow\":{\"mode\":1") && s.Contains("\"rain\":{\"mode\":0"));
        wall.SetWeather(WeatherChoice.Off);
        await Poll(wall.PageState, "the weather did not stop", s => s.Contains("\"rain\":{\"mode\":0") && s.Contains("\"snow\":{\"mode\":0"));
        return "the host can stop, start and steer the scene, and switch the weather, one at a time";
    });

    /// `--check-saver`: a full-screen-sized screen saver and a preview, in windows off every
    /// screen, show the scene's first frame as a still while the scene loads (the page see-through
    /// over it), then fade the scene in and run at 30 and 15 fps with the Options' Motion and
    /// weather (Gentle and Steady snow here, not the defaults, so they must have reached it).
    public static Task<int> Saver() => Run("Saver check", TimeSpan.FromSeconds(90), async () =>
    {
        using var still = LivingWall.Saver.LoadStill();
        Expect(still is not null, "the screen saver has no still to show while the scene loads");
        var weather = new WeatherChoice(1, 2);
        var full = new SaverView(HostWindow.Offscreen(new Size(1200, 750), still), 30, 3, weather, "check") { HoldReveal = true };
        using var box = HostWindow.Offscreen(new Size(320, 200));
        var preview = new SaverView(HostWindow.Child(box.Handle, new Rectangle(0, 0, 320, 200), still, clipChildren: false), 15, 3, weather, "check") { HoldReveal = true };
        try
        {
            // The still under the loading scene is the scene's own first frame, framed as the scene
            // frames it here, with the leaves the scene adds, so nothing but the motion changes.
            using (var first = await SceneStill.Render(new Size(1200, 750)))
            {
                Expect(first is not null, "could not render the scene's first frame to compare the still with");
                using var painted = new Bitmap(1200, 750, PixelFormat.Format32bppArgb);
                using (var g = Graphics.FromImage(painted)) full.Window.PaintBackdrop(g, new RectangleF(0, 0, 1200, 750));
                var difference = Difference(painted, first!);
                Expect(difference < 0.02, $"the saver's still is not the scene's first frame (difference {difference:F3})");
                Console.WriteLine($"Saver still matches the scene's first frame (difference {difference:F3})");
            }
            foreach (var (view, name, fps) in new[] { (full, "full screen", 30), (preview, "preview", 15) })
            {
                for (var i = 0; i < 100 && !view.Ready; i++) await Task.Delay(200);
                Expect(view.Ready, $"the {name} saver's scene never said it was ready");
                // Ready but not yet revealed: the page is see-through, and the window shows the still.
                var opacity = await Poll(() => Script(view, "getComputedStyle(document.getElementById('wall')).opacity"), $"the {name} saver shows the scene before its reveal", o => o == "\"0\"");
                using (var shown = CaptureWindow(view.Window))
                {
                    Expect(shown is not null, $"could not capture the {name} saver's window");
                    using var painted = new Bitmap(shown!.Width, shown.Height, PixelFormat.Format32bppArgb);
                    using (var g = Graphics.FromImage(painted)) view.Window.PaintBackdrop(g, new RectangleF(0, 0, shown.Width, shown.Height));
                    var difference = Difference(painted, shown);
                    Expect(difference < 0.03, $"the {name} saver does not show its still while the scene loads (difference {difference:F3}): the page is not see-through");
                    Console.WriteLine($"Saver {name} shows the still under the loading scene (difference {difference:F3})");
                }
                // And that capture shows the page too, not just the window under it: painted red for a
                // moment, the page must turn the capture red.
                await Script(view, "document.documentElement.style.setProperty('background', 'rgb(255, 0, 0)', 'important')");
                var red = 0.0;
                for (var i = 0; i < 20 && red < 0.9; i++)
                {
                    await Task.Delay(100);
                    using var shown = CaptureWindow(view.Window);
                    red = shown is null ? 0 : Redness(shown);
                }
                await Script(view, "document.documentElement.style.removeProperty('background')");
                Expect(red >= 0.9, $"the {name} saver's capture does not show its page ({red:P0} red), so the still under it was not really seen through it");
                view.Reveal();
                var fade = await Script(view, "getComputedStyle(document.getElementById('wall')).transitionDuration");
                Expect(fade is not null && double.TryParse(fade.Trim('"').TrimEnd('s'), System.Globalization.CultureInfo.InvariantCulture, out var seconds) && seconds >= 1,
                    $"the {name} saver cuts to the scene instead of fading it in ({fade})");
                Console.WriteLine($"Saver {name} fades the scene in over {fade!.Trim('"')}");
                var state = await Poll(() => view.Scene?.State() ?? Task.FromResult<string?>(null), $"the {name} saver never ran as expected",
                    s => s.Contains("\"running\":true") && s.Contains($"\"maxFps\":{fps}") && s.Contains("\"motion\":3")
                        && s.Contains("\"snow\":{\"mode\":2") && SceneStill.Drawn(s) > 10, tries: 40);
                await Poll(() => Script(view, "getComputedStyle(document.getElementById('wall')).opacity"), $"the {name} saver's scene never faded in all the way", o => o == "\"1\"", tries: 10);
                Console.WriteLine($"Saver {name} runs: {state[..Math.Min(90, state.Length)]}…");
            }
            return "the screen saver runs full screen and as a preview, with its own Motion and weather";
        }
        finally
        {
            full.Dispose();
            preview.Dispose();
        }
    });

    static async Task<string?> Script(SaverView view, string script) => view.Scene is SceneView scene ? await scene.Evaluate(script) : null;

    /// What the window shows on screen, web view and all (PrintWindow with PW_RENDERFULLCONTENT).
    static Bitmap? CaptureWindow(HostWindow window)
    {
        var size = window.Size;
        if (size.IsEmpty) return null;
        var image = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(image);
        var dc = g.GetHdc();
        var ok = PrintWindow(window.Handle, dc, 2);
        g.ReleaseHdc(dc);
        if (ok) return image;
        image.Dispose();
        return null;
    }

    /// How much of an image is pure red, 0 to 1 (every 8th pixel each way).
    static double Redness(Bitmap image)
    {
        int red = 0, count = 0;
        for (var y = 0; y < image.Height; y += 8)
            for (var x = 0; x < image.Width; x += 8)
            {
                var p = image.GetPixel(x, y);
                if (p.R > 230 && p.G < 30 && p.B < 30) red++;
                count++;
            }
        return (double)red / Math.Max(1, count);
    }

    /// The mean difference between two images of one size, in grey, 0 to 1 (every 4th pixel each way).
    static double Difference(Bitmap a, Bitmap b)
    {
        if (a.Size != b.Size) return 1;
        long total = 0, count = 0;
        for (var y = 0; y < a.Height; y += 4)
            for (var x = 0; x < a.Width; x += 4)
            {
                Color p = a.GetPixel(x, y), q = b.GetPixel(x, y);
                total += Math.Abs(p.R + p.G + p.B - q.R - q.G - q.B);
                count++;
            }
        return (double)total / (Math.Max(1, count) * 3 * 255);
    }
}
