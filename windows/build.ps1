# Build Cefalo Living Wall for Windows into the folder given (default: build\windows): the app,
# with .NET itself inside, so the PC needs none; its own copy of the scene; its icon; the still of
# the scene's first frame; the screen saver, which is the same program as "Cefalo Living Wall.scr";
# and the uninstaller. Builds with this PC's .NET 10 SDK if it has one, or else with a private copy
# fetched from Microsoft for the build and deleted after it, and installs Microsoft's WebView2
# Runtime if Windows lacks it (invoke-wall.ps1), so there is nothing to install first.
# Needs a signed-in session: the app renders the still and checks the scene in WebView2.
param(
	[string]$Out = (Join-Path (Split-Path $PSScriptRoot) "build\windows"),
	# Fetch the private SDK even if this PC has one: the way a PC without one builds.
	[switch]$FetchTools
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Windows PowerShell's progress bar slows downloads to a crawl
$project = Join-Path $PSScriptRoot "LivingWall.csproj"
# Built for this PC's own architecture.
$rid = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "win-arm64" } else { "win-x64" }
$exe = Join-Path $Out "Cefalo Living Wall.exe"
. (Join-Path $PSScriptRoot "invoke-wall.ps1")
# The SDK reports how it is used to Microsoft unless told not to; the app itself never connects anywhere.
$env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
$env:DOTNET_NOLOGO = "1"

# The latest .NET 10 SDK, from Microsoft's own list of releases, checked against the list's hash,
# into $Folder. Returns its dotnet.exe.
function Get-Sdk([string]$Folder) {
	$list = Join-Path $Folder "releases.json"
	Get-Download "https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json" $list
	$latest = (Get-Content $list -Raw | ConvertFrom-Json).releases | Select-Object -First 1
	$file = $latest.sdk.files | Where-Object { $_.rid -eq $rid -and $_.name -like "*.zip" } | Select-Object -First 1
	if (-not $file) { throw "Microsoft lists no .NET 10 SDK for $rid" }
	Write-Host "Fetching the .NET $($latest.sdk.version) SDK from Microsoft, for the build only (about 250 MB)..."
	$zip = Join-Path $Folder $file.name
	Get-Download $file.url $zip
	if ((Get-FileHash $zip -Algorithm SHA512).Hash -ne $file.hash) { throw "the .NET SDK download does not match Microsoft's hash" }
	$sdk = Join-Path $Folder "dotnet"
	New-Item -ItemType Directory -Force $sdk | Out-Null
	& (Join-Path $env:windir "System32\tar.exe") -xf $zip -C $sdk
	if ($LASTEXITCODE -ne 0) { throw "could not unpack the .NET SDK" }
	Remove-Item $zip
	return (Join-Path $sdk "dotnet.exe")
}

# This PC's .NET 10 SDK, if it has one.
function Find-Sdk {
	$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
	if (-not $dotnet) { return $null }
	if (& $dotnet.Source --list-sdks 2>$null | Where-Object { $_ -match '^10\.' }) { return $dotnet.Source }
	return $null
}

# The WebView2 Runtime first: the build draws the still in it.
Install-WebView2

$tools = $null
$dotnet = if ($FetchTools) { $null } else { Find-Sdk }
try {
	if (-not $dotnet) {
		# A private SDK, with its own package folder, both deleted below: nothing stays on the PC.
		$tools = Join-Path ([IO.Path]::GetTempPath()) "cefalo-living-wall-tools-$PID"
		New-Item -ItemType Directory -Force $tools | Out-Null
		$dotnet = Get-Sdk $tools
		$env:NUGET_PACKAGES = Join-Path $tools "packages"
		$env:DOTNET_MULTILEVEL_LOOKUP = "0"
	}

	# No build servers: they would outlive the build, holding a private SDK's files.
	function Publish([string[]]$Extra) {
		& $dotnet publish $project -c Release -r $rid --self-contained true -o $Out -v quiet -nologo --disable-build-servers @Extra | Write-Host
		if ($LASTEXITCODE -ne 0) { throw "the build failed" }
	}

	if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
	New-Item -ItemType Directory -Force $Out | Out-Null
	Write-Host "Building..."
	Publish @()
	# Its icon: the tray icon's mark in Cefalo's colours on a white tile, every size, drawn by the app
	# itself, then built into it.
	$icon = Join-Path ([IO.Path]::GetTempPath()) "cefalo-living-wall-icon-$PID.ico"
	if ((Invoke-Wall $exe @("--render-icon", (Quote $icon))) -ne 0) { throw "could not render the icon" }
	Publish @("-p:AppIcon=$icon")
	Remove-Item $icon
} finally {
	if ($tools) {
		if ($dotnet -and (Test-Path $dotnet)) { & $dotnet build-server shutdown 2>&1 | Out-Null }
		Remove-Item $tools -Recurse -Force -ErrorAction SilentlyContinue
		if (Test-Path $tools) { Write-Warning "Could not remove the build's tools from $tools; delete them by hand." }
	}
}
# The scene's first frame, with the leaves it adds to the photo: the desktop picture, and the
# screen saver's still while the scene loads.
if ((Invoke-Wall $exe @("--render-still", (Quote (Join-Path $Out "still.jpg")))) -ne 0) { throw "could not render the still" }
# The screen saver: the same program; Windows starts a .scr with /s, /p or /c.
Copy-Item $exe (Join-Path $Out "Cefalo Living Wall.scr")
# The uninstaller goes with the app, for Settings > Apps.
Copy-Item (Join-Path $PSScriptRoot "uninstall.ps1"), (Join-Path $PSScriptRoot "invoke-wall.ps1") $Out
# Finder's files, should the scene have come from a Mac.
Get-ChildItem $Out -Recurse -Force -Filter .DS_Store | Remove-Item -Force
Write-Host "Built $Out"
