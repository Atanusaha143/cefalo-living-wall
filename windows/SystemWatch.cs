// What Windows tells a hidden window of ours about the session: the lock, the displays going
// off, sleep, display changes and Explorer restarting. Shared by the wallpaper app and the
// screen saver; each reason is reported on its own (see PowerState).
using static LivingWall.Native;

namespace LivingWall;

sealed class SystemWatch : NativeWindow, IDisposable
{
    public event Action<bool>? LockChanged;
    /// Another session took the console, or this one was disconnected (true), or came back.
    public event Action<bool>? SessionInactiveChanged;
    /// The displays went off (true), or came back on. Dimmed still counts as on: the wall shows.
    public event Action<bool>? DisplaysOffChanged;
    /// The computer is going to sleep (true) or has woken.
    public event Action<bool>? SleepChanged;
    public event Action? DisplaysChanged;
    /// Explorer started again (after a crash or a restart): the desktop's layer is new.
    public event Action? ExplorerRestarted;
    /// The light or dark mode, or another system setting, changed.
    public event Action<string?>? SettingChanged;

    readonly uint taskbarCreated = RegisterWindowMessage("TaskbarCreated");
    readonly IntPtr displayNotification;

    public SystemWatch()
    {
        // Top level, though never shown: only top-level windows hear display changes and broadcasts.
        CreateHandle(new CreateParams { Caption = "Cefalo Living Wall events", ExStyle = WS_EX_TOOLWINDOW });
        WTSRegisterSessionNotification(Handle, 0);   // NOTIFY_FOR_THIS_SESSION
        var display = GUID_CONSOLE_DISPLAY_STATE;
        displayNotification = RegisterPowerSettingNotification(Handle, ref display, 0);   // DEVICE_NOTIFY_WINDOW_HANDLE
    }

    protected override void WndProc(ref Message m)
    {
        switch (m.Msg)
        {
            case WM_WTSSESSION_CHANGE:
                switch ((int)m.WParam)
                {
                    case WTS_SESSION_LOCK: LockChanged?.Invoke(true); break;
                    case WTS_SESSION_UNLOCK: LockChanged?.Invoke(false); break;
                    case WTS_CONSOLE_DISCONNECT or WTS_REMOTE_DISCONNECT: SessionInactiveChanged?.Invoke(true); break;
                    case WTS_CONSOLE_CONNECT or WTS_REMOTE_CONNECT: SessionInactiveChanged?.Invoke(false); break;
                }
                break;
            case WM_POWERBROADCAST:
                switch ((int)m.WParam)
                {
                    case PBT_APMSUSPEND: SleepChanged?.Invoke(true); break;
                    case PBT_APMRESUMESUSPEND or PBT_APMRESUMEAUTOMATIC: SleepChanged?.Invoke(false); break;
                    case PBT_POWERSETTINGCHANGE:
                        var setting = System.Runtime.InteropServices.Marshal.PtrToStructure<POWERBROADCAST_SETTING>(m.LParam);
                        if (setting.PowerSetting == GUID_CONSOLE_DISPLAY_STATE)
                            DisplaysOffChanged?.Invoke(setting.Data == 0);   // 0 off, 1 on, 2 dimmed
                        break;
                }
                m.Result = 1;
                return;
            case WM_DISPLAYCHANGE:
                DisplaysChanged?.Invoke();
                break;
            case WM_SETTINGCHANGE:
                SettingChanged?.Invoke(m.LParam == 0 ? null : System.Runtime.InteropServices.Marshal.PtrToStringUni(m.LParam));
                break;
            default:
                if (m.Msg == taskbarCreated && taskbarCreated != 0) ExplorerRestarted?.Invoke();
                break;
        }
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (Handle == 0) return;
        WTSUnRegisterSessionNotification(Handle);
        if (displayNotification != 0) UnregisterPowerSettingNotification(displayNotification);
        DestroyHandle();
    }
}
