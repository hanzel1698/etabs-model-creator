@echo off
rem Starts the ETABS bridge and the web app, each in its own window. Close a window to stop it.
cd /d "%~dp0"
start "ETABS bridge" cmd /k python bridge\bridge.py
start "ETABS app" cmd /k "cd web && npm run dev -- --open"
