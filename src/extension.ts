import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';

let pubGetTimeout: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Flutter Auto Import extension is now active!');
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider('dart', new PubspecSuggestionProvider(), {
      providedCodeActionKinds: PubspecSuggestionProvider.providedCodeActionKinds
    })
  );

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
      }, 1000); // debounce by 1 second
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('flutterAutoImport.addPubPackage', async (pkg: string) => {
      await runFlutterPubAdd(pkg);
    })
  );
}

class PubspecSuggestionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix
  ];

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] | undefined {
    const word = document.getText(range);
    const pubspec = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'pubspec.yaml');
    const fs = require('fs');

    if (!word.match(/^[a-z_]+$/)){ 
      return undefined;
    }

    if (fs.existsSync(pubspec)) {
      const content = fs.readFileSync(pubspec, 'utf8');
      if (!content.includes(word + ":")) {
        const action = new vscode.CodeAction(`Add '${word}' to pubspec.yaml`, vscode.CodeActionKind.QuickFix);
        action.command = {
          title: 'Add Pub Package',
          command: 'flutterAutoImport.addPubPackage',
          arguments: [word]
        };
        return [action];
      }
    }

    return undefined;
  }
}

function runFlutterPubAdd(pkg: string) {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    vscode.window.showErrorMessage('Workspace folder not found. Cannot add package.');
    return;
  }

  exec(`flutter pub add ${pkg}`, { cwd }, (err, stdout, stderr) => {
    if (err) {
      vscode.window.showErrorMessage(`Failed to add ${pkg}: ${stderr}`);
    } else {
      vscode.window.showInformationMessage(`✅ Package '${pkg}' added to pubspec.yaml`);
    }
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

export function deactivate() {
  if (pubGetTimeout) {
    clearTimeout(pubGetTimeout);
  }
}