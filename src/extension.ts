import * as vscode from "vscode";
import { exec } from "child_process";
import * as path from "path";
import * as https from "https";
import * as fs from "fs";
import * as yaml from "js-yaml";

let pubGetTimeout: NodeJS.Timeout | undefined;
let diagnosticCollection: vscode.DiagnosticCollection;

interface PackageInfo {
  name: string;
  description?: string;
  isInstalled: boolean;
  isImported: boolean;
  methods?: string[];
  version?: string;
  popularity?: number;
  latestVersion?: string;
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

  context.subscriptions.push(
    vscode.languages.registerHoverProvider("dart", new PackageHoverProvider())
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      "dart",
      new FunctionCompletionProvider(),
      "."
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
      "flutterAutoImport.removePubPackage",
      async (pkg: string) => {
        await runFlutterPubRemove(pkg);
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
          await showPackageSearch("");
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

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "flutterAutoImport.searchPackages",
      async () => {
        const editor = vscode.window.activeTextEditor;
        const selectedText = editor
          ? editor.document.getText(editor.selection).trim()
          : "";
        await showPackageSearch(selectedText);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "flutterAutoImport.searchPackagesKey",
      async () => {
        const editor = vscode.window.activeTextEditor;
        const selectedText = editor
          ? editor.document.getText(editor.selection).trim()
          : "";
        await showPackageSearch(selectedText);
      }
    )
  );
}

class PackageHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const range = document.getWordRangeAtPosition(position, /[a-z0-9_]+/i);
    if (!range || token.isCancellationRequested) return undefined;

    const word = document.getText(range);
    const packages = await fetchMatchingPackages(word, document);
    const pkg = packages.find((p) => p.name === word && p.isInstalled);

    if (!pkg) return undefined;

    const content = new vscode.MarkdownString();
    content.appendMarkdown(`**${pkg.name}**`);

    if (pkg.version || pkg.latestVersion) {
      content.appendMarkdown(
        `\n\n**Version:** ${pkg.version || "Not installed"} (latest: ${
          pkg.latestVersion || "unknown"
        })`
      );
    }

    if (pkg.popularity) {
      content.appendMarkdown(
        `\n\n**Popularity:** ${Math.round(pkg.popularity * 100)}%`
      );
    }

    if (pkg.description) {
      content.appendMarkdown(`\n\n${pkg.description}`);
    }

    if (pkg.methods && pkg.methods.length > 0) {
      content.appendMarkdown("\n\n**Available Methods/Widgets:**");
      pkg.methods.forEach((method) => {
        content.appendMarkdown(`\n- \`${method}\``);
      });
    }

    content.isTrusted = true;
    return new vscode.Hover(content, range);
  }
}

class FunctionCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[]> {
    const line = document.lineAt(position).text;
    const match = line.match(/(\w+)\.(\w*)$/);
    if (!match) return [];

    const [, packageName, partial] = match;
    const packages = await fetchMatchingPackages(packageName, document);
    const pkg = packages.find((p) => p.name === packageName && p.isInstalled);

    if (!pkg || !pkg.methods) return [];

