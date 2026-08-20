# MLAstro Robotic Polar Alignment - Installer

This folder contains scripts and tools to create installers for the MLAstro Robotic Polar Alignment N.I.N.A. plugin.

## Quick Install (Development)

For quick installation during development, run:

```powershell
.\Install-Plugin.ps1
```

This will:
1. Check if N.I.N.A. is installed
2. Build the project if needed
3. Close N.I.N.A. if running (with your permission)
4. Install the plugin to the correct folder

To uninstall:
```powershell
.\Install-Plugin.ps1 -Uninstall
```

## Create Distribution Package

### Option 1: ZIP Package (Simple)

Create a ZIP file that users can manually extract:

```powershell
.\Create-ZipPackage.ps1
```

The ZIP will be created in `Output\MLAstro_RPA_Plugin_1.0.0.zip`

### Option 2: EXE Installer (Recommended for End Users)

Create a proper Windows installer that:
- Checks if N.I.N.A. is installed
- Automatically finds the correct installation path
- Closes N.I.N.A. if running
- Provides uninstallation support

**Requirements:**
- [Inno Setup 6](https://jrsoftware.org/isdl.php) must be installed

```powershell
.\Build-Installer.ps1
```

The installer will be created in `Output\MLAstro_RPA_Plugin_Setup_1.0.0.exe`

### Option 3: MSI Installer (Enterprise/Group Policy)

Create a Windows Installer MSI package:
- Standard Windows Installer format (.msi)
- Supports Group Policy deployment
- Works with enterprise software management tools (SCCM, Intune, etc.)
- Clean uninstall via Windows Settings > Apps

**Requirements:**
- WiX Toolset v5 (automatically installed by script)

```powershell
cd MSI
.\Build-MSI.ps1
```

The MSI will be created in `Output\MLAstro_RPA_Plugin_1.0.0.msi`

**Manual MSI build:**
```powershell
# Install WiX global tool
dotnet tool install --global wix

# Add required extensions
wix extension add -g WixToolset.UI.wixext
wix extension add -g WixToolset.Util.wixext

# Build MSI
cd Installer\MSI
dotnet build -c Release
```

## Comparison: EXE vs MSI

| Feature | EXE (Inno Setup) | MSI (WiX) |
|---------|------------------|-----------|
| File size | Smaller | Larger |
| User-friendly UI | ✅ Better | Basic |
| Group Policy | ❌ | ✅ |
| Silent install | ✅ `/SILENT` | ✅ `/quiet` |
| Enterprise deployment | Limited | ✅ Full support |
| Repair install | ❌ | ✅ |
| Custom actions | Easy | Complex |

**Recommendation:**
- For **end users**: Use EXE installer
- For **enterprise/IT deployment**: Use MSI installer

## Script Options

**Build-Installer.ps1:**
```powershell
# Build only (don't create installer)
.\Build-Installer.ps1 -BuildOnly

# Create installer only (don't rebuild)
.\Build-Installer.ps1 -InstallerOnly

# Specify configuration
.\Build-Installer.ps1 -Configuration Debug

# Specify Inno Setup path
.\Build-Installer.ps1 -InnoSetupPath "D:\Tools\InnoSetup\ISCC.exe"
```

**Build-MSI.ps1:**
```powershell
# Specify version
.\Build-MSI.ps1 -Version "1.2.0"

# Debug build
.\Build-MSI.ps1 -Configuration Debug
```

## Output Files

After running the scripts, you'll find:

| File | Description |
|------|-------------|
| `Output\MLAstro_RPA_Plugin_Setup_x.x.x.exe` | Windows EXE installer (requires Inno Setup) |
| `Output\MLAstro_RPA_Plugin_x.x.x.msi` | Windows MSI installer (requires WiX) |
| `Output\MLAstro_RPA_Plugin_x.x.x.zip` | ZIP package for manual installation |

## Manual Installation

Users can manually install the plugin by:

1. Close N.I.N.A. if running
2. Extract/copy plugin files to:
   ```
   %LOCALAPPDATA%\NINA\Plugins\3.0.0\MLAstro_Robotic_Polar_Alignment
   ```
3. Start N.I.N.A.

## File Structure

```
Installer/
├── Build-Installer.ps1    # Creates EXE installer (Inno Setup)
├── Create-ZipPackage.ps1  # Creates ZIP package
├── Install-Plugin.ps1     # Direct install for development
├── Setup.iss              # Inno Setup script
├── README.md              # This file
├── MSI/                   # MSI installer project
│   ├── Build-MSI.ps1      # MSI build script
│   ├── MLAstro.RPA.Installer.wixproj
│   ├── Package.wxs        # WiX package definition
│   └── License.rtf        # License for MSI
└── Output/                # Generated installers
```

## Version Updates

When releasing a new version:

1. Update version in `plugin.json`
2. Update version in `Installer\Setup.iss` (`MyAppVersion`)
3. Update version in `Installer\MSI\Package.wxs` (`ProductVersion`)
4. Run build scripts

## Requirements

- Windows 10/11
- .NET 8.0 SDK
- PowerShell 5.1 or later
- (Optional) Inno Setup 6 for EXE installer
- (Optional) WiX Toolset v5 for MSI installer (auto-installed)

## Silent Installation

**EXE Installer:**
```cmd
MLAstro_RPA_Plugin_Setup_1.0.0.exe /SILENT
MLAstro_RPA_Plugin_Setup_1.0.0.exe /VERYSILENT
```

**MSI Installer:**
```cmd
msiexec /i MLAstro_RPA_Plugin_1.0.0.msi /quiet
msiexec /i MLAstro_RPA_Plugin_1.0.0.msi /passive
```

## Uninstallation

**Via Windows Settings:**
1. Open Settings > Apps > Installed Apps
2. Search for "MLAstro"
3. Click Uninstall

**Silent Uninstall (MSI):**
```cmd
msiexec /x MLAstro_RPA_Plugin_1.0.0.msi /quiet
```
