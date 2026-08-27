# .NET build project

Adds a **BUILD** button (▶) to the VS Code status bar. Click it to run the configured
build task, with a task picker when several projects/tasks are open.

## Introduction

This tiny VS Code extension puts a **`.NET build`** button right on the status bar,
so you can compile your .NET project with a single click — no need to open the
Command Palette or type `dotnet build` by hand.

It is **project-agnostic**: it simply runs the `dotnet: build` task defined in the
workspace's `.vscode/tasks.json`. If you have several folders or tasks open, a
QuickPick lets you choose the exact task and workspace folder, so it works for any
.NET solution — not just a single project.

## Features
- Status bar button on the left: `▶ .NET build`
- Runs the configured build task; shows `BUILDING...` while it runs
- If the configured task is not found or is ambiguous across open folders, a
  **QuickPick** lets you choose the task and workspace folder
- Configurable via settings

## Usage
1. Reload the window after installing (`Developer: Reload Window`).
2. Click **▶ .NET build** on the status bar.

## Settings
| Setting | Default | Description |
| --- | --- | --- |
| `mlastroBuildButton.task` | `dotnet: build` | Default task label to run when clicking the button. |
| `mlastroBuildButton.workspaceFolder` | *(empty)* | Restrict the task search to one workspace folder. Empty = search all open folders. |

## Install (VSIX)
The packaged file lives in this repo at:
`.vscode/extensions/dist/mlastro-build-button-0.0.4.vsix`

Install it with:
`code --install-extension .vscode/extensions/dist/mlastro-build-button-0.0.4.vsix`
or use **Extensions view → ⋯ → Install from VSIX** and select that file.

> After installing/updating the extension, **reload the window** so the new version
> takes effect. Newer versions show a **Reload** button automatically when they
> detect that an update was installed.

To rebuild the package after editing the source:
```powershell
cd .vscode/extensions/mlastro-build-button
npx --yes @vscode/vsce package --allow-missing-repository
move .\mlastro-build-button-*.vsix ..\dist\
```

