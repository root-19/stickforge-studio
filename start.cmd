@echo off
rem Start StickForge Studio (production build) and open it in your browser.
rem Extra options are passed through, e.g.  start.cmd -Dev  or  start.cmd -Port 4000
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
