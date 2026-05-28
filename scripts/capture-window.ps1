param(
  [Parameter(Mandatory)][string]$Title,
  [Parameter(Mandatory)][string]$Out,
  [string]$TitleContains = ""
)

Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class WinCap {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public static List<IntPtr> FindWindows(string contains) {
        var list = new List<IntPtr>();
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h)) return true;
            var sb = new System.Text.StringBuilder(256);
            GetWindowText(h, sb, 256);
            var t = sb.ToString();
            if (!string.IsNullOrEmpty(t) && t.IndexOf(contains, StringComparison.OrdinalIgnoreCase) >= 0) list.Add(h);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static RECT GetTrueRect(IntPtr hWnd) {
        RECT r;
        // Try DWM extended frame bounds first (excludes invisible border)
        if (DwmGetWindowAttribute(hWnd, 9 /* DWMWA_EXTENDED_FRAME_BOUNDS */, out r, Marshal.SizeOf(typeof(RECT))) == 0)
            return r;
        GetWindowRect(hWnd, out r);
        return r;
    }
}
"@ -ReferencedAssemblies System.Drawing -ErrorAction Stop

$key = if ($TitleContains) { $TitleContains } else { $Title }
$hwnds = [WinCap]::FindWindows($key)
if ($hwnds.Count -eq 0) { Write-Error "No window matching '$key'"; exit 2 }
$h = $hwnds[0]
Write-Host "Matched HWND=$h for '$key'"

# Bring to foreground
[WinCap]::ShowWindow($h, 9) | Out-Null   # SW_RESTORE
[WinCap]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 400

$r = [WinCap]::GetTrueRect($h)
$w = $r.Right - $r.Left
$hg = $r.Bottom - $r.Top
Write-Host "Rect: L=$($r.Left) T=$($r.Top) W=$w H=$hg"

if ($w -le 1 -or $hg -le 1) { Write-Error "Window has no size"; exit 3 }

$bmp = New-Object System.Drawing.Bitmap $w, $hg
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "Saved $Out"
