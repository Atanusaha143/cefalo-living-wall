# Shared by build.ps1, install.ps1, uninstall.ps1 and tests\run.ps1: running "Cefalo Living Wall.exe"
# and waiting for it, downloading what the build needs, and quitting and removing the installed copy.

# Run the program with some switches, wait for it (it is a Windows app, which PowerShell would not
# wait for), print what it says and return its exit code.
function Invoke-Wall([string]$Exe, [string[]]$Arguments) {
	$said = New-TemporaryFile
	try {
		$run = Start-Process -FilePath $Exe -ArgumentList $Arguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput $said
		Get-Content $said | Write-Host
		return $run.ExitCode
	} finally {
		Remove-Item $said -ErrorAction SilentlyContinue
	}
}

# A path as one argument, quoted for the program's command line.
function Quote([string]$Path) { return "`"$Path`"" }

# Downloads with Windows' own curl.exe: company PCs often stop PowerShell itself from downloading
# (Invoke-WebRequest, and so Microsoft's dotnet-install.ps1), but not curl.
function Get-Download([string]$Url, [string]$File) {
	$curl = Join-Path $env:windir "System32\curl.exe"
	if (Test-Path $curl) {
		& $curl -fsSL --retry 3 -o $File $Url
		if ($LASTEXITCODE -ne 0) { throw "could not download $Url (curl exit $LASTEXITCODE)" }
	} else {
		# Windows PowerShell does not offer TLS 1.2 by default, and Microsoft's servers ask for it.
		[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
		Invoke-WebRequest -Uri $Url -OutFile $File -UseBasicParsing
	}
}

# The WebView2 Runtime's version, from where Microsoft says to look (installed for the PC, or for
# this user), or $null without one.
function Get-WebView2 {
	$client = "Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
	foreach ($key in "HKLM:\SOFTWARE\WOW6432Node\$client", "HKLM:\SOFTWARE\$client", "HKCU:\Software\$client") {
		$version = (Get-ItemProperty $key -ErrorAction SilentlyContinue).pv
		if ($version -and $version -ne "0.0.0.0") { return $version }
	}
	return $null
}

# The WebView2 Runtime the wall is drawn in. Windows 11 includes it, but some Windows lack it (company
# images, LTSC editions, Windows Sandbox): then Microsoft's own installer, checked to be signed by
# Microsoft, installs it, for this user only, needing no administrator rights. It stays when the
# app goes, since other apps use it, and Microsoft keeps it up to date.
function Install-WebView2 {
	if (Get-WebView2) { return }
	Write-Host "This PC has no WebView2 Runtime, which the wall is drawn in: installing Microsoft's (about 150 MB)..."
	$setup = Join-Path ([IO.Path]::GetTempPath()) "MicrosoftEdgeWebview2Setup-$PID.exe"
	try {
		Get-Download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" $setup
		$signature = Get-AuthenticodeSignature $setup
		if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch "O=Microsoft Corporation") {
			throw "the WebView2 installer is not signed by Microsoft ($($signature.Status))"
		}
		$run = Start-Process -FilePath $setup -ArgumentList "/silent", "/install" -Wait -PassThru
		if ($run.ExitCode -ne 0 -or -not (Get-WebView2)) { throw "could not install the WebView2 Runtime (exit $($run.ExitCode))" }
		Write-Host "WebView2 Runtime $(Get-WebView2) installed."
	} finally {
		Remove-Item $setup -ErrorAction SilentlyContinue
	}
}

# Every running copy of the app, and of the screen saver or its preview, whose process Windows names
# with its .scr.
function Get-WallProcesses {
	Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in "Cefalo Living Wall", "Cefalo Living Wall.scr" }
}

# Quit the app as from its menu (quitting never changes the desktop picture) and wait for every copy
# to go, ending whatever is left after 10 s: a copy started by hand, the screen saver, its preview.
function Stop-Wall([string]$Exe) {
	if (Test-Path $Exe) { [void](Invoke-Wall $Exe @("--quit")) }
	$deadline = (Get-Date).AddSeconds(10)
	while ((Get-WallProcesses) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
	Get-WallProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
}

# Remove a folder, trying again for a few seconds: WebView2's own processes can hold the app's files
# for a moment after it quits. Returns whether it is gone.
function Remove-Folder([string]$Folder) {
	for ($try = 0; (Test-Path $Folder) -and $try -lt 10; $try++) {
		try { Remove-Item $Folder -Recurse -Force -ErrorAction Stop } catch { Start-Sleep -Milliseconds 500 }
	}
	return -not (Test-Path $Folder)
}
