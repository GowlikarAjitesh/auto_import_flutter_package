import * as vscode from "vscode";
import { exec } from "child_process";
import * as path from "path";
import * as https from "https";
import * as fs from "fs";

let pubGetTimeout: NodeJS.Timeout | undefined;
let diagnosticCollection: vscode.DiagnosticCollection;

interface PackageInfo {
  name: string;
  description?: string;
  isInstalled: boolean;
  isImported: boolean;
}

function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | undefined;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function activate(context: vscode.ExtensionContext) {
  console.log("Flutter Auto Import extension is now active!");

  diagnosticCollection =
    vscode.languages.createDiagnosticCollection("flutterAutoImport");
  context.subscriptions.push(diagnosticCollection);

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      "dart",
      new PubspecSuggestionProvider(),
      {
        providedCodeActionKinds:
          PubspecSuggestionProvider.providedCodeActionKinds,
      }
    )
  );

  vscode.workspace.onDidSaveTextDocument((document) => {
    const isPubspec = document.fileName.endsWith("pubspec.yaml");
    const config = vscode.workspace.getConfiguration("flutterAutoImport");
    const isEnabled = config.get<boolean>("autoPubGetOnSave", true);

    if (isPubspec && isEnabled) {
      if (pubGetTimeout) {
        clearTimeout(pubGetTimeout);
      }
      pubGetTimeout = setTimeout(() => {
        runFlutterPubGet(false);
      }, 1000);
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "flutterAutoImport.addPubPackage",
      async (
        pkg: string,
        document?: vscode.TextDocument,
        range?: vscode.Range
      ) => {
        await runFlutterPubAdd(pkg, document, range);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "flutterAutoImport.showPackageSuggestions",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== "dart") {
          return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection).trim();

        if (!selectedText || !selectedText.match(/^[a-z0-9_]+$/i)) {
          return;
        }

        await checkAndShowPackageSuggestions(
          selectedText,
          editor.document,
          selection
        );
      }
    )
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

    const pubspecPath = path.join(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
      "pubspec.yaml"
    );
    if (!fs.existsSync(pubspecPath)) return;

    const content = fs.readFileSync(pubspecPath, "utf8");
    const isInstalled = content.includes(`${selectedText}:`);
    const isImported = document
      .getText()
      .includes(`package:${selectedText}/${selectedText}.dart`);

    if (isInstalled && isImported) {
      return [];
    }

    if (isInstalled) {
      const action = new vscode.CodeAction(
        `📦 Import '${selectedText}' (already installed)`,
        vscode.CodeActionKind.QuickFix
      );
      action.command = {
        title: "Import Package",
        command: "flutterAutoImport.addPubPackage",
        arguments: [selectedText, document, range],
      };
      return [action];
    }

    const config = vscode.workspace.getConfiguration("flutterAutoImport");
    if (!config.get<boolean>("enableSuggestions", true)) return;

    const packages = await fetchMatchingPackages(selectedText, document);
    const availablePackages = packages.filter(
      (pkg) => !(pkg.isInstalled && pkg.isImported)
    );

    if (!availablePackages.length) return;

    return availablePackages.map((pkg) => {
      const action = new vscode.CodeAction(
        pkg.isInstalled
          ? `📦 Import '${pkg.name}' (already installed)`
          : `✨ Add & import '${pkg.name}'`,
        vscode.CodeActionKind.QuickFix
      );
      action.command = {
        title: pkg.isInstalled ? "Import Package" : "Add & Import Package",
        command: "flutterAutoImport.addPubPackage",
        arguments: [pkg.name, document, range],
      };
      if (pkg.description) {
        action.title = pkg.description;
      }
      return action;
    });
  }
}

