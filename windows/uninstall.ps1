# Stop Cefalo Living Wall, remove it, its screen saver, its Start menu and Settings > Apps entries
# and its sign-in entry, and put back the previous desktop picture and screen saver. The
# counterpart of mac/uninstall.sh. Runs from the project (uninstall.cmd) or from the installed copy,
# which Settings > Apps starts with no console. -ShowResult ends it with a message (Settings > Apps
# and uninstall.cmd).
param([switch]$ShowResult)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "invoke-wall.ps1")
$app = Join-Path $env:LOCALAPPDATA "Programs\Cefalo Living Wall"
$exe = Join-Path $app "Cefalo Living Wall.exe"
$data = Join-Path $env:LOCALAPPDATA "Cefalo Living Wall"
# Out of the folder about to go (this script may be running from it).
Set-Location ([IO.Path]::GetTempPath())

$restored = $true
if (Test-Path $exe) {
	if ((Invoke-Wall $exe @("--restore-desktop-picture")) -ne 0) { $restored = $false }
	# With the screen saver gone, Windows would have none to start: put back the one it replaced.
	[void](Invoke-Wall $exe @("--restore-screen-saver"))
}
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Cefalo Living Wall" -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath("Programs")) "Cefalo Living Wall.lnk") -ErrorAction SilentlyContinue
Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CefaloLivingWall" -ErrorAction SilentlyContinue
# Every copy, including one started by hand, the screen saver and its preview (the app sets its
# still only as it starts and when displays change, so the picture restored above stays).
Stop-Wall $exe
$removed = Remove-Folder $app
Get-ChildItem $data -Filter *.log -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
$lines = @()
if ($restored) {
	if (-not (Remove-Folder $data)) { $lines += "Could not remove all of $data; delete it by hand." }
	$lines = @("Cefalo Living Wall is removed, and your previous desktop picture is back.") + $lines
} else {
	# The desktop still points at one of the stills, so they stay.
	$lines += "Cefalo Living Wall is removed, but the previous desktop picture could not be put back."
	$lines += "Choose one in Settings > Personalization > Background, then delete: $data"
}
if (-not $removed) { $lines += "Could not remove all of $app; delete it by hand." }
$lines += "Your settings are kept; clear them with: reg delete `"HKCU\Software\Cefalo\Living Wall`" /f"
if ($ShowResult) {
	Add-Type -AssemblyName System.Windows.Forms
	[void][System.Windows.Forms.MessageBox]::Show(($lines -join "`n`n"), "Cefalo Living Wall")
} else {
	$lines | Write-Host
}
