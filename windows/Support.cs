// Where the host keeps things: its log, its folder of stills and web-view data, and its settings.
using Microsoft.Win32;

namespace LivingWall;

static class Folders
{
    /// %LOCALAPPDATA%\Cefalo Living Wall: the log, the desktop stills and the web views' data.
    public static string Data => Make(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Cefalo Living Wall"));

    public static string Make(string folder)
    {
        Directory.CreateDirectory(folder);
        return folder;
    }
}

/// What the app and each display's scene are doing, in %LOCALAPPDATA%\Cefalo Living Wall\<name>.log
/// (`Cefalo Living Wall.exe --report` adds a full dump). The checks print to the console instead.
static class Log
{
    static string? file;
    static readonly object gate = new();

    public static void Start(string name)
    {
        file = Path.Combine(Folders.Data, name + ".log");
        try
        {
            // Keep the last half of a log that has grown past 1 MB.
            if (new FileInfo(file) is { Exists: true, Length: > 1 << 20 })
            {
                var text = File.ReadAllText(file);
                File.WriteAllText(file, text[(text.Length / 2)..]);
            }
        }
        catch (IOException) { }
    }

    public static void Write(string message)
    {
        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} living-wall: {message}";
        if (file is null) { Console.WriteLine(line); return; }
        lock (gate)
        {
            try { File.AppendAllText(file, line + Environment.NewLine); } catch (IOException) { }
        }
    }
}

static class Tasks
{
    /// Lets a task run on without waiting for it, logging it if it fails (nothing else would see that).
    public static void Forget(this Task task, string what) =>
        task.ContinueWith(t => Log.Write($"{what} failed: {t.Exception?.GetBaseException()}"), CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
}

/// The settings, in HKCU\Software\Cefalo\Living Wall, and the screen saver's own (its Motion and
/// weather) under its Screen Saver key. Uninstalling keeps them; `reg delete` clears them.
static class Settings
{
    public const string KeyPath = @"Software\Cefalo\Living Wall";
    public const string SaverKey = "Screen Saver";

    static RegistryKey Open(string sub) => Registry.CurrentUser.CreateSubKey(sub == "" ? KeyPath : $@"{KeyPath}\{sub}");

    public static int? Int(string name, string sub = "")
    {
        using var key = Open(sub);
        return key.GetValue(name) is int value ? value : null;
    }

    public static bool? Bool(string name, string sub = "") => Int(name, sub) is int value ? value != 0 : null;

    public static string? String(string name, string sub = "")
    {
        using var key = Open(sub);
        return key.GetValue(name) as string;
    }

    public static string[] Strings(string name)
    {
        using var key = Open("");
        return key.GetValue(name) as string[] ?? [];
    }

    public static void Set(string name, int value, string sub = "") { using var key = Open(sub); key.SetValue(name, value, RegistryValueKind.DWord); }
    public static void Set(string name, bool value, string sub = "") => Set(name, value ? 1 : 0, sub);
    public static void Set(string name, string value, string sub = "") { using var key = Open(sub); key.SetValue(name, value, RegistryValueKind.String); }
    public static void Set(string name, string[] value) { using var key = Open(""); key.SetValue(name, value, RegistryValueKind.MultiString); }

    public static void Remove(string name, string sub = "") { using var key = Open(sub); key.DeleteValue(name, false); }

    /// The screen saver's Motion level and weather, set in its Options (Saver.cs).
    public static int SaverMotion
    {
        get => HostLogic.MotionLevel(Int("motion", SaverKey));
        set => Set("motion", value, SaverKey);
    }

    public static WeatherChoice SaverWeather
    {
        get => HostLogic.ParseWeather(String("weather", SaverKey));
        set => Set("weather", value.Stored, SaverKey);
    }
}
