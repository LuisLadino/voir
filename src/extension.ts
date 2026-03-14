import * as vscode from 'vscode';

/**
 * Activates the VOIR extension.
 * Called when VS Code activates the extension based on activation events.
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('VOIR: Extension activating...');

  // Register commands
  const showDashboardCmd = vscode.commands.registerCommand('voir.showDashboard', () => {
    vscode.window.showInformationMessage('VOIR Dashboard - Coming soon!');
  });

  const refreshCmd = vscode.commands.registerCommand('voir.refresh', () => {
    vscode.window.showInformationMessage('VOIR: Refreshing data...');
  });

  context.subscriptions.push(showDashboardCmd, refreshCmd);

  console.log('VOIR: Extension activated');
}

/**
 * Deactivates the VOIR extension.
 * Called when VS Code deactivates the extension.
 */
export function deactivate(): void {
  console.log('VOIR: Extension deactivated');
}
