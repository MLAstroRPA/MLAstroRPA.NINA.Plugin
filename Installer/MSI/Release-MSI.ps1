# MLAstro Robotic Polar Alignment - MSI Build Script
# Creates MSI installer using WiX Toolset v5

param(
    [string]$Configuration = "Release",
    [string]$Version = "",
    [switch]$CreateRelease,
    [string]$Repo = "",
    [string]$TPPAProjectDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$MSIProjectDir = $ScriptDir
$OutputDir = Join-Path (Split-Path -Parent $ScriptDir) "Output"
$PackageWxs = Join-Path $MSIProjectDir "Package.wxs"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "MLAstro RPA Plugin - MSI Builder" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ========== VERSION PUMP ==========
if ([string]::IsNullOrWhiteSpace($Version)) {
    # Announce the current version already present in Output (if any)
    $existingMsi = Get-ChildItem -Path $OutputDir -Filter "MLAstro_RPA_Plugin_*.msi" -ErrorAction SilentlyContinue |
                   Sort-Object Name -Descending | Select-Object -First 1
    $currentVersion = $null

    if ($existingMsi) {
        if ($existingMsi.Name -match 'MLAstro_RPA_Plugin_(\d+\.\d+\.\d+(\.\d+)?)\.msi') {
            $currentVersion = $matches[1]
            Write-Host "Current version in Output: $currentVersion  ($($existingMsi.Name))" -ForegroundColor Green
        } else {
            Write-Host "Found in Output: $($existingMsi.Name) (cannot parse version)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Output: chua co MSI nao (no output yet)." -ForegroundColor Yellow
    }

    # Suggest the next patch version (e.g. 2.0.0.1 -> 2.0.0.2)
    $suggested = "1.0.0"
    if ($currentVersion -match '^(\d+)\.(\d+)\.(\d+)$') {
        $suggested = "{0}.{1}.{2}" -f $matches[1], $matches[2], ([int]$matches[3] + 1)
    } elseif ($currentVersion -match '^(\d+)\.(\d+)\.(\d+)\.(\d+)$') {
        $suggested = "{0}.{1}.{2}.{3}" -f $matches[1], $matches[2], $matches[3], ([int]$matches[4] + 1)
    }

    do {
        $Version = Read-Host "Enter new version [default: $suggested]"
        if ([string]::IsNullOrWhiteSpace($Version)) { $Version = $suggested }
        if ($Version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') {
            Write-Host "Invalid version format - use e.g. 2.0.0.2" -ForegroundColor Red
            $Version = ""
        }
    } while ([string]::IsNullOrWhiteSpace($Version))

    Write-Host "Version set to: $Version" -ForegroundColor Green
}

# Sync the ProductVersion define in Package.wxs with the chosen version
$wxsContent = [System.IO.File]::ReadAllText($PackageWxs)
if ($wxsContent -match '<\?define ProductVersion = "[^"]*" \?>') {
    $wxsContent = $wxsContent -replace '<\?define ProductVersion = "[^"]*" \?>', "<?define ProductVersion = `"$Version`" ?>"
    [System.IO.File]::WriteAllText($PackageWxs, $wxsContent, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "Package.wxs ProductVersion updated to $Version" -ForegroundColor Green
} else {
    Write-Host "WARNING: Could not find ProductVersion define in Package.wxs" -ForegroundColor Yellow
}

# ========== TPPA FORK VERSION SYNC ==========
# Mỗi lần build MSI phiên bản mới, đẩy version đó sang fork TPPA: cập nhật marker
# "MLAstroRPA version: X.Y.Z" (trong NINA.Plugins.PolarAlignment.csproj <Description> v.v.),
# build lại TPPA (Release) và stage DLL mới vào Installer\MSI\Plugin\Three Point Polar Alignment
# để MSI gói đúng bản TPPA mang version khớp với plugin MLAstro.
if ([string]::IsNullOrWhiteSpace($TPPAProjectDir)) {
    $TPPAProjectDir = Join-Path (Split-Path -Parent $ProjectRoot) "Three Point Polar Alignment - PULL-REQUEST\PolarAlignment"
}

$tppaProject = Join-Path $TPPAProjectDir "NINA.Plugins.PolarAlignment.csproj"
if (Test-Path $tppaProject) {
    Write-Host "Syncing MLAstroRPA version $Version into TPPA fork..." -ForegroundColor Yellow

    # 1) Cập nhật marker "MLAstroRPA version:" trong mọi file nguồn TPPA còn chứa marker này
    $versionMarkerPattern = 'MLAstroRPA version: \d+(\.\d+)+'
    $tppaFiles = @(
        $tppaProject,
        (Join-Path $TPPAProjectDir "Properties\AssemblyInfo.cs")
    )
    foreach ($tppaFile in $tppaFiles) {
        if (-not (Test-Path $tppaFile)) { continue }
        $content = [System.IO.File]::ReadAllText($tppaFile)
        $updated = [regex]::Replace($content, $versionMarkerPattern, "MLAstroRPA version: $Version")
        if ($updated -ne $content) {
            [System.IO.File]::WriteAllText($tppaFile, $updated, (New-Object System.Text.UTF8Encoding $false))
            Write-Host "  Updated version marker in: $tppaFile" -ForegroundColor Green
        }
    }

    # 2) Build lại TPPA (Release) để version mới nằm trong metadata của DLL
    Write-Host "Building TPPA fork (Release)..." -ForegroundColor Yellow
    Push-Location $TPPAProjectDir
    try {
        dotnet build $tppaProject -c Release -tl:off
        if ($LASTEXITCODE -ne 0) {
            throw "TPPA fork Release build failed - the MSI would package a stale TPPA DLL."
        }
    } finally {
        Pop-Location
    }

    # 3) Stage DLL TPPA vừa build vào thư mục MSI harvest
    $tppaDll = Join-Path $TPPAProjectDir "bin\Release\net8.0-windows7.0\NINA.Plugins.PolarAlignment.dll"
    $tppaStaging = Join-Path $MSIProjectDir "Plugin\Three Point Polar Alignment"
    if ((Test-Path $tppaDll) -and (Test-Path $tppaStaging)) {
        Copy-Item -Path $tppaDll -Destination (Join-Path $tppaStaging "NINA.Plugins.PolarAlignment.dll") -Force
        Write-Host "  Staged TPPA DLL into: $tppaStaging" -ForegroundColor Green
    } else {
        Write-Host "WARNING: TPPA DLL or staging folder not found - MSI may package a stale TPPA DLL." -ForegroundColor Yellow
    }
} else {
    Write-Host "WARNING: TPPA fork project not found at $TPPAProjectDir - skipping TPPA version sync." -ForegroundColor Yellow
}

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

# NOTE: The WiX UI/Util extensions are NOT added globally here. Both are already
# referenced as <PackageReference> in MLAstro.RPA.Installer.wixproj (WixToolset.UI.wixext
# and WixToolset.Util.wixext), so `dotnet build` resolves them from NuGet. Calling
# `wix extension add -g` would target the global WiX v7 tool, which now requires accepting
# the OSMF EULA (error WIX7015) and is not needed for this project.

# Step 1: Build MSI
# NOTE: The plugin project (MLAstro_Robotic_Polar_Alignment.csproj) is intentionally NOT
# built separately here. The MSI project references it via <ProjectReference> in
# MLAstro.RPA.Installer.wixproj, so `dotnet build` below compiles the plugin automatically
# as a dependency before packaging (Package.wxs uses $(var.MLAstro_Robotic_Polar_Alignment.TargetDir)
# to harvest the DLL). Building the plugin again first would just duplicate the compile.
Write-Host ""
Write-Host "[1/2] Building MSI package..." -ForegroundColor Yellow

Push-Location $MSIProjectDir
try {
    # -tl:off forces the classic console logger so the plugin's MSBuild <Message>
    # output (e.g. the DLL copy confirmations) is visible in the terminal.
    dotnet build -c $Configuration -p:Version=$Version --verbosity minimal -tl:off
    if ($LASTEXITCODE -ne 0) {
        Write-Host "MSI build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "MSI build successful!" -ForegroundColor Green
}
finally {
    Pop-Location
}

# Step 2: Copy MSI to output
Write-Host ""
Write-Host "[2/2] Copying MSI to output..." -ForegroundColor Yellow

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

# ========== GITHUB RELEASE (optional, enabled with -CreateRelease) ==========
# Creates a new GitHub release v<version> on the repo and uploads:
#   - the MSI
#   - the plugin DLLs staged in Installer/MSI/Plugin
if ($CreateRelease) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Magenta
    Write-Host "GITHUB RELEASE" -ForegroundColor Magenta
    Write-Host "============================================" -ForegroundColor Magenta

    $tag = "v$Version"

    # Locate the GitHub CLI (gh). It may not be on PATH when VS Code was started before
    # the install, so also probe the standard install locations and use the full path.
    $ghExe = "gh"
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $gh) {
        $ghPath = @(
            "C:\Program Files\GitHub CLI\gh.exe",
            "C:\Program Files (x86)\GitHub CLI\gh.exe",
            "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe",
            "$env:USERPROFILE\scoop\shims\gh.exe"
        ) | Where-Object { Test-Path $_ } | Select-Object -First 1
        if ($ghPath) {
            $ghExe = $ghPath
        } else {
            Write-Host "ERROR: GitHub CLI (gh) not found. Install from https://cli.github.com/ and run 'gh auth login'." -ForegroundColor Red
            exit 1
        }
    }

    & $ghExe auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Not authenticated with GitHub. Run 'gh auth login' first." -ForegroundColor Red
        exit 1
    }

    # Auto-detect the target repo from the git remote (https://github.com/OWNER/REPO.git -> OWNER/REPO).
    # No repo is hardcoded - an explicit -Repo overrides the detected one.
    $detectedRepo = ""
    $remoteUrl = git remote get-url origin 2>&1 | Select-Object -First 1
    if ($remoteUrl -match 'github\.com[/:]([^/]+/[^/]+?)(\.git)?$') {
        $detectedRepo = $matches[1]
    }

    if ([string]::IsNullOrWhiteSpace($Repo)) {
        $Repo = $detectedRepo
    }

    if ([string]::IsNullOrWhiteSpace($Repo)) {
        Write-Host "ERROR: Cannot determine the GitHub repo. Provide -Repo or make sure the git remote 'origin' is set." -ForegroundColor Red
        exit 1
    }

    if (-not [string]::IsNullOrWhiteSpace($detectedRepo) -and $detectedRepo -ne $Repo) {
        Write-Host "WARNING: -Repo ($Repo) differs from the git remote ($detectedRepo)." -ForegroundColor Yellow
    }

    # Always confirm before publishing (guards against releasing to the wrong repo/version).
    Write-Host ""
    Write-Host "Target GitHub repo: $Repo" -ForegroundColor Yellow
    $confirm = Read-Host "Create release v$Version on '$Repo'? (y/N)"
    if ($confirm -notmatch '^[yY]$') {
        Write-Host "Aborted by user." -ForegroundColor Yellow
        exit 0
    }

    # Warn if there are uncommitted changes (release points to the latest commit)
    $dirty = git status --porcelain 2>&1
    if ($dirty) {
        Write-Host "WARNING: There are uncommitted changes - the release will point to the latest commit." -ForegroundColor Yellow
    }

    # Assemble assets: the MSI + plugin DLLs staged in Installer/MSI/Plugin
    $pluginDir = Join-Path $MSIProjectDir "Plugin"
    $assets = New-Object System.Collections.Generic.List[string]
    $assets.Add($msiDest)
    foreach ($candidate in @(
        (Join-Path $pluginDir "MLAstro_Robotic_Polar_Alignment\MLAstro_Robotic_Polar_Alignment.dll"),
        (Join-Path $pluginDir "Three Point Polar Alignment\NINA.Plugins.PolarAlignment.dll")
    )) {
        if (Test-Path $candidate) {
            $assets.Add($candidate)
        } else {
            Write-Host "WARNING: Asset not found, skipping: $candidate" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host "Creating GitHub release: $tag  (repo: $Repo)" -ForegroundColor Yellow
    $notes = "Release v$Version`n`nView README.md to know how to install.`n`n`"NINA.Plugins.PolarAlignment.dll`" is TPPA mod version worked stable for MLAstroRPA."

    $createOut = & $ghExe release create $tag --repo $Repo --title $tag --notes $notes 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: gh release create failed:" -ForegroundColor Red
        $createOut | ForEach-Object { Write-Host "  $_" }
        Write-Host "Tip: if the tag already exists, use a new version or delete the old release/tag first." -ForegroundColor Yellow
        exit 1
    }
    $createOut | ForEach-Object { Write-Host "  $_" }

    Write-Host ""
    Write-Host "Uploading $($assets.Count) asset(s)..." -ForegroundColor Yellow
    foreach ($asset in $assets) {
        Write-Host "  Uploading: $(Split-Path $asset -Leaf)" -ForegroundColor Gray
        $uploadOut = & $ghExe release upload $tag $asset --repo $Repo --clobber 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ERROR: upload failed for $asset" -ForegroundColor Red
            $uploadOut | ForEach-Object { Write-Host "    $_" }
        }
    }

    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "GITHUB RELEASE COMPLETE: $tag" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "Release: https://github.com/$Repo/releases/tag/$tag"
    Write-Host ""
    Write-Host "SHA256:"
    foreach ($asset in $assets) {
        $hash = (Get-FileHash -Algorithm SHA256 -Path $asset).Hash.ToLowerInvariant()
        Write-Host "  $(Split-Path $asset -Leaf): $hash"
    }
}
