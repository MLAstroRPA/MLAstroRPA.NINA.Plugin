'use strict';

const vscode = require('vscode');

const IDLE_TEXT = '$(play) .NET build';
const BUILDING_TEXT = '$(sync~spin) BUILDING...';

/** @type {vscode.StatusBarItem | undefined} */
let statusBarItem = undefined;

/**
 * Returns the display name of the workspace folder a task belongs to ('' if global/workspace scope).
 * @param {vscode.Task} task
 * @returns {string}
 */
function taskFolderName(task) {
    if (task.scope && task.scope !== vscode.TaskScope.Global && task.scope !== vscode.TaskScope.Workspace) {
        return /** @type {vscode.WorkspaceFolder} */ (task.scope).name;
    }
    return '';
}

/**
 * Runs a task and waits for its execution to finish.
 * @param {vscode.Task} task
 * @returns {Promise<void>}
 */
async function runTask(task) {
    if (!statusBarItem) {
        return;
    }

    statusBarItem.text = BUILDING_TEXT;
    statusBarItem.tooltip = 'Build is running...';

    const execution = await vscode.tasks.executeTask(task);

    await new Promise((resolve) => {
        const d = vscode.tasks.onDidEndTask((e) => {
            if (e.execution === execution) {
                d.dispose();
                resolve();
            }
        });
    });

    statusBarItem.text = IDLE_TEXT;
    statusBarItem.tooltip = 'Click to run the configured .NET build task';
}

/**
 * Resolves which task to run based on configuration, falling back to a QuickPick
 * so the button works for any project, not just MLAstro_Robotic_Polar_Alignment.
 * @returns {Promise<vscode.Task | undefined>}
 */
async function resolveTask() {
    const config = vscode.workspace.getConfiguration('mlastroBuildButton');
    const configuredTask = config.get('task', 'dotnet: build');
    const configuredFolder = config.get('workspaceFolder', '');

    let tasks = [];
    try {
        tasks = await vscode.tasks.fetchTasks();
    } catch (err) {
        console.error('[mlastro-build-button] fetchTasks failed:', err);
        return undefined;
    }

    // Restrict to the configured workspace folder if one is set.
    let candidates = tasks;
    if (configuredFolder) {
        candidates = tasks.filter((t) => taskFolderName(t) === configuredFolder);
    }

    // 1) Use the configured task name if it uniquely matches.
    if (configuredTask) {
        const byName = candidates.filter((t) => t.name === configuredTask);
        if (byName.length === 1) {
            return byName[0];
        }
    }

    // 2) Single candidate -> run it directly.
    if (candidates.length === 1) {
        return candidates[0];
    }

    // 3) Multiple / none -> let the user pick.
    if (candidates.length === 0) {
        vscode.window.showWarningMessage('No build tasks found. Add a tasks.json to the workspace.');
        return undefined;
    }

    const picks = candidates.map((t) => ({
        label: t.name,
        description: taskFolderName(t),
        task: t
    }));
    const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Select a task to run'
    });
    return selected ? selected.task : undefined;
}

async function runBuild() {
    const task = await resolveTask();
    if (task) {
        await runTask(task);
    }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    statusBarItem = vscode.window.createStatusBarItem(
        'mlastro.buildButton',
        vscode.StatusBarAlignment.Left,
        100
    );
    statusBarItem.text = IDLE_TEXT;
    statusBarItem.tooltip = 'Click to run the configured .NET build task';
    statusBarItem.command = 'mlastro.buildButton.runBuild';
    statusBarItem.show();

    context.subscriptions.push(
        statusBarItem,
        vscode.commands.registerCommand('mlastro.buildButton.runBuild', runBuild),
        vscode.commands.registerCommand('mlastro.buildButton.reload', () =>
            vscode.commands.executeCommand('workbench.action.reloadWindow')
        )
    );

    // Reload-after-update mechanism: when the installed version differs from the
    // version that was running before, prompt the user to reload the window so the
    // new code (e.g. new icon) actually takes effect.
    const version = context.extension.packageJSON.version;
    const prevVersion = context.globalState.get('mlastroBuildButton.version');
    if (prevVersion && prevVersion !== version) {
        vscode.window.showInformationMessage(
            `MLAstro Build Button updated (${prevVersion} → ${version}). Reload now to apply the new version.`,
            'Reload'
        ).then((choice) => {
            if (choice === 'Reload') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
    }
    context.globalState.update('mlastroBuildButton.version', version);
}

function deactivate() {
    statusBarItem = undefined;
}

module.exports = { activate, deactivate };