    return pkg.methods
      .filter((method) => method.startsWith(partial))
      .map((method) => {
        const item = new vscode.CompletionItem(
          method,
          vscode.CompletionItemKind.Method
        );
        item.insertText = new vscode.SnippetString(
          `${method}(\${1:parameters})`
        );
        item.documentation = new vscode.MarkdownString(
          `Auto-generated template for ${packageName}.${method}`
        );
        return item;
      });
  }
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

    const actions: vscode.CodeAction[] = [];

    if (isInstalled) {
      const importAction = new vscode.CodeAction(
        `📦 Import '${selectedText}' (already installed)`,
        vscode.CodeActionKind.QuickFix
      );
      importAction.command = {
        title: "Import Package",
        command: "flutterAutoImport.addPubPackage",
        arguments: [selectedText, document, range],
      };
      actions.push(importAction);

      const removeAction = new vscode.CodeAction(
        `🗑️ Remove '${selectedText}' from pubspec.yaml`,
        vscode.CodeActionKind.QuickFix
      );
      removeAction.command = {
        title: "Remove Package",
        command: "flutterAutoImport.removePubPackage",
        arguments: [selectedText],
      };
      actions.push(removeAction);
    }

    if (isInstalled && isImported) {
      return actions;
    }

    const config = vscode.workspace.getConfiguration("flutterAutoImport");
    if (!config.get<boolean>("enableSuggestions", true)) return actions;

    const packages = await fetchMatchingPackages(selectedText, document);
    const availablePackages = packages.filter(
      (pkg) => !(pkg.isInstalled && pkg.isImported)
    );

    if (!availablePackages.length) return actions;

    return [
      ...actions,
      ...availablePackages.map((pkg) => {
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
          action.title += ` - ${truncateDescription(pkg.description, 50)}`;
        }
        return action;
      }),
    ];
  }
}

