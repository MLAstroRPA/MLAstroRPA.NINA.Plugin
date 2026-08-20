# MLAstro Robotic Polar Alignment - MSI Build Script
# Creates MSI installer using WiX Toolset v5

param(
    [string]$Configuration = "Release",
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$MSIProjectDir = $ScriptDir
$OutputDir = Join-Path (Split-Path -Parent $ScriptDir) "Output"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "MLAstro RPA Plugin - MSI Builder" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check for WiX Toolset
Write-Host "Checking for WiX Toolset..." -ForegroundColor Yellow

$wixInstalled = $false
try {
    $wixCheck = dotnet tool list -g | Select-String "wix"
    if ($wixCheck) {
        $wixInstalled = $true
        Write-Host "WiX Toolset found (global tool)" -ForegroundColor Green
    }
} catch {}

if (-not $wixInstalled) {
    Write-Host "WiX Toolset not found. Installing..." -ForegroundColor Yellow
    dotnet tool install --global wix
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to install WiX Toolset" -ForegroundColor Red
        exit 1
    }
    Write-Host "WiX Toolset installed!" -ForegroundColor Green
}

# Install WiX UI extension if needed
Write-Host "Ensuring WiX UI extension..." -ForegroundColor Yellow
wix extension add -g WixToolset.UI.wixext
wix extension add -g WixToolset.Util.wixext

# Step 1: Build main project
Write-Host ""
Write-Host "[1/3] Building main project..." -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    dotnet build -c $Configuration --verbosity minimal
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "Build successful!" -ForegroundColor Green
}
finally {
    Pop-Location
}

# Step 2: Build MSI
Write-Host ""
Write-Host "[2/3] Building MSI package..." -ForegroundColor Yellow

Push-Location $MSIProjectDir
try {
    dotnet build -c $Configuration -p:Version=$Version --verbosity minimal
    if ($LASTEXITCODE -ne 0) {
        Write-Host "MSI build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "MSI build successful!" -ForegroundColor Green
}
finally {
    Pop-Location
}

# Step 3: Copy MSI to output
Write-Host ""
Write-Host "[3/3] Copying MSI to output..." -ForegroundColor Yellow

# Ensure output directory exists
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# Find the MSI file
$msiSource = Get-ChildItem -Path "$MSIProjectDir\bin\$Configuration" -Filter "*.msi" -Recurse | Select-Object -First 1

if ($msiSource) {
    $msiDest = Join-Path $OutputDir "MLAstro_RPA_Plugin_$Version.msi"
    Copy-Item -Path $msiSource.FullName -Destination $msiDest -Force
    
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "MSI BUILD COMPLETE!" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "MSI location:" -ForegroundColor White
    Write-Host "  $msiDest" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Size: $([math]::Round((Get-Item $msiDest).Length / 1KB, 2)) KB" -ForegroundColor Gray
} else {
    Write-Host "ERROR: MSI file not found in build output!" -ForegroundColor Red
    Write-Host "Check: $MSIProjectDir\bin\$Configuration" -ForegroundColor Yellow
    exit 1
}
