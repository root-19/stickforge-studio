@echo off
rem One-time setup: checks Node.js and FFmpeg, installs packages, builds the app.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %*
pause
