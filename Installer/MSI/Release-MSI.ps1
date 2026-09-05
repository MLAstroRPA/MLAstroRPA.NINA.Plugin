# MLAstro Robotic Polar Alignment - MSI Build Script
# Creates MSI installer using WiX Toolset v5

param(
    [string]$Configuration = "Release",
    [string]$Version = "",
    [switch]$CreateRelease,
    [switch]$ReleaseOnly,
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

# ========== RELEASE-ONLY MODE (no MSI build) ==========
# The "GIT: Release Repo" task runs with -CreateRelease -ReleaseOnly. It does NOT build the MSI:
# it asks for confirmation that the new-version MSI was already built (e.g. via ".NET Build MSI")
# and then creates the GitHub release from the NEWEST MSI currently present in Output.
if ($ReleaseOnly) {
    if (-not $CreateRelease) {
        Write-Host "ERROR: -ReleaseOnly can only be used together with -CreateRelease." -ForegroundColor Red
        exit 1
    }

    $existingMsi = Get-ChildItem -Path $OutputDir -Filter "MLAstro_RPA_Plugin_*.msi" -ErrorAction SilentlyContinue |
                   Sort-Object Name -Descending | Select-Object -First 1
    if (-not $existingMsi -or $existingMsi.Name -notmatch 'MLAstro_RPA_Plugin_(\d+\.\d+\.\d+(\.\d+)?)\.msi') {
        Write-Host "ERROR: No MSI found in Output ($OutputDir). Build the new version first with '.NET Build MSI'." -ForegroundColor Red
        exit 1
    }

    $Version = $matches[1]
    $msiDest = $existingMsi.FullName
    Write-Host "Release-only mode - MSI build is SKIPPED." -ForegroundColor Yellow
    Write-Host "Newest MSI in Output: v$Version ($(Split-Path $msiDest -Leaf))" -ForegroundColor Green
    Write-Host ""
}

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

# ========== BUILD / SYNC PHASES (SKIPPED when -ReleaseOnly) ==========
# Package.wxs sync, plugin csproj sync, TPPA fork sync, WiX check and MSI build/copy only run
# in build mode. In release-only mode the MSI is taken from Output as-is.
if (-not $ReleaseOnly) {

# Sync the ProductVersion define in Package.wxs with the chosen version
$wxsContent = [System.IO.File]::ReadAllText($PackageWxs)
if ($wxsContent -match '<\?define ProductVersion = "[^"]*" \?>') {
    $wxsContent = $wxsContent -replace '<\?define ProductVersion = "[^"]*" \?>', "<?define ProductVersion = `"$Version`" ?>"
    [System.IO.File]::WriteAllText($PackageWxs, $wxsContent, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "Package.wxs ProductVersion updated to $Version" -ForegroundColor Green
} else {
    Write-Host "WARNING: Could not find ProductVersion define in Package.wxs" -ForegroundColor Yellow
}

# ========== PLUGIN PROJECT VERSION SYNC ==========
# Cung cap version moi vao chinh project plugin MLAstro ma MSI nay dong goi
# (<AssemblyVersion> / <FileVersion> trong MLAstro_Robotic_Polar_Alignment.csproj) de DLL
# duoc build ra mang dung version khop voi MSI (Package.wxs + ten file Output).
$pluginCsproj = Join-Path $ProjectRoot "MLAstro_Robotic_Polar_Alignment.csproj"
if (Test-Path $pluginCsproj) {
    # AssemblyVersion/FileVersion can du 4 phan; version 3 phan (vd 2.0.1) -> them ".0"
    $fourPart = if ($Version -match '^\d+\.\d+\.\d+\.\d+$') { $Version } else { "$Version.0" }

    $csprojContent = [System.IO.File]::ReadAllText($pluginCsproj)
    $updatedContent = [regex]::Replace(
        $csprojContent,
        '<(?<tag>AssemblyVersion|FileVersion)>[^<]*</\k<tag>>',
        { param($m) "<$($m.Groups['tag'].Value)>$fourPart</$($m.Groups['tag'].Value)>" })
    if ($updatedContent -ne $csprojContent) {
        [System.IO.File]::WriteAllText($pluginCsproj, $updatedContent, (New-Object System.Text.UTF8Encoding $false))
        Write-Host "Plugin csproj version updated to ${fourPart}: $pluginCsproj" -ForegroundColor Green
    } else {
        Write-Host "WARNING: Khong tim thay <AssemblyVersion>/<FileVersion> trong plugin csproj" -ForegroundColor Yellow
    }
} else {
    Write-Host "WARNING: Plugin project not found at $pluginCsproj - skipping plugin version sync." -ForegroundColor Yellow
}

# ========== TPPA FORK VERSION SYNC ==========
# Mỗi lần build MSI phiên bản mới, đẩy version đó sang fork TPPA: cập nhật marker
# "MLAstroRPA version: X.Y.Z" (trong NINA.Plugins.PolarAlignment.csproj <Description> v.v.),
# build lại TPPA (Debug + Release) và stage DLL mới vào Installer\MSI\Plugin\Three Point Polar Alignment
# để MSI gói đúng bản TPPA mang version khớp với plugin MLAstro.
#
# LƯU Ý: repo TPPA ("Three Point Polar Alignment - PULL-REQUEST") là một repo RIÊNG nằm chung dưới
# thư mục gốc "Code", KHÔNG nằm bên trong thư mục plugin - nên copy toàn bộ plugin qua nơi khác
# (vd Public\) không mang repo TPPA theo. Nếu không truyền -TPPAProjectDir, script tự tìm repo TPPA
# bằng cách đi lên dần từ thư mục plugin, nên hoạt động ở cả
# ...\Code\MLAstroRPA.NINA.Plugin lẫn ...\Code\Public\Public.MLAstroRPA.NINA.Plugin.
$tppaProject = $null
if (-not [string]::IsNullOrWhiteSpace($TPPAProjectDir)) {
    $tppaProject = Join-Path ([System.IO.Path]::GetFullPath($TPPAProjectDir)) "NINA.Plugins.PolarAlignment.csproj"
}
if (-not $tppaProject -or -not (Test-Path $tppaProject)) {
    $searchDir = $ProjectRoot
    for ($i = 0; $i -lt 10; $i++) {
        $probe = Join-Path $searchDir "Three Point Polar Alignment - PULL-REQUEST\PolarAlignment\NINA.Plugins.PolarAlignment.csproj"
        if (Test-Path $probe) {
            $TPPAProjectDir = Split-Path $probe -Parent
            $tppaProject = $probe
            Write-Host "Located TPPA fork project at: $tppaProject" -ForegroundColor Green
            break
        }
        $parent = Split-Path $searchDir -Parent
        if ($parent -eq $searchDir) { break }
        $searchDir = $parent
    }
}
if ($tppaProject -and (Test-Path $tppaProject)) {
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

    # 2) Build Debug TPPA fork TRƯỚC (sau khi vừa sửa marker version): TPPA csproj có post-build
    #    copy DLL vào thư mục NINA plugins + staging MSI của plugin MLAstro nên bản TPPA đang dùng
    #    (Debug) sẽ khớp version marker vừa cập nhật.
    Write-Host "Building TPPA fork (Debug)..." -ForegroundColor Yellow
    Push-Location $TPPAProjectDir
    try {
        dotnet build $tppaProject -c Debug -tl:off
        if ($LASTEXITCODE -ne 0) {
            throw "TPPA fork Debug build failed."
        }
    } finally {
        Pop-Location
    }

    # 3) SAU KHI TPPA Debug build xong mới build Debug plugin MLAstro (post-build sẽ copy plugin
    #    vào thư mục NINA plugins để chạy/test cùng bản TPPA mới).
    Write-Host "Building MLAstro plugin (Debug)..." -ForegroundColor Yellow
    if (Test-Path $pluginCsproj) {
        Push-Location $ProjectRoot
        try {
            dotnet build $pluginCsproj -c Debug -tl:off
            if ($LASTEXITCODE -ne 0) {
                throw "MLAstro plugin Debug build failed."
            }
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "WARNING: Plugin project not found at $pluginCsproj - skipping MLAstro Debug build." -ForegroundColor Yellow
    }

    # 4) Build lại TPPA (Release) để version mới nằm trong metadata của DLL đóng gói MSI
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

    # 5) Stage DLL TPPA (Release) vừa build vào thư mục MSI harvest
    $tppaDll = Join-Path $TPPAProjectDir "bin\Release\net8.0-windows7.0\NINA.Plugins.PolarAlignment.dll"
    $tppaStaging = Join-Path $MSIProjectDir "Plugin\Three Point Polar Alignment"
    if ((Test-Path $tppaDll) -and (Test-Path $tppaStaging)) {
        Copy-Item -Path $tppaDll -Destination (Join-Path $tppaStaging "NINA.Plugins.PolarAlignment.dll") -Force
        Write-Host "  Staged TPPA DLL into: $tppaStaging" -ForegroundColor Green
    } else {
        Write-Host "WARNING: TPPA DLL or staging folder not found - MSI may package a stale TPPA DLL." -ForegroundColor Yellow
    }
} else {
    Write-Host "WARNING: TPPA fork project not found. Skipping TPPA version sync - the MSI may package a stale TPPA DLL. Pass -TPPAProjectDir to point to the TPPA PolarAlignment folder." -ForegroundColor Yellow
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

}  # ========== end of BUILD / SYNC PHASES (skipped when -ReleaseOnly) ==========

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
    # In release-only mode the confirm states that the shown version is the newest in Output.
    Write-Host ""
    Write-Host "Target GitHub repo: $Repo" -ForegroundColor Magenta
    if ($ReleaseOnly) {
        Write-Host "Version $Version is the newest MSI. Do you want to release it to GitHub ('$Repo')? (y/N)" -ForegroundColor Yellow -NoNewline
        $confirm = Read-Host
    } else {
        Write-Host "Create release v$Version on '$Repo'? (y/N)" -ForegroundColor Yellow -NoNewline
        $confirm = Read-Host
    }
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
