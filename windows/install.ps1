# Build Cefalo Living Wall and its screen saver, check that both run in WebView2, install them in
# %LOCALAPPDATA%\Programs\Cefalo Living Wall with a Start menu entry and an entry in Settings >
# Apps, and start the app now and at every sign-in. Nothing to install first (build.ps1 fetches
# what it needs), and no administrator rights. Rerun to update. The counterpart of mac/install.sh;
# install.cmd runs it with a double-click.
param([switch]$FetchTools)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "invoke-wall.ps1")
$app = Join-Path $env:LOCALAPPDATA "Programs\Cefalo Living Wall"
$exe = Join-Path $app "Cefalo Living Wall.exe"
$run = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$shortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Cefalo Living Wall.lnk"
$entry = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CefaloLivingWall"

$build = Join-Path ([IO.Path]::GetTempPath()) "cefalo-living-wall-build-$PID"
try {
	& (Join-Path $PSScriptRoot "build.ps1") -Out $build -FetchTools:$FetchTools
	$built = Join-Path $build "Cefalo Living Wall.exe"
	Write-Host "Checking the scene loads..."
	if ((Invoke-Wall $built @("--check")) -ne 0) { throw "the scene check failed" }
	Write-Host "Checking the screen saver runs..."
	if ((Invoke-Wall $built @("--check-saver")) -ne 0) { throw "the screen saver check failed" }

	# A copy started by hand, rather than at sign-in, would keep drawing the old code over the
	# new one, and a running screen saver or preview holds the old files: quit them all.
	Stop-Wall $exe
	if (-not (Remove-Folder $app)) { throw "could not replace $app (is Screen Saver Settings open? close it and try again)" }
	New-Item -ItemType Directory -Force (Split-Path $app) | Out-Null
	Move-Item $build $app
} finally {
	if (Test-Path $build) { Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue }
}

# In the Start menu, as the Mac app is in ~/Applications: to start it again after Quit.
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
$link.TargetPath = $exe
$link.WorkingDirectory = $app
$link.Description = "The Cefalo green wall, alive, as your desktop wallpaper"
$link.Save()
# In Settings > Apps > Installed apps, which runs the uninstaller it brought along.
$size = [int]((Get-ChildItem $app -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
New-Item -Path $entry -Force | Out-Null
$uninstall = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $app 'uninstall.ps1')`" -ShowResult"
@{
	DisplayName = "Cefalo Living Wall"; DisplayIcon = "$exe,0"; InstallLocation = $app; UninstallString = $uninstall
	DisplayVersion = (Get-Item $exe).VersionInfo.ProductVersion -replace '\+.*'   # without the build's commit
}.GetEnumerator() | ForEach-Object { Set-ItemProperty -Path $entry -Name $_.Key -Value $_.Value }
foreach ($flag in "NoModify", "NoRepair") { Set-ItemProperty -Path $entry -Name $flag -Value 1 -Type DWord }
Set-ItemProperty -Path $entry -Name EstimatedSize -Value $size -Type DWord

# At every sign-in; Windows also starts it again after a crash (RegisterApplicationRestart).
Set-ItemProperty -Path $run -Name "Cefalo Living Wall" -Value "`"$exe`""
Start-Process -FilePath $exe
Write-Host "Cefalo Living Wall installed: $app"
Write-Host "Look for the three dots and two leaves in the taskbar's corner (under ^ if Windows hides it); it is in the Start menu too."
Write-Host "It offers to be your screen saver; or choose Screen Saver... in its menu."
