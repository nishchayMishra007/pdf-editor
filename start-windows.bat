@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js 20 or newer from https://nodejs.org
  echo Then double-click this file again.
  pause
  exit /b 1
)

set "PY="
where py >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if not defined PY (
  where python >nul 2>&1
  if not errorlevel 1 set "PY=python"
)
if not defined PY (
  echo Python is not installed.
  echo Install Python 3.11 or newer from https://www.python.org/downloads/
  echo Tick "Add python.exe to PATH" in the installer, then run this file again.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating the Python environment...
  %PY% -m venv .venv
  if errorlevel 1 goto :fail
)

echo Installing Python packages...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :fail
".venv\Scripts\python.exe" -m pip install -r "%~dp0backend\requirements.txt"
if errorlevel 1 goto :fail

if not exist "frontend\node_modules\" (
  echo Installing the editor UI...
  pushd "%~dp0frontend"
  call npm install
  if errorlevel 1 (
    popd
    goto :fail
  )
  popd
)

echo Starting PDF Editor...
start "PDF Editor API" /MIN cmd /c "cd /d ""%~dp0backend"" && ""%~dp0.venv\Scripts\python.exe"" desktop_entry.py"
start "PDF Editor UI" /MIN cmd /c "cd /d ""%~dp0frontend"" && npm run dev -- --port 3000 --hostname 127.0.0.1"

echo Waiting for the window to come up...
set /a tries=0
:waitloop
set /a tries+=1
if %tries% gtr 60 goto :slow
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000 -TimeoutSec 2).StatusCode | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 goto :open
timeout /t 2 /nobreak >nul
goto :waitloop

:open
start "" http://127.0.0.1:3000
echo.
echo PDF Editor is open in the browser.
echo Two minimized windows (API and UI) keep it running. Close them to quit.
pause
exit /b 0

:slow
echo The UI did not answer on http://127.0.0.1:3000
echo Check the minimized "PDF Editor API" and "PDF Editor UI" windows for errors.
pause
exit /b 1

:fail
echo.
echo Setup failed. Read the messages above.
pause
exit /b 1
