import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import * as https from 'https';
import * as fs from 'fs';

let pubGetTimeout: NodeJS.Timeout | undefined;
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  console.log('Flutter Auto Import extension is now active!');

  diagnosticCollection = vscode.languages.createDiagnosticCollection('flutterAutoImport');
  context.subscriptions.push(diagnosticCollection);

  // Code Action Provider
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

  // Run diagnostics on active editor
  vscode.workspace.onDidChangeTextDocument((event) => {
    runDiagnostics(event.document);
  });

  if (vscode.window.activeTextEditor) {
    runDiagnostics(vscode.window.activeTextEditor.document);
  }
}

class PubspecSuggestionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  async provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.CodeAction[] | undefined> {
    const word = document.getText(range);
    if (!word.match(/^[a-z_]+$/)) {return;}

    const pubspecPath = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath)) {return;}

    const content = fs.readFileSync(pubspecPath, 'utf8');
    if (content.includes(`${word}:`)) {return;}

    const config = vscode.workspace.getConfiguration('flutterAutoImport');
    if (!config.get<boolean>('enableSuggestions', true)) {return;}

    const exists = await checkPackageExists(word);
    if (!exists) {return;}

    const action = new vscode.CodeAction(`✨ Add '${word}' to pubspec.yaml`, vscode.CodeActionKind.QuickFix);
    action.command = {
      title: 'Add Pub Package',
      command: 'flutterAutoImport.addPubPackage',
      arguments: [word]
    };
    return [action];
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
      vscode.window.showErrorMessage(`❌ Failed to add ${pkg}: ${stderr}`);
    } else {
      vscode.window.showInformationMessage(`✅ Package '${pkg}' added to pubspec.yaml`);

      exec(`flutter pub get`, { cwd }, (err2, stdout2, stderr2) => {
        if (err2) {
          vscode.window.showErrorMessage(`❌ Failed to run pub get: ${stderr2}`);
        } else {
          vscode.window.showInformationMessage(`📦 flutter pub get completed`);
        }
      });
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

function checkPackageExists(pkg: string): Promise<boolean> {
  return new Promise((resolve) => {
    https.get(`https://pub.dev/api/packages/${pkg}`, (res) => {
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
}

function runDiagnostics(document: vscode.TextDocument) {
  if (document.languageId !== 'dart') {return;}

  const diagnostics: vscode.Diagnostic[] = [];
  const pubspecPath = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'pubspec.yaml');
  const content = fs.existsSync(pubspecPath) ? fs.readFileSync(pubspecPath, 'utf8') : "";

  const regex = /\b([a-z_]{2,})\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(document.getText())) !== null) {
    const pkg = match[1];

    if (content.includes(`${pkg}:`)) {continue;}

    checkPackageExists(pkg).then((exists) => {
      if (!exists) {return;}
      const range = new vscode.Range(
        document.positionAt(match!.index),
        document.positionAt(match!.index + pkg.length)
      );

      const diagnostic = new vscode.Diagnostic(
        range,
        `Possible missing package: '${pkg}'`,
        vscode.DiagnosticSeverity.Information
      );
      diagnostic.code = 'flutterAutoImport';
      diagnostics.push(diagnostic);
      diagnosticCollection.set(document.uri, diagnostics);
    });
  }
}

export function deactivate() {
  if (pubGetTimeout) {clearTimeout(pubGetTimeout);}
  if (diagnosticCollection) {diagnosticCollection.dispose();}
}
