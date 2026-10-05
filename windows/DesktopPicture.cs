// The still behind the live layer, and the user's own pictures to restore later. The Windows
// counterpart of DesktopPicture in mac/LivingWall.swift.
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using static LivingWall.Native;

namespace LivingWall;

/// Windows' desktop pictures, one per monitor (shobjidl.h). Monitor IDs are device paths.
[ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDesktopWallpaper
{
    void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string? monitorId, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string? monitorId);
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetMonitorDevicePathAt(uint index);
    uint GetMonitorDevicePathCount();
    RECT GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorId);
    void SetBackgroundColor(uint color);
    uint GetBackgroundColor();
    void SetPosition(int position);
    int GetPosition();
}

[ComImport, Guid("C2CF3110-460E-4fc1-B9D0-8A1C0C9CC4BD")]
class DesktopWallpaperClass { }

/// The still behind the live layer: the scene's first frame (SceneStill.cs), cropped for each
/// monitor exactly as the scene frames it there, so nothing moves when the wall comes alive. And
/// the user's own pictures, remembered once (never our own) to put back on uninstall.
static class DesktopPicture
{
    const string SavedKey = "previousDesktopPictures", SavedPositionKey = "previousWallpaperPosition";
    const int Fill = 4;   // DWPOS_FILL: each still is already its monitor's shape
    const int SPI_SETDESKWALLPAPER = 0x14, SPIF_UPDATEINIFILE = 0x1;

    static string Folder => Folders.Make(Path.Combine(Folders.Data, "Stills"));
    /// Every still of ours, whichever monitor it was made for: never the user's own picture.
    static string[] Stills => Directory.GetFiles(Folder, "*-still-?.jpg");

    static IDesktopWallpaper Open() => (IDesktopWallpaper)new DesktopWallpaperClass();

    /// The attached monitors: ID and bounds (physical pixels). Detached ones report an empty rectangle.
    static List<(string Id, Rectangle Bounds)> Monitors(IDesktopWallpaper wallpaper)
    {
        var monitors = new List<(string, Rectangle)>();
        for (uint i = 0; i < wallpaper.GetMonitorDevicePathCount(); i++)
        {
            try
            {
                var id = wallpaper.GetMonitorDevicePathAt(i);
                var bounds = wallpaper.GetMonitorRECT(id).ToRectangle();
                if (bounds.Width > 0 && bounds.Height > 0) monitors.Add((id, bounds));
            }
            catch (COMException) { }
        }
        return monitors;
    }

    static string? Current(IDesktopWallpaper wallpaper, string id)
    {
        try { return wallpaper.GetWallpaper(id); } catch (COMException) { return null; }
    }

    /// The still for a monitor `size` big: the whole-wall still drawn where the scene draws the wall.
    public static Bitmap Framed(Image still, Size size)
    {
        var framed = new Bitmap(size.Width, size.Height, PixelFormat.Format24bppRgb);
        using var g = Graphics.FromImage(framed);
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.Clear(Scene.Background);
        g.DrawImage(still, HostLogic.WallPhotoFrame(size));
        return framed;
    }

    /// An image as the JPEG every still is kept in (quality 92, as on the Mac).
    public static byte[] Jpeg(Bitmap image)
    {
        var codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
        using var parameters = new EncoderParameters(1);
        parameters.Param[0] = new EncoderParameter(Encoder.Quality, 92L);
        using var stream = new MemoryStream();
        image.Save(stream, codec, parameters);
        return stream.ToArray();
    }

    /// Remember each monitor's current picture (once, and never our own), persisting that before
    /// changing anything, then show each its still, under a name Windows will show afresh if it
    /// has changed (HostLogic.StillName). Returns whether any monitor's picture changed.
    public static bool Install(string stillPath)
    {
        var changed = false;
        try
        {
            using var still = Image.FromFile(stillPath);
            var wallpaper = Open();
            var monitors = Monitors(wallpaper);
            var current = monitors.ToDictionary(m => m.Id, m => Current(wallpaper, m.Id));
            var ours = Stills;
            var previous = Saved();
            Settings.Set(SavedKey, [.. HostLogic.PicturesToSave(current, previous, ours).Select(p => $"{p.Key}\t{p.Value}")]);
            if (Settings.Int(SavedPositionKey) is null) Settings.Set(SavedPositionKey, wallpaper.GetPosition());
            var shownPaths = new HashSet<string>(current.Values.OfType<string>(), StringComparer.OrdinalIgnoreCase);
            foreach (var (id, bounds) in monitors)
            {
                using var framed = Framed(still, bounds.Size);
                var bytes = Jpeg(framed);
                var prefix = $"{bounds.Width}x{bounds.Height}-";
                var files = HostLogic.StillNames.Select(n => Path.Combine(Folder, prefix + n)).ToArray();
                var holding = files.FirstOrDefault(f => File.Exists(f) && File.ReadAllBytes(f).AsSpan().SequenceEqual(bytes));
                var shown = files.Where(shownPaths.Contains).Select(f => Path.GetFileName(f)[prefix.Length..]).ToHashSet();
                var path = Path.Combine(Folder, prefix + HostLogic.StillName(holding is null ? null : Path.GetFileName(holding)[prefix.Length..], shown));
                if (path != holding)
                {
                    File.WriteAllBytes(path, bytes);
                    Log.Write($"desktop still: {Path.GetFileName(path)}");
                }
                if (!string.Equals(current[id], path, StringComparison.OrdinalIgnoreCase))
                {
                    wallpaper.SetWallpaper(id, path);
                    changed = true;
                }
            }
            if (wallpaper.GetPosition() != Fill)
            {
                wallpaper.SetPosition(Fill);
                changed = true;
            }
        }
        catch (Exception e) when (e is COMException or IOException or UnauthorizedAccessException or ArgumentException or OutOfMemoryException)
        {
            Log.Write($"could not set the desktop picture: {e.Message}");
        }
        return changed;
    }

    static Dictionary<string, string> Saved()
    {
        var saved = new Dictionary<string, string>();
        foreach (var line in Settings.Strings(SavedKey))
            if (line.Split('\t', 2) is [var id, var path]) saved[id] = path;
        return saved;
    }

    /// Put back the pictures saved by Install. Returns false, keeping the record, if any monitor
    /// still shows our still afterwards (uninstall then keeps the stills' files).
    public static bool Restore()
    {
        try
        {
            var wallpaper = Open();
            var monitors = Monitors(wallpaper);
            var targets = HostLogic.PicturesToRestore(monitors.Select(m => m.Id), Saved(), File.Exists);
            // No picture, a solid colour: Windows takes that for every monitor at once, so it goes
            // first, and the monitors that had pictures get them back after it.
            if (targets.Values.Any(p => p == ""))
            {
                var none = Marshal.StringToHGlobalUni("");
                SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, none, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
                Marshal.FreeHGlobal(none);
            }
            foreach (var (id, path) in targets)
                if (path != "") wallpaper.SetWallpaper(id, path);
            if (Settings.Int(SavedPositionKey) is int position) wallpaper.SetPosition(position);
            var ours = new HashSet<string>(Stills, StringComparer.OrdinalIgnoreCase);
            var stuck = monitors.Count(m => Current(wallpaper, m.Id) is string shown && ours.Contains(shown));
            if (stuck > 0)
            {
                Log.Write($"could not restore the desktop picture on {stuck} monitor(s)");
                return false;
            }
            Settings.Remove(SavedKey);
            Settings.Remove(SavedPositionKey);
            return true;
        }
        catch (COMException e)
        {
            Log.Write($"could not restore the desktop picture: {e.Message}");
            return false;
        }
    }
}
