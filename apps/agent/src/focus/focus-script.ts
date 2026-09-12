/**
 * Raises the top-level window of a Claude Code session on Windows. The session's pid and the last
 * segment of its working directory arrive in CLAWD_FOCUS_PID and CLAWD_FOCUS_FOLDER; nothing is
 * interpolated into this text. Exit codes: 0 raised, 2 flashed instead, 3 no window found, 1 error.
 */
export const FOCUS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $targetPid = [uint32]$env:CLAWD_FOCUS_PID
  $folder = [string]$env:CLAWD_FOCUS_FOLDER
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ClawdFocus {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO info);
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();

  [StructLayout(LayoutKind.Sequential)]
  public struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }

  public static List<KeyValuePair<IntPtr, string>> TopWindows(HashSet<uint> pids) {
    var found = new List<KeyValuePair<IntPtr, string>>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      uint owner;
      GetWindowThreadProcessId(h, out owner);
      if (pids.Contains(owner) && IsWindowVisible(h) && GetWindow(h, 4) == IntPtr.Zero) {
        var title = new StringBuilder(512);
        GetWindowText(h, title, title.Capacity);
        if (title.Length > 0) found.Add(new KeyValuePair<IntPtr, string>(h, title.ToString()));
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static int Raise(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
    if (GetForegroundWindow() == h) return 0;
    var info = new FLASHWINFO();
    info.cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO));
    info.hwnd = h;
    info.dwFlags = 3 | 12;
    info.uCount = 3;
    info.dwTimeout = 0;
    FlashWindowEx(ref info);
    return 2;
  }
}
'@
  $procs = @{}
  foreach ($p in Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, Name) { $procs[[uint32]$p.ProcessId] = $p }
  $editors = @('code.exe', 'code - insiders.exe', 'cursor.exe')
  $hwnd = [IntPtr]::Zero
  $current = $targetPid
  for ($i = 0; $i -lt 12 -and $hwnd -eq [IntPtr]::Zero; $i++) {
    if (-not $procs.ContainsKey($current)) { break }
    $p = $procs[$current]
    $name = ([string]$p.Name).ToLowerInvariant()
    if ($editors -contains $name) {
      if ($folder.Length -gt 0) {
        $pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
        foreach ($q in $procs.Values) { if (([string]$q.Name).ToLowerInvariant() -eq $name) { [void]$pids.Add([uint32]$q.ProcessId) } }
        $windows = [ClawdFocus]::TopWindows($pids)
        $exact = @($windows | Where-Object { ($_.Value -split ' [-—] ') -contains $folder })
        $loose = @($windows | Where-Object { $_.Value.IndexOf($folder, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
        if ($exact.Count -gt 0) { $hwnd = $exact[0].Key } elseif ($loose.Count -gt 0) { $hwnd = $loose[0].Key }
      }
      break
    }
    $proc = Get-Process -Id ([int]$current) -ErrorAction SilentlyContinue
    if ($null -ne $proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $proc.MainWindowHandle; break }
    $current = [uint32]$p.ParentProcessId
  }
  if ($hwnd -eq [IntPtr]::Zero) {
    [void][ClawdFocus]::FreeConsole()
    if ([ClawdFocus]::AttachConsole($targetPid)) {
      $console = [ClawdFocus]::GetConsoleWindow()
      [void][ClawdFocus]::FreeConsole()
      if ($console -ne [IntPtr]::Zero -and [ClawdFocus]::IsWindowVisible($console)) { $hwnd = $console }
    }
  }
  if ($hwnd -eq [IntPtr]::Zero) { exit 3 }
  exit ([ClawdFocus]::Raise($hwnd))
} catch {
  exit 1
}
`;