async function showPackageSearch(initialQuery: string) {
  const quickPick = vscode.window.createQuickPick();
  quickPick.placeholder =
    "Search Flutter packages (type to filter, select to add/import)";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.value = initialQuery;
  let showInstalledOnly = false;

  const filterButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("filter"),
    tooltip: "Show installed packages only",
  };
  quickPick.buttons = [filterButton];

  quickPick.show();

  interface CustomQuickPickItem extends vscode.QuickPickItem {
    pkg: PackageInfo;
    buttons?: vscode.QuickInputButton[];
  }

  const updateItems = debounce(async (query: string) => {
    quickPick.busy = true;
    try {
      const editor = vscode.window.activeTextEditor;
      const document = editor?.document;
      if (!document) {
        quickPick.items = [{ label: "No active editor", alwaysShow: true }];
        return;
      }

      let packages: PackageInfo[] = [];
      if (showInstalledOnly) {
        packages = await getInstalledPackages(document);
        if (query) {
          packages = packages.filter(
            (pkg) =>
              pkg.name.toLowerCase().includes(query.toLowerCase()) ||
              (pkg.description &&
                pkg.description.toLowerCase().includes(query.toLowerCase()))
          );
        }
        // showInstalledOnly = !showInstalledOnly;
      } else {
        packages = await fetchMatchingPackages(query, document);
      }

      if (packages.length === 0) {
        quickPick.items = [
          {
            label: showInstalledOnly
              ? "No installed packages match your search"
              : "No packages found",
            alwaysShow: true,
          },
        ];
        return;
      }

      quickPick.items = packages.map<CustomQuickPickItem>((pkg) => {
        const item: CustomQuickPickItem = {
          label: pkg.isInstalled ? `✓ ${pkg.name}` : pkg.name,
          description: pkg.description
            ? truncateDescription(pkg.description, 60)
            : "No description available",
          detail: [
            pkg.isImported ? "📦 Already imported in this file" : null,
            pkg.isInstalled ? "📦 Installed in project" : null,
            pkg.version ? `Version: ${pkg.version}` : null,
            pkg.popularity
              ? `Popularity: ${Math.round(pkg.popularity * 100)}%`
              : null,
          ]
            .filter(Boolean)
            .join(" | "),
          alwaysShow: true,
          pkg: pkg,
        };

        item.buttons = [];
        if (pkg.isInstalled) {
          item.buttons.push({
            iconPath: new vscode.ThemeIcon("trash"),
            tooltip: `Remove ${pkg.name} from pubspec.yaml`,
          });
        } else {
          item.buttons.push({
            iconPath: new vscode.ThemeIcon("add"),
            tooltip: `Add ${pkg.name} to pubspec.yaml`,
          });
        }

        return item;
      });
    } catch (error) {
      console.error("Error updating items:", error);
      quickPick.items = [
        { label: "Error fetching packages", alwaysShow: true },
      ];
    } finally {
      quickPick.busy = false;
    }
  }, 500);

  quickPick.onDidChangeValue(updateItems);

  quickPick.onDidChangeSelection(async (selection) => {
    if (selection[0]) {
      const pkg = (selection[0] as CustomQuickPickItem).pkg;
      quickPick.value = "";
      quickPick.items = [];

      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      if (pkg.isInstalled) {
        await addImportStatement(pkg.name, editor.document, editor.selection);
      } else {
        await runFlutterPubAdd(pkg.name, editor.document, editor.selection);
      }
    }
  });

  quickPick.onDidTriggerItemButton(async ({ item, button }) => {
    const pkg = (item as CustomQuickPickItem).pkg;
    quickPick.value = "";
    quickPick.items = [];

    if ((button as any).iconPath.id === "trash") {
      await runFlutterPubRemove(pkg.name);
    } else if ((button as any).iconPath.id === "add") {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await runFlutterPubAdd(pkg.name, editor.document, editor.selection);
      }
    }
  });

  quickPick.onDidTriggerButton(async (button) => {
    // if (button === filterButton) {
    showInstalledOnly = !showInstalledOnly;
    quickPick.buttons = [
      {
        iconPath: new vscode.ThemeIcon(
          showInstalledOnly ? "list-filter" : "filter"
        ),
        tooltip: showInstalledOnly
          ? "Show all packages"
          : "Show installed packages only",
      },
    ];
    await updateItems(quickPick.value);
    // }
  });

  quickPick.onDidHide(() => quickPick.dispose());

  await updateItems(initialQuery);
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
    quickPick.placeholder = `Packages matching "${query}" (type to filter, select to add/import)`;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.value = query;
    let showInstalledOnly = false;

    const filterButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon("filter"),
      tooltip: "Show installed packages only",
    };
    quickPick.buttons = [filterButton];

    quickPick.show();

    interface CustomQuickPickItem extends vscode.QuickPickItem {
      pkg: PackageInfo;
      buttons?: vscode.QuickInputButton[];
    }

    const updateItems = debounce(async (newQuery: string) => {
      quickPick.busy = true;
      try {
        let packages: PackageInfo[];
        if (showInstalledOnly) {
          packages = await getInstalledPackages(document);
          if (newQuery) {
            packages = packages.filter(
              (pkg) =>
                pkg.name.toLowerCase().includes(newQuery.toLowerCase()) ||
                (pkg.description &&
                  pkg.description
                    .toLowerCase()
                    .includes(newQuery.toLowerCase()))
            );
          }
        } else {
          packages = await fetchMatchingPackages(newQuery || query, document);
        }

        const filteredPackages = showInstalledOnly
          ? packages
          : packages.filter((pkg) => !(pkg.isInstalled && pkg.isImported));

        if (filteredPackages.length === 0) {
          quickPick.items = [
            {
              label: showInstalledOnly
                ? "No installed packages match your search"
                : "No packages found",
              alwaysShow: true,
            },
          ];
          return;
        }

        quickPick.items = filteredPackages.map<CustomQuickPickItem>((pkg) => {
          const item: CustomQuickPickItem = {
            label: pkg.isInstalled ? `✓ ${pkg.name}` : pkg.name,
            description: pkg.description
              ? truncateDescription(pkg.description, 60)
              : "No description available",
            detail: [
              pkg.isImported ? "📦 Already imported in this file" : null,
              pkg.isInstalled ? "📦 Installed in project" : null,
              pkg.version ? `Version: ${pkg.version}` : null,
              pkg.popularity
                ? `Popularity: ${Math.round(pkg.popularity * 100)}%`
                : null,
            ]
              .filter(Boolean)
              .join(" | "),
            alwaysShow: true,
            pkg: pkg,
          };

          item.buttons = [];
          if (pkg.isInstalled) {
            item.buttons.push({
              iconPath: new vscode.ThemeIcon("trash"),
              tooltip: `Remove ${pkg.name} from pubspec.yaml`,
            });
          } else {
            item.buttons.push({
              iconPath: new vscode.ThemeIcon("add"),
              tooltip: `Add ${pkg.name} to pubspec.yaml`,
            });
          }

          return item;
        });
      } catch (error) {
        console.error("Error updating suggestions:", error);
        quickPick.items = [
          { label: "Error fetching packages", alwaysShow: true },
        ];
      } finally {
        quickPick.busy = false;
      }
    }, 500);

    quickPick.onDidChangeValue(updateItems);

    quickPick.onDidChangeSelection(async (selection) => {
      if (selection[0]) {
        const pkg = (selection[0] as CustomQuickPickItem).pkg;
        quickPick.value = "";
        quickPick.items = [];

        if (pkg.isInstalled) {
          await addImportStatement(pkg.name, document, range);
        } else {
          await runFlutterPubAdd(pkg.name, document, range);
        }
      }
    });

    quickPick.onDidTriggerItemButton(async ({ item, button }) => {
      const pkg = (item as CustomQuickPickItem).pkg;
      quickPick.value = "";
      quickPick.items = [];

      if ((button as any).iconPath.id === "trash") {
        await runFlutterPubRemove(pkg.name);
      } else if ((button as any).iconPath.id === "add") {
        await runFlutterPubAdd(pkg.name, document, range);
      }
    });

    quickPick.onDidTriggerButton(async (button) => {
      if (button === filterButton) {
        showInstalledOnly = !showInstalledOnly;
        quickPick.buttons = [
          {
            iconPath: new vscode.ThemeIcon(
              showInstalledOnly ? "list-filter" : "filter"
            ),
            tooltip: showInstalledOnly
              ? "Show all packages"
              : "Show installed packages only",
          },
        ];
        await updateItems(quickPick.value);
      }
    });

    quickPick.onDidHide(() => quickPick.dispose());

    await updateItems(query);
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

