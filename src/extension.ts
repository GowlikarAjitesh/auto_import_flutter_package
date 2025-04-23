import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import * as https from 'https';
import * as fs from 'fs';

let pubGetTimeout: NodeJS.Timeout | undefined;
let diagnosticCollection: vscode.DiagnosticCollection;

// Debounce utility
function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | undefined;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Flutter Auto Import extension is now active!');

  diagnosticCollection = vscode.languages.createDiagnosticCollection('flutterAutoImport');
  context.subscriptions.push(diagnosticCollection);

  // Register Code Action Provider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider('dart', new PubspecSuggestionProvider(), {
      providedCodeActionKinds: PubspecSuggestionProvider.providedCodeActionKinds
    })
  );

  // Pubspec.yaml save trigger
  vscode.workspace.onDidSaveTextDocument((document) => {
    const isPubspec = document.fileName.endsWith('pubspec.yaml');
    const config = vscode.workspace.getConfiguration('flutterAutoImport');
    const isEnabled = config.get<boolean>('autoPubGetOnSave', true);

    if (isPubspec && isEnabled) {
      if (pubGetTimeout) {
        clearTimeout(pubGetTimeout);
      }
      pubGetTimeout = setTimeout(() => {
        runFlutterPubGet();
      }, 1000); // debounce by 1s
    }
  });

  // Register Add Command
  context.subscriptions.push(
    vscode.commands.registerCommand('flutterAutoImport.addPubPackage', async (pkg: string) => {
      await runFlutterPubAdd(pkg);
    })
  );

  // Register Suggestion Command (Ctrl+Shift+A)
  context.subscriptions.push(
    vscode.commands.registerCommand('flutterAutoImport.showPackageSuggestions', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'dart') {
        vscode.window.showInformationMessage('No active Dart editor found.');
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection).trim();

      if (!selectedText) {
        vscode.window.showInformationMessage('Please select a word to check for packages.');
        return;
      }

      if (!selectedText.match(/^[a-z0-9_]+$/i)) {
        vscode.window.showInformationMessage('Please select a valid package name (letters, numbers or underscores).');
        return;
      }

      await checkAndShowPackageSuggestions(selectedText);
    })
  );
}

class PubspecSuggestionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection
  ): Promise<vscode.CodeAction[] | undefined> {
    const selectedText = document.getText(range).trim();
    if (!selectedText.match(/^[a-z0-9_]+$/i)) return;

    const pubspecPath = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath)) return;

    const content = fs.readFileSync(pubspecPath, 'utf8');
    if (content.includes(`${selectedText}:`)) return;

    const config = vscode.workspace.getConfiguration('flutterAutoImport');
    if (!config.get<boolean>('enableSuggestions', true)) return;

    const packages = await fetchMatchingPackages(selectedText);
    if (!packages.length) return;

    return packages.map(pkg => {
      const action = new vscode.CodeAction(`✨ Add '${pkg}' to pubspec.yaml`, vscode.CodeActionKind.QuickFix);
      action.command = {
        title: 'Add Pub Package',
        command: 'flutterAutoImport.addPubPackage',
        arguments: [pkg]
      };
      return action;
    });
  }
}

async function checkAndShowPackageSuggestions(query: string) {
  const loadingMessage = vscode.window.setStatusBarMessage('🔍 Searching for packages...');
  
  try {
    const packages = await fetchMatchingPackages(query);
    
    if (packages.length === 0) {
      vscode.window.showInformationMessage(`No packages found matching '${query}'`);
      return;
    }

    const quickPick = vscode.window.createQuickPick();
    quickPick.items = packages.map(pkg => ({ label: pkg }));
    quickPick.title = `Select a package to add to pubspec.yaml`;
    quickPick.placeholder = 'Type to filter packages';

    quickPick.onDidChangeSelection(async selection => {
      if (selection[0]) {
        const pkg = selection[0].label;
        quickPick.dispose();
        await runFlutterPubAdd(pkg);
      }
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to search for packages: ${error}`);
  } finally {
    loadingMessage.dispose();
  }
}

function runFlutterPubAdd(pkg: string) {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    vscode.window.showErrorMessage('Workspace folder not found. Cannot add package.');
    return;
  }

  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Adding package ${pkg}...`,
    cancellable: false
  }, async (progress) => {
    return new Promise<void>((resolve) => {
      exec(`flutter pub add ${pkg}`, { cwd }, (err, stdout, stderr) => {
        if (err) {
          vscode.window.showErrorMessage(`❌ Failed to add ${pkg}: ${stderr}`);
          resolve();
          return;
        }

        progress.report({ message: "Running flutter pub get..." });
        exec(`flutter pub get`, { cwd }, (err2, stdout2, stderr2) => {
          if (err2) {
            vscode.window.showErrorMessage(`❌ Failed to run pub get: ${stderr2}`);
          } else {
            vscode.window.showInformationMessage(`✅ Package '${pkg}' added and dependencies updated`);
          }
          resolve();
        });
      });
    });
  });
}

function runFlutterPubGet() {
  const terminalName = "Flutter Pub Get";
  let existingTerminal = vscode.window.terminals.find(t => t.name === terminalName);

  if (!existingTerminal) {
    existingTerminal = vscode.window.createTerminal(terminalName);
  }

  existingTerminal.show();
  existingTerminal.sendText("flutter pub get");
}

function fetchMatchingPackages(query: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    https.get(`https://pub.dev/api/search?q=${encodeURIComponent(query)}`, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Request failed with status code ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          const packages = results.packages?.slice(0, 10).map((pkg: any) => pkg.package) || [];
          resolve(packages);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

export function deactivate() {
  if (pubGetTimeout) clearTimeout(pubGetTimeout);
  if (diagnosticCollection) diagnosticCollection.dispose();
}