# Build a Windows installer for PDF Editor.
# Run this on Windows (PowerShell), from anywhere:
#   powershell -ExecutionPolicy Bypass -File desktop\build-windows.ps1
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
Write-Host "Building PDF Editor in $Root"

function Invoke-Py([string[]]$PyArgs) {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3 @PyArgs
    } else {
        & python @PyArgs
    }
    if ($LASTEXITCODE -ne 0) { throw "Python command failed: $($PyArgs -join ' ')" }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is not installed. Install Node.js 20 or newer from https://nodejs.org"
}
if (-not (Get-Command py -ErrorAction SilentlyContinue) -and -not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python is not installed. Install Python 3.11 or newer from https://www.python.org/downloads/ and tick 'Add python.exe to PATH'."
}

$versionLine = (Invoke-Py @("-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')") | Out-String).Trim()
$parts = $versionLine.Split(".")
if ([int]$parts[0] -lt 3 -or ([int]$parts[0] -eq 3 -and [int]$parts[1] -lt 11)) {
    throw "Python 3.11 or newer is required. Found $versionLine"
}

$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    Write-Host "Creating .venv"
    Invoke-Py @("-m", "venv", ".venv")
}

Write-Host "Installing Python packages"
& $VenvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed" }
& $VenvPython -m pip install -r (Join-Path $Root "backend\requirements.txt") pyinstaller
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

$worker = Join-Path $Root "frontend\node_modules\pdfjs-dist\build\pdf.worker.min.mjs"
Write-Host "Building the editor UI"
Push-Location (Join-Path $Root "frontend")
if (Test-Path "package-lock.json") { npm ci } else { npm install }
if ($LASTEXITCODE -ne 0) { throw "npm install failed in frontend" }
if (Test-Path $worker) {
    Copy-Item $worker (Join-Path $Root "frontend\public\pdf.worker.min.mjs") -Force
}
npm run build
if ($LASTEXITCODE -ne 0) { throw "next build failed" }
Pop-Location

Write-Host "Packaging the UI"
& node (Join-Path $Root "desktop\assemble-frontend.mjs")
if ($LASTEXITCODE -ne 0) { throw "Could not assemble the frontend" }

Write-Host "Packaging the API server"
$dist = Join-Path $Root "desktop\build"
$work = Join-Path $Root "desktop\pyinstaller-work"
& $VenvPython -m PyInstaller --noconfirm --clean `
    --distpath $dist `
    --workpath $work `
    (Join-Path $Root "desktop\pdf-editor-backend.spec")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

Write-Host "Building the Windows app"
Push-Location (Join-Path $Root "desktop")
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed in desktop" }
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npx electron-builder --win
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
Pop-Location

Write-Host ""
Write-Host "Done. Installers are in desktop\release"
Get-ChildItem (Join-Path $Root "desktop\release\*.exe") | ForEach-Object { Write-Host $_.FullName }