async function runFlutterPubRemove(pkg: string) {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    vscode.window.showErrorMessage("Workspace folder not found");
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Removing package ${pkg}...`,
      cancellable: false,
    },
    async (progress) => {
      try {
        await new Promise<void>((resolve, reject) => {
          exec(`flutter pub remove ${pkg}`, { cwd }, (err, stdout, stderr) => {
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

        vscode.window.showInformationMessage(`✅ Package '${pkg}' removed`);
      } catch (error) {
        vscode.window.showErrorMessage(`❌ Failed to remove package: ${error}`);
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

async function getInstalledPackages(
  document: vscode.TextDocument
): Promise<PackageInfo[]> {
  const pubspecPath = path.join(
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
    "pubspec.yaml"
  );
  const fileContent = document.getText();
  const installedPackages: PackageInfo[] = [];

  if (!fs.existsSync(pubspecPath)) {
    return installedPackages;
  }

  const pubspecContent = fs.readFileSync(pubspecPath, "utf8");
  try {
    const pubspec = yaml.load(pubspecContent) as {
      dependencies?: Record<string, any>;
    };
    if (pubspec?.dependencies) {
      for (const [pkgName, versionSpec] of Object.entries(
        pubspec.dependencies
      )) {
        const packageInfo = await fetchPackageDetails(pkgName);
        installedPackages.push({
          name: pkgName,
          description: packageInfo.description || "No description available",
          isInstalled: true,
          isImported: fileContent.includes(
            `package:${pkgName}/${pkgName}.dart`
          ),
          methods: getPackageMethods(pkgName),
          version: typeof versionSpec === "string" ? versionSpec : undefined,
          latestVersion: packageInfo.latestVersion,
          popularity: packageInfo.popularity,
        });
      }
    }
  } catch (e) {
    console.error("Failed to parse pubspec.yaml:", e);
    const lines = pubspecContent.split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*([a-zA-Z0-9_-]+):\s*(.*)/);
      if (match) {
        const pkgName = match[1];
        const versionSpec = match[2].trim();
        const packageInfo = await fetchPackageDetails(pkgName);
        installedPackages.push({
          name: pkgName,
          description: packageInfo.description || "No description available",
          isInstalled: true,
          isImported: fileContent.includes(
            `package:${pkgName}/${pkgName}.dart`
          ),
          methods: getPackageMethods(pkgName),
          version: versionSpec,
          latestVersion: packageInfo.latestVersion,
          popularity: packageInfo.popularity,
        });
      }
    }
  }

  return installedPackages;
}

async function fetchPackageDetails(
  packageName: string
): Promise<Partial<PackageInfo>> {
  return new Promise((resolve) => {
    https
      .get(`https://pub.dev/api/packages/${packageName}`, (res) => {
        if (res.statusCode !== 200) {
          resolve({});
          return;
        }

        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const result = JSON.parse(data);
            resolve({
              description: result?.latest?.pubspec?.description,
              latestVersion: result?.latest?.version,
              popularity: result?.popularityScore,
            });
          } catch (e) {
            resolve({});
          }
        });
      })
      .on("error", () => resolve({}));
  });
}

