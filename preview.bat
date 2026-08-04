@echo off
REM ===================================================================
REM  preview.bat - see your portfolio on this computer before publishing
REM
REM  Just double-click this file. It starts a small web server in this
REM  folder and opens your portfolio in your browser.
REM
REM  Why this is needed: browsers refuse to let a page opened straight
REM  from a folder read data files, so double-clicking index.html shows
REM  an error. This works around that.
REM
REM  To stop it, close the black window that appears.
REM ===================================================================

cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Python was not found on this computer.
  echo  Install it from https://www.python.org/downloads/ and tick
  echo  "Add Python to PATH" during setup, then run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo  Starting preview at http://localhost:8000
echo  Add ?edit=1 to the address to edit:  http://localhost:8000/?edit=1
echo.
echo  Close this window when you are finished.
echo.

start "" http://localhost:8000/
python -m http.server 8000
