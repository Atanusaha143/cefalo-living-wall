# Install and uninstall Cefalo Living Wall on a clean Windows, in Windows Sandbox: no .NET SDK, no
# WebView2 Runtime, nothing of the app's. The Sandbox gets this project read-only and runs
# clean-install-inside.ps1, which installs with install.cmd as a user would, checks it, uninstalls
# and checks that too. Nothing touches this PC: the Sandbox is thrown away. Needs Windows Sandbox
# (Windows Pro or Enterprise) and the internet, and takes about five minutes.
$ErrorActionPreference = "Stop"
$repo = Split-Path (Split-Path $PSScriptRoot)
$sandbox = Join-Path $env:windir "System32\WindowsSandbox.exe"
if (-not (Test-Path $sandbox)) {
	throw "Windows Sandbox is off. Turn it on in PowerShell as administrator, then restart: Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All"
}
# A Sandbox is open while its window is: its launcher, and the window itself (Windows 11 24H2 and
# later run it as WindowsSandboxRemoteSession, earlier ones as WindowsSandboxClient). Its server
# stays on, idle, after a Sandbox closes; that is Windows' own and left alone.
function Get-SandboxWindow {
	Get-Process -Name WindowsSandbox, WindowsSandboxRemoteSession, WindowsSandboxClient -ErrorAction SilentlyContinue
}
if (Get-SandboxWindow) { throw "Windows Sandbox is already open, and only one can run: close it first." }

$results = Join-Path ([IO.Path]::GetTempPath()) "cefalo-living-wall-clean-install"
if (Test-Path $results) { Remove-Item $results -Recurse -Force }
New-Item -ItemType Directory $results | Out-Null
Copy-Item (Join-Path $PSScriptRoot "clean-install-inside.ps1") $results
$config = Join-Path $results "clean-install.wsb"
@"
<Configuration>
  <VGpu>Enable</VGpu>
  <Networking>Enable</Networking>
  <MemoryInMB>8192</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>$repo</HostFolder><SandboxFolder>C:\Users\WDAGUtilityAccount\Desktop\project</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$results</HostFolder><SandboxFolder>C:\Users\WDAGUtilityAccount\Desktop\results</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\WDAGUtilityAccount\Desktop\results\clean-install-inside.ps1</Command></LogonCommand>
</Configuration>
"@ | Set-Content $config -Encoding UTF8

Write-Host "Starting Windows Sandbox: its window opens; leave it be until this finishes."
Start-Process -FilePath $sandbox -ArgumentList "`"$config`""
$steps = Join-Path $results "steps.txt"
$shown = 0
$deadline = (Get-Date).AddMinutes(30)
try {
	Start-Sleep -Seconds 15
	do {
		Start-Sleep -Seconds 5
		# The Sandbox writes the steps as it goes: show the new ones.
		$lines = @(try { Get-Content $steps -ErrorAction Stop } catch { })
		if ($lines.Count -gt $shown) { $lines[$shown..($lines.Count - 1)] | Write-Host; $shown = $lines.Count }
		if (Test-Path (Join-Path $results "done.txt")) { break }
		if (-not (Get-SandboxWindow)) { throw "Windows Sandbox closed before the test finished" }
		if ((Get-Date) -gt $deadline) { throw "the clean install took over 30 minutes" }
	} while ($true)
	$lines = @(Get-Content $steps)
	if ($lines.Count -gt $shown) { $lines[$shown..($lines.Count - 1)] | Write-Host }
} finally {
	# Closing its window throws the Sandbox away, with everything installed in it.
	Get-SandboxWindow | Stop-Process -Force -ErrorAction SilentlyContinue
	Get-SandboxWindow | Wait-Process -Timeout 20 -ErrorAction SilentlyContinue
}
$failures = @(Get-Content (Join-Path $results "failures.txt") | Where-Object { $_ })
if ($failures.Count -gt 0) {
	Write-Host "FAIL: $($failures.Count) check(s) failed on a clean Windows; the logs are in $results"
	exit 1
}
Write-Host "Clean install passed: installed with nothing installed first, the wall moving, then uninstalled leaving nothing behind."