async function checkAndShowPackageSuggestions(
  query: string,
  document: vscode.TextDocument,
  range: vscode.Range
) {
  const loadingMessage = vscode.window.setStatusBarMessage(
    "🔍 Searching for packages..."
  );

  try {
    const packages = await fetchMatchingPackages(query, document);
    const availablePackages = packages.filter(
      (pkg) => !(pkg.isInstalled && pkg.isImported)
    );

    if (availablePackages.length === 0) {
      vscode.window.showInformationMessage(
        `All matching packages are already installed and imported`
      );
      return;
    }

    const quickPick = vscode.window.createQuickPick();
    interface CustomQuickPickItem extends vscode.QuickPickItem {
      pkg: string;
      isInstalled: boolean;
    }

    quickPick.items = availablePackages.map<CustomQuickPickItem>((pkg) => ({
      label: pkg.isInstalled ? `✓ ${pkg.name}` : pkg.name,
      description: pkg.description
        ? truncateDescription(pkg.description, 60)
        : "No description available",
      detail: pkg.isImported
        ? "📦 Already imported in this file"
        : pkg.isInstalled
        ? "📦 Already installed - will only add import"
        : `📦 ${pkg.description || "Popular Flutter package"}`,
      alwaysShow: true,
      pkg: pkg.name,
      isInstalled: pkg.isInstalled,
    }));

    quickPick.placeholder = "Type to filter packages";
    quickPick.placeholder = "Type to filter packages";

    quickPick.onDidChangeSelection(async (selection) => {
      if (selection[0]) {
        const pkg = (selection[0] as CustomQuickPickItem).pkg;
        const isInstalled = (selection[0] as CustomQuickPickItem).isInstalled;
        quickPick.dispose();

        if (isInstalled) {
          await addImportStatement(pkg, document, range);
        } else {
          await runFlutterPubAdd(pkg, document, range);
        }
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

async function addImportStatement(
  pkg: string,
  document: vscode.TextDocument,
  range: vscode.Range
) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const importStatement = `import 'package:${pkg}/${pkg}.dart';\n`;
  const fileContent = document.getText();

  if (!fileContent.includes(importStatement)) {
    await editor.edit((editBuilder) => {
      editBuilder.delete(range);
      const firstLine = document.lineAt(0);
      editBuilder.insert(firstLine.range.start, importStatement);
    });
    vscode.window.showInformationMessage(`✅ Imported package '${pkg}'`);
  } else {
    await editor.edit((editBuilder) => {
      editBuilder.delete(range);
    });
    vscode.window.showInformationMessage(
      `ℹ️ Package '${pkg}' is already imported`
    );
  }
}

async function runFlutterPubAdd(
  pkg: string,
  document?: vscode.TextDocument,
  range?: vscode.Range
) {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    vscode.window.showErrorMessage("Workspace folder not found");
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Adding package ${pkg}...`,
      cancellable: false,
    },
    async (progress) => {
      try {
        await new Promise<void>((resolve, reject) => {
          exec(`flutter pub add ${pkg}`, { cwd }, (err, stdout, stderr) => {
            if (err) {
              reject(new Error(stderr));
              return;
            }
            resolve();
          });
        });

        await new Promise<void>((resolve, reject) => {
          exec(`flutter pub get`, { cwd }, (err, stdout, stderr) => {
            if (err) {
              reject(new Error(stderr));
              return;
            }
            resolve();
          });
        });

        if (document && range) {
          await addImportStatement(pkg, document, range);
        }

        vscode.window.showInformationMessage(
          `✅ Package '${pkg}' added and imported`
        );
      } catch (error) {
        vscode.window.showErrorMessage(`❌ Failed to add package: ${error}`);
      }
    }
  );
}

function runFlutterPubGet(showTerminal: boolean = true) {
  const terminalName = "Flutter Pub Get";
  let existingTerminal = vscode.window.terminals.find(
    (t) => t.name === terminalName
  );

  if (!existingTerminal) {
    existingTerminal = vscode.window.createTerminal(terminalName);
  }

  if (showTerminal) {
    existingTerminal.show();
  }
  existingTerminal.sendText("flutter pub get");
}

function fetchMatchingPackages(
  query: string,
  document: vscode.TextDocument
): Promise<PackageInfo[]> {
  return new Promise((resolve, reject) => {
    https
      .get(
        `https://pub.dev/api/search?q=${encodeURIComponent(query)}`,
        (res) => {
          if (res.statusCode !== 200) {
            reject(
              new Error(`Request failed with status code ${res.statusCode}`)
            );
            return;
          }

          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const results = JSON.parse(data);
              const pubspecPath = path.join(
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
                "pubspec.yaml"
              );
              const pubspecContent = fs.existsSync(pubspecPath)
                ? fs.readFileSync(pubspecPath, "utf8")
                : "";
              const fileContent = document.getText();

              const packages =
                results.packages?.slice(0, 10).map((pkg: any) => ({
                  name: pkg.package,
                  description: pkg.description,
                  isInstalled: pubspecContent.includes(`${pkg.package}:`),
                  isImported: fileContent.includes(
                    `package:${pkg.package}/${pkg.package}.dart`
                  ),
                })) || [];

              resolve(packages);
            } catch (e) {
              reject(e);
            }
          });
        }
      )
      .on("error", (err) => {
        reject(err);
      });
  });
}

function truncateDescription(description: string, maxLength: number): string {
  return description.length <= maxLength
    ? description
    : `${description.substring(0, maxLength)}...`;
}

export function deactivate() {
  if (pubGetTimeout) clearTimeout(pubGetTimeout);
  if (diagnosticCollection) diagnosticCollection.dispose();
}
