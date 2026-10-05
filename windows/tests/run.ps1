# The Windows host's tests: its pure decisions (HostLogicTests.cs), then a fresh build, the real
# scene and screen saver running in WebView2 (the app's --check and --check-saver) and the screen
# saver's preview inside another program's window. Needs the .NET 10 SDK and a signed-in session.
$ErrorActionPreference = "Stop"
$windows = Split-Path $PSScriptRoot
. (Join-Path $windows "invoke-wall.ps1")

& dotnet run --project $PSScriptRoot -v quiet -nologo
if ($LASTEXITCODE -ne 0) { exit 1 }

$build = Join-Path ([IO.Path]::GetTempPath()) "cefalo-living-wall-test-$PID"
try {
	& (Join-Path $windows "build.ps1") -Out $build
	$exe = Join-Path $build "Cefalo Living Wall.exe"
	if (-not (Test-Path (Join-Path $build "Cefalo Living Wall.scr"))) { throw "FAIL: build.ps1 did not make the screen saver" }
	$finder = Get-ChildItem $build -Recurse -Force -Filter .DS_Store
	if ($finder) { throw "FAIL: the build holds Finder's .DS_Store files: $($finder.FullName -join ', ')" }
	if ((Invoke-Wall $exe @("--check")) -ne 0) { exit 1 }
	if ((Invoke-Wall $exe @("--check-saver")) -ne 0) { exit 1 }

	# The preview, as Screen Saver Settings starts it: /p and a window of another program's, which
	# it must fill with the wall within a few seconds, and leave when that window closes.
	Add-Type -AssemblyName System.Windows.Forms, System.Drawing
	Add-Type -Namespace Check -Name Window -MemberDefinition '[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr w, IntPtr dc, uint flags);'
	$box = New-Object System.Windows.Forms.Form -Property @{ FormBorderStyle = "None"; ShowInTaskbar = $false; StartPosition = "Manual"; Location = New-Object System.Drawing.Point(-4000, -4000); Size = New-Object System.Drawing.Size(320, 200) }
	$box.Show()
	# Started directly, not through the shell, whose Open for a .scr adds /S and runs the screen saver.
	$start = New-Object System.Diagnostics.ProcessStartInfo -Property @{ FileName = (Join-Path $build "Cefalo Living Wall.scr"); Arguments = "/p $($box.Handle)"; UseShellExecute = $false }
	$preview = [System.Diagnostics.Process]::Start($start)
	$green = 0
	for ($i = 0; $i -lt 40 -and $green -lt 0.3; $i++) {
		Start-Sleep -Milliseconds 250
		[System.Windows.Forms.Application]::DoEvents()
		$shot = New-Object System.Drawing.Bitmap 320, 200
		$g = [System.Drawing.Graphics]::FromImage($shot); $dc = $g.GetHdc()
		[void][Check.Window]::PrintWindow($box.Handle, $dc, 2)
		$g.ReleaseHdc($dc); $g.Dispose()
		# The wall is mostly leaves (a blank preview has none): count the pixels where green leads.
		$leafy = 0; $all = 0
		for ($y = 4; $y -lt 200; $y += 8) { for ($x = 4; $x -lt 320; $x += 8) { $p = $shot.GetPixel($x, $y); $all++; if ($p.G -gt $p.R -and $p.G -gt $p.B -and $p.G -gt 25) { $leafy++ } } }
		$shot.Dispose()
		$green = $leafy / $all
	}
	$box.Close()
	$gone = $preview.WaitForExit(5000)
	if (-not $gone) { $preview.Kill() }
	if ($green -lt 0.3) { throw "FAIL: the screen saver's preview did not show the wall in the window it was given ($([int]($green * 100)) % leaves)" }
	if (-not $gone) { throw "FAIL: the screen saver's preview kept running after its window closed" }
	Write-Host "Preview check passed: the screen saver fills the window it is given ($([int]($green * 100)) % leaves) and leaves with it"
} finally {
	Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
}
