// The scene's first frame as a picture: what the live wall shows the moment it starts (the
// page's ?t=0 freezes it there), with the leaves the scene adds to the photo. It is the desktop
// picture and the screen saver's still while the scene loads, so a still never differs from the
// moving wall but for the motion. Rendered in a web view off every screen.
using System.Drawing;
using System.Text.RegularExpressions;

namespace LivingWall;

static partial class SceneStill
{
    /// The whole wall at the photo's own size (scene/assets/wall.jpg).
    public static readonly Size WallPixels = new(3840, 2560);

    /// The first frame, `pixels` big; null if the scene fails or takes over 30 s. A view of the
    /// wall's own proportions shows the whole wall (scene/src/fit.js). One CSS pixel to one pixel.
    public static async Task<Bitmap?> Render(Size pixels)
    {
        using var window = HostWindow.Offscreen(pixels);
        var view = await Scene.Show("check", window.Handle, pixels, scale: 1);
        try
        {
            var ready = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            view.Message += m =>
            {
                if (m.Type is "ready" or "failed") ready.TrySetResult(m.Type == "ready");
                else if (m.Level == "error") Log.Write($"page error: {m.Text}");
            };
            view.Load("t=0");
            if (await Task.WhenAny(ready.Task, Task.Delay(30_000)) != ready.Task || !await ready.Task) return null;
            // A frozen page redraws its frame on every refresh; a few in, the frame is on screen.
            for (var tries = 0; tries < 100 && Drawn(await view.State()) < 3; tries++) await Task.Delay(50);
            var frame = await view.Capture();
            if (frame is not null && frame.Size != pixels)
            {
                Log.Write($"the frame came out {frame.Width} x {frame.Height}, not {pixels.Width} x {pixels.Height}");
                frame.Dispose();
                return null;
            }
            return frame;
        }
        finally
        {
            view.Dispose();
        }
    }

    /// How many frames a page's wallState() says it has drawn.
    public static int Drawn(string? state) =>
        state is not null && DrawnPattern().Match(state) is { Success: true } m ? int.Parse(m.Groups[1].Value) : 0;

    [GeneratedRegex("\"drawn\":(\\d+)")]
    private static partial Regex DrawnPattern();

    /// `Cefalo Living Wall.exe --render-still <file.jpg>`: the whole wall's first frame at the
    /// photo's size, as a JPEG; exit 0 only if that worked. build.ps1 puts it beside the program.
    public static async Task<int> RenderTo(string file)
    {
        using var frame = await Render(WallPixels);
        if (frame is null)
        {
            Console.WriteLine("Could not render the still");
            return 1;
        }
        File.WriteAllBytes(file, DesktopPicture.Jpeg(frame));
        Console.WriteLine($"Rendered the still ({frame.Width} x {frame.Height})");
        return 0;
    }
}
