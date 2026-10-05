@echo off
rem Install Cefalo Living Wall, or update it: double-click this, or run it in a terminal.
rem Nothing to install first, and no administrator rights (install.ps1 says what it does).
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set result=%errorlevel%
rem Done, the wall shows for itself; if not, keep the window open to read why.
if %result% neq 0 echo. & echo The install did not finish: see above. & pause
exit /b %result%
