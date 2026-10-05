@echo off
rem Remove Cefalo Living Wall and put back your desktop picture and screen saver: double-click
rem this, run it in a terminal, or use Settings > Apps > Installed apps. It ends with a message.
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" -ShowResult %*
exit /b %errorlevel%
