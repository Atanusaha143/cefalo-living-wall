# Runs inside Windows Sandbox when it signs in (clean-install.ps1 sets that up): install Cefalo Living
# Wall on this clean Windows as a user would, with install.cmd and nothing installed first; check
# what that did, the wall moving included; uninstall it with the copy it installed, as Settings >
# Apps does; and check nothing is left. Writes steps.txt as it goes, failures.txt (empty if all
# passed) and done.txt to the results folder, which the host reads.
$ErrorActionPreference = "Continue"
$results = "C:\Users\WDAGUtilityAccount\Desktop\results"
$project = "C:\project"
$app = Join-Path $env:LOCALAPPDATA "Programs\Cefalo Living Wall"
$exe = Join-Path $app "Cefalo Living Wall.exe"
$data = Join-Path $env:LOCALAPPDATA "Cefalo Living Wall"
$shortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Cefalo Living Wall.lnk"
$entryKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CefaloLivingWall"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$failures = New-Object System.Collections.Generic.List[string]
function Note([string]$Line) { "$(Get-Date -Format HH:mm:ss) $Line" | Tee-Object -FilePath (Join-Path $results "steps.txt") -Append }
function Expect([bool]$Ok, [string]$What) {
	Note "$(if ($Ok) { 'ok  ' } else { 'FAIL' }) $What"
	if (-not $Ok) { $failures.Add($What) }
}
function Wallpaper { (Get-ItemProperty 'HKCU:\Control Panel\Desktop').WallPaper }
function Running { [bool](Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in "Cefalo Living Wall", "Cefalo Living Wall.scr" }) }
# How many frames the page says it has drawn, from the newest --report in the app's log.
function Drawn {
	& $exe --report | Out-Null
	Start-Sleep -Seconds 2
	$line = Get-Content (Join-Path $data "Cefalo Living Wall.log") -ErrorAction SilentlyContinue | Where-Object { $_ -match 'screen 0 page: .*"drawn":(\d+)' } | Select-Object -Last 1
	if ($line -match '"drawn":(\d+)') { return [int]$Matches[1] } else { return -1 }
}

try {
	Note "clean Windows: $((Get-CimInstance Win32_OperatingSystem).Caption) $([Environment]::OSVersion.Version)"
	$hadDotnet = [bool](Get-Command dotnet -ErrorAction SilentlyContinue)
	Note ".NET SDK before: $hadDotnet"
	# Explorer's desktop first: the app's wall goes in it.
	Add-Type -Namespace Clean -Name Desk -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string n);'
	for ($i = 0; $i -lt 60 -and -not [Clean.Desk]::FindWindow("Progman", [NullString]::Value); $i++) { Start-Sleep -Seconds 1 }
	$before = Wallpaper

	# The project as a user would have it (the mapped copy is read-only, and the build writes beside it).
	robocopy "C:\Users\WDAGUtilityAccount\Desktop\project" $project /E /XD .git bin obj build node_modules out /NFL /NDL /NJH /NJS /NP | Out-Null
	$t = Get-Date
	cmd.exe /c "`"$project\windows\install.cmd`" < nul" *> (Join-Path $results "install.txt")
	$code = $LASTEXITCODE
	Note "install.cmd took $([int]((Get-Date) - $t).TotalSeconds) s"
	Expect ($code -eq 0) "install.cmd succeeds (exit $code; see install.txt)"
	Start-Sleep -Seconds 8
	Expect (Running) "the app is running"
	Expect (Test-Path $shortcut) "it is in the Start menu"
	$entry = Get-ItemProperty $entryKey -ErrorAction SilentlyContinue
	Expect ($null -ne $entry.UninstallString) "it is in Settings > Apps ($($entry.DisplayName) $($entry.DisplayVersion))"
	Expect ($null -ne (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).'Cefalo Living Wall') "it starts at sign-in"
	Expect ((Wallpaper) -ne $before) "the still is the desktop picture"
	Expect (@(Get-ChildItem ([IO.Path]::GetTempPath()) -Directory -Filter "cefalo-living-wall-*").Count -eq 0) "the build left no tools behind"
	Expect ($hadDotnet -or -not (Get-Command dotnet -ErrorAction SilentlyContinue)) "no .NET was installed on the PC"
	$first = Drawn
	Start-Sleep -Seconds 3
	$second = Drawn
	Expect ($first -ge 0 -and $second - $first -gt 30) "the wall moves behind the icons ($first, then $second frames drawn)"
	Copy-Item (Join-Path $data "Cefalo Living Wall.log") (Join-Path $results "app.log") -ErrorAction SilentlyContinue

	if ($entry.UninstallString) {
		# As Settings > Apps runs it, but with no closing message to wait on.
		$t = Get-Date
		cmd.exe /c "$($entry.UninstallString -replace ' -ShowResult$', '') < nul" *> (Join-Path $results "uninstall.txt")
		$code = $LASTEXITCODE
		Note "uninstall took $([int]((Get-Date) - $t).TotalSeconds) s"
		Expect ($code -eq 0) "the installed uninstaller succeeds (exit $code; see uninstall.txt)"
		Start-Sleep -Seconds 3
		Expect ((Get-Content (Join-Path $results "uninstall.txt") -Raw) -match "previous desktop picture is back") "the previous desktop picture is back"
		Expect (-not (Running)) "the app is gone"
		Expect (-not (Test-Path $app) -and -not (Test-Path $data)) "its folders are gone"
		Expect (-not (Test-Path $shortcut) -and -not (Test-Path $entryKey) -and $null -eq (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).'Cefalo Living Wall') "its Start menu, Settings > Apps and sign-in entries are gone"
	}
} catch {
	Expect $false "the test itself failed: $_"
} finally {
	# Written even when empty (Set-Content writes no file for an empty list).
	[IO.File]::WriteAllLines((Join-Path $results "failures.txt"), [string[]]$failures)
	"done" | Set-Content (Join-Path $results "done.txt")
}
