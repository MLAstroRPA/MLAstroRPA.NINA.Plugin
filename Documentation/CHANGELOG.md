# Changelog

All notable changes to the **MLAstro Robotic Polar Alignment** plugin for N.I.N.A.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0.4] - 2026-08-27

### Added
- **Reset Error button** in the control panel header, with automatic visibility logic.
- **COM port display names** in the connection dropdown (e.g. `COM4 - USB-SERIAL CH340`) to make selecting the right port easier.
- **Improved COM port friendly-name mapping and scoring** from the Windows device tree, preferring real USB-serial adapters over virtual/Bluetooth ports.
- **USB device-change monitoring**: the plugin now detects when the connected COM port disappears and disconnects automatically.

### Fixed
- **Connection stability**: auto-disconnect when the connected COM port is no longer present, preventing a stale "connected" state.
- **Port-open timeout** now releases the opening flag immediately so the user can retry a different port without waiting.

### Changed
- **Code quality**: updated nullable reference types and improved code safety across multiple files; the project now builds with **0 warnings**.

### Build / Release
- **Reworked the MSI build pipeline**: the plugin is built once in Release, and both plugin DLLs are staged from `Installer\MSI\Plugin\`, keeping the MSI and GitHub release assets always in sync.
- Added a **"GIT: Release Repo"** task to build the plugin, package the MSI, and publish the GitHub release in one step.
- All build paths (status-bar build button, `dotnet: build`, MSI build, release) now produce a clean **0-warning** build.