async function fetchMatchingPackages(
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

              const installedPackages: Set<string> = new Set();
              if (pubspecContent) {
                try {
                  const pubspec = yaml.load(pubspecContent);
                  if (
                    typeof pubspec === "object" &&
                    pubspec !== null &&
                    "dependencies" in pubspec
                  ) {
                    Object.keys(
                      (pubspec as { dependencies: Record<string, any> })
                        .dependencies
                    ).forEach((dep) => {
                      installedPackages.add(dep.toLowerCase());
                    });
                  }
                } catch (e) {
                  console.error("Failed to parse pubspec.yaml:", e);
                  const lines = pubspecContent.split("\n");
                  lines.forEach((line) => {
                    const match = line.match(/^\s*([a-zA-Z0-9_-]+):/);
                    if (match) {
                      installedPackages.add(match[1].toLowerCase());
                    }
                  });
                }
              }

              const packages =
                results.packages?.slice(0, 10).map((pkg: any) => ({
                  name: pkg.package,
                  description: pkg.description || "No description available",
                  isInstalled: installedPackages.has(pkg.package.toLowerCase()),
                  isImported: fileContent.includes(
                    `package:${pkg.package}/${pkg.package}.dart`
                  ),
                  methods: getPackageMethods(pkg.package),
                  popularity: pkg.popularityScore,
                  latestVersion: pkg.latestVersion,
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

function getPackageMethods(packageName: string): string[] {
  const methodMap: { [key: string]: string[] } = {
    dio: ["get", "post", "put", "delete", "head", "patch", "download", "fetch"],
    get: ["to", "off", "offAll", "lazyPut", "put", "find", "reset"],
    flutter_bloc: [
      "BlocProvider",
      "BlocBuilder",
      "BlocListener",
      "BlocConsumer",
      "RepositoryProvider",
    ],
    provider: [
      "Provider",
      "ChangeNotifierProvider",
      "Consumer",
      "Selector",
      "MultiProvider",
      "FutureProvider",
      "StreamProvider",
    ],
    http: ["get", "post", "put", "delete", "head", "patch", "read"],
    shared_preferences: [
      "getInt",
      "setInt",
      "getBool",
      "setBool",
      "getDouble",
      "setDouble",
      "getString",
      "setString",
      "getStringList",
      "setStringList",
      "remove",
      "clear",
    ],
    cached_network_image: [
      "CachedNetworkImage",
      "CachedNetworkImageProvider",
      "clearCache",
    ],
    intl: [
      "DateFormat",
      "NumberFormat",
      "BidiFormatter",
      "MessageLookup",
      "Intl.defaultLocale",
    ],
    url_launcher: ["launch", "canLaunch", "launchUrl"],
    path_provider: [
      "getTemporaryDirectory",
      "getApplicationDocumentsDirectory",
      "getApplicationSupportDirectory",
      "getLibraryDirectory",
      "getExternalStorageDirectory",
    ],
    sqflite: [
      "openDatabase",
      "deleteDatabase",
      "Database",
      "DatabaseFactory",
      "Batch",
    ],
  };
  return methodMap[packageName.toLowerCase()] || [];
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
