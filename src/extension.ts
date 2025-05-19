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

// --- Constants ---

const CONFIG_PREFIX = "flutterAutoImport";
const PUBSPEC_FILE = "pubspec.yaml";
const TERMINAL_NAME = "Flutter Pub Get";

// --- Utility Functions ---

function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | undefined;
  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func(...args), wait);
  };
}

function getWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getActiveDartEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor && editor.document.languageId === "dart" ? editor : undefined;
}

function getPubspecPath(): string | undefined {
  const workspacePath = getWorkspacePath();
  return workspacePath ? path.join(workspacePath, PUBSPEC_FILE) : undefined;
}

async function executeFlutterCommand(
  command: string,
  cwd: string,
  showTerminal: boolean = false
): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(`flutter ${command}`, { cwd }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr));
      }
      if (showTerminal) {
        const terminal =
          vscode.window.terminals.find((t) => t.name === TERMINAL_NAME) ||
          vscode.window.createTerminal(TERMINAL_NAME);
        terminal.show();
        terminal.sendText(`flutter ${command}`);
      }
      resolve();
    });
  });
}

async function fetchPackageDetails(
  packageName: string
): Promise<Partial<PackageInfo>> {
  return new Promise((resolve) => {
    https
      .get(`https://pub.dev/api/packages/${packageName}`, (res) => {
        if (res.statusCode !== 200) {
          return resolve({});
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
          } catch {
            resolve({});
          }
        });
      })
      .on("error", () => resolve({}));
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

// --- Package Data Functions ---

async function getInstalledPackages(
  document: vscode.TextDocument
): Promise<PackageInfo[]> {
  const pubspecPath = getPubspecPath();
  if (!pubspecPath || !fs.existsSync(pubspecPath)) {
    return [];
  }

  const pubspecContent = fs.readFileSync(pubspecPath, "utf8");
  const fileContent = document.getText();
  const packages: PackageInfo[] = [];

  try {
    const pubspec = yaml.load(pubspecContent) as {
      dependencies?: Record<string, any>;
    };
    if (pubspec?.dependencies) {
      for (const [pkgName, versionSpec] of Object.entries(
        pubspec.dependencies
      )) {
        const details = await fetchPackageDetails(pkgName);
        packages.push({
          name: pkgName,
          description: details.description || "No description available",
          isInstalled: true,
          isImported: fileContent.includes(
            `package:${pkgName}/${pkgName}.dart`
          ),
          methods: getPackageMethods(pkgName),
          version: typeof versionSpec === "string" ? versionSpec : undefined,
          latestVersion: details.latestVersion,
          popularity: details.popularity,
        });
      }
    }
  } catch {
    const lines77 = pubspecContent.split("\n");
    for (const line of lines77) {
      const match = line.match(/^\s*([a-zA-Z0-9_-]+):\s*(.*)/);
      if (match) {
        const pkgName = match[1];
        const versionSpec = match[2].trim();
        const details = await fetchPackageDetails(pkgName);
        packages.push({
          name: pkgName,
          description: details.description || "No description available",
          isInstalled: true,
          isImported: fileContent.includes(
            `package:${pkgName}/${pkgName}.dart`
          ),
          methods: getPackageMethods(pkgName),
          version: versionSpec,
          latestVersion: details.latestVersion,
          popularity: details.popularity,
        });
      }
    }
  }
  return packages;
}

async function fetchMatchingPackages(
  query: string,
  document: vscode.TextDocument
): Promise<PackageInfo[]> {
  const pubspecPath = getPubspecPath();
  const pubspecContent =
    pubspecPath && fs.existsSync(pubspecPath)
      ? fs.readFileSync(pubspecPath, "utf8")
      : "";
  const fileContent = document.getText();
  const installedPackages = new Set<string>();

  if (pubspecContent) {
    try {
      const pubspec = yaml.load(pubspecContent) as {
        dependencies?: Record<string, any>;
      };
      if (pubspec?.dependencies) {
        Object.keys(pubspec.dependencies).forEach((dep) =>
          installedPackages.add(dep.toLowerCase())
        );
      }
    } catch {
      pubspecContent.split("\n").forEach((line) => {
        const match = line.match(/^\s*([a-zA-Z0-9_-]+):/);
        if (match) {
          installedPackages.add(match[1].toLowerCase());
        }
      });
    }
  }

  return new Promise((resolve, reject) => {
    https
      .get(
        `https://pub.dev/api/search?q=${encodeURIComponent(query)}`,
        (res) => {
          if (res.statusCode !== 200) {
            return reject(
              new Error(`Request failed with status code ${res.statusCode}`)
            );
          }
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", async () => {
            try {
              const results = JSON.parse(data);
              const packagePromises =
                results.packages?.slice(0, 10).map(async (pkg: any) => {
                  const details = await fetchPackageDetails(pkg.package);
                  return {
                    name: pkg.package,
                    description:
                      details.description || "No description available",
                    isInstalled: installedPackages.has(
                      pkg.package.toLowerCase()
                    ),
                    isImported: fileContent.includes(
                      `package:${pkg.package}/${pkg.package}.dart`
                    ),
                    methods: getPackageMethods(pkg.package),
                    popularity: details.popularity,
                    latestVersion: details.latestVersion,
                  };
                }) || [];
              resolve(await Promise.all(packagePromises));
            } catch (e) {
              reject(e);
            }
          });
        }
      )
      .on("error", reject);
  });
}

// --- Package Actions ---

async function addImportStatement(
  pkg: string,
  document: vscode.TextDocument,
  range: vscode.Range
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const importStatement = `import 'package:${pkg}/${pkg}.dart';\n`;
  const fileContent = document.getText();

  await editor.edit((editBuilder) => {
    editBuilder.delete(range);
    if (!fileContent.includes(importStatement)) {
      editBuilder.insert(document.lineAt(0).range.start, importStatement);
      vscode.window.showInformationMessage(`✅ Imported package '${pkg}'`);
    } else {
      vscode.window.showInformationMessage(
        `ℹ️ Package '${pkg}' is already imported`
      );
    }
  });
}

async function runFlutterPubAdd(
  pkg: string,
  document?: vscode.TextDocument,
  range?: vscode.Range
): Promise<void> {
  const cwd = getWorkspacePath();
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
    async () => {
      try {
        await executeFlutterCommand(`pub add ${pkg}`, cwd);
        await executeFlutterCommand("pub get", cwd);
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

async function runFlutterPubRemove(pkg: string): Promise<void> {
  const cwd = getWorkspacePath();
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
    async () => {
      try {
        await executeFlutterCommand(`pub remove ${pkg}`, cwd);
        await executeFlutterCommand("pub get", cwd);
        vscode.window.showInformationMessage(`✅ Package '${pkg}' removed`);
      } catch (error) {
        vscode.window.showErrorMessage(`❌ Failed to remove package: ${error}`);
      }
    }
  );
}

// --- Providers ---

class PackageHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const range = document.getWordRangeAtPosition(position, /[a-z0-9_]+/i);
    if (!range || token.isCancellationRequested) {
      return undefined;
    }

    const word = document.getText(range);
    const packages = await fetchMatchingPackages(word, document);
    const pkg = packages.find((p) => p.name === word);
    if (!pkg) {
      return undefined;
    }

    const content = new vscode.MarkdownString(`**${pkg.name}**`);
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
      pkg.methods.forEach((method) =>
        content.appendMarkdown(`\n- \`${method}\``)
      );
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
    if (!match) {
      return [];
    }
    const [, packageName, partial] = match;
    const packages = await fetchMatchingPackages(packageName, document);
    const pkg = packages.find((p) => p.name === packageName);
    if (!pkg || !pkg.methods) {
      return [];
    }

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
    if (!selectedText.match(/^[a-z0-9_]+$/i)) {
      return;
    }
    const pubspecPath = getPubspecPath();
    if (!pubspecPath || !fs.existsSync(pubspecPath)) {
      return;
    }

    const content = fs.readFileSync(pubspecPath, "utf8");
    const isInstalled = content.includes(`${selectedText}:`);
    const isImported = document
      .getText()
      .includes(`package:${selectedText}/${selectedText}.dart`);
    const actions: vscode.CodeAction[] = [];

    if (isInstalled) {
      actions.push(
        createCodeAction(
          `📦 Import '${selectedText}' (already installed)`,
          "Import Package",
          "flutterAutoImport.addPubPackage",
          [selectedText, document, range]
        ),
        createCodeAction(
          `🗑️ Remove '${selectedText}' from pubspec.yaml`,
          "Remove Package",
          "flutterAutoImport.removePubPackage",
          [selectedText]
        )
      );
    }

    if (isInstalled && isImported) {
      return actions;
    }
    const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
    if (!config.get<boolean>("enableSuggestions", true)) {
      return actions;
    }

    const packages = await fetchMatchingPackages(selectedText, document);
    const availablePackages = packages.filter(
      (pkg) => !(pkg.isInstalled && pkg.isImported)
    );
    if (!availablePackages.length) {
      return actions;
    }

    return [
      ...actions,
      ...availablePackages.map((pkg) =>
        createCodeAction(
          pkg.isInstalled
            ? `📦 Import '${pkg.name}' (already installed)`
            : `✨ Add & import '${pkg.name}'`,
          pkg.isInstalled ? "Import Package" : "Add & Import Package",
          "flutterAutoImport.addPubPackage",
          [pkg.name, document, range],
          pkg.description ? ` - ${pkg.description}` : ""
        )
      ),
    ];
  }
}

function createCodeAction(
  title: string,
  commandTitle: string,
  command: string,
  args: any[],
  description: string = ""
): vscode.CodeAction {
  const action = new vscode.CodeAction(
    title + description,
    vscode.CodeActionKind.QuickFix
  );
  action.command = { title: commandTitle, command, arguments: args };
  return action;
}

// --- QuickPick UI ---

interface CustomQuickPickItem extends vscode.QuickPickItem {
  pkg: PackageInfo;
  buttons?: vscode.QuickInputButton[];
}

function createQuickPickItems(
  filteredPackages: PackageInfo[]
): CustomQuickPickItem[] {
  return filteredPackages.map((pkg) => {
    const detailParts = [
      pkg.isImported ? "$(check-circle) Already imported in this file" : null,
      pkg.isInstalled ? "$(package) Installed in project" : null,
      pkg.version ? `$(versions) Version: ${pkg.version}` : null,
      pkg.latestVersion ? `$(star) Latest: ${pkg.latestVersion}` : null,
      pkg.popularity
        ? `$(flame) Popularity: ${Math.round(pkg.popularity * 100)}%`
        : null,
      pkg.description
        ? `$(info) ${truncateDescription(pkg.description, 60)}`
        : null,
    ].filter(Boolean);

    return {
      label: pkg.isInstalled
        ? `$(check) ${pkg.name}`
        : `$(package) ${pkg.name}`,
      description: pkg.description || "No description available",
      detail: detailParts.join(" | "),
      alwaysShow: true,
      pkg,
      buttons: [
        pkg.isInstalled
          ? {
              iconPath: new vscode.ThemeIcon("trash"),
              tooltip: `Remove ${pkg.name} from pubspec.yaml`,
            }
          : {
              iconPath: new vscode.ThemeIcon("add"),
              tooltip: `Add ${pkg.name} to pubspec.yaml`,
            },
      ],
    };
  });
}

async function showPackageQuickPick(
  initialQuery: string,
  document?: vscode.TextDocument,
  range?: vscode.Range,
  showInstalledOnly: boolean = false
): Promise<void> {
  const quickPick = vscode.window.createQuickPick<CustomQuickPickItem>();
  quickPick.placeholder =
    "Search Flutter packages (type to filter, select to add/import)";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.value = initialQuery;
  quickPick.title = showInstalledOnly
    ? "📦 Installed Packages"
    : "🌐 All Packages";
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

  quickPick.show();

  const updateItems = debounce(async (query: string) => {
    quickPick.busy = true;
    quickPick.items = [
      {
        label: "Loading packages...",
        alwaysShow: true,
        description: "",
        detail: "",
        pkg: {
          name: "",
          isInstalled: false,
          isImported: false,
        },
      },
    ];
    try {
      const doc = document || getActiveDartEditor()?.document;
      if (!doc) {
        quickPick.items = [
          {
            label: "No active editor",
            alwaysShow: true,
            description: "",
            detail: "",
            pkg: {
              name: "",
              isInstalled: false,
              isImported: false,
            },
          },
        ];
        return;
      }

      const packages = showInstalledOnly
        ? await getInstalledPackages(doc)
        : await fetchMatchingPackages(query, doc);

      const filteredPackages = query
        ? packages.filter(
            (pkg) =>
              pkg.name.toLowerCase().includes(query.toLowerCase()) ||
              (pkg.description &&
                pkg.description.toLowerCase().includes(query.toLowerCase()))
          )
        : packages;

      quickPick.items = filteredPackages.length
        ? createQuickPickItems(filteredPackages)
        : [
            {
              label: showInstalledOnly
                ? "No installed packages match your search"
                : "No packages found",
              alwaysShow: true,
              description: "",
              detail: "",
              pkg: {
                name: "",
                isInstalled: false,
                isImported: false,
              },
            },
          ];
    } catch (error) {
      console.error("Error updating items:", error);
      quickPick.items = [
        {
          label: "Error fetching packages",
          alwaysShow: true,
          description: "",
          detail: "",
          pkg: {
            name: "",
            isInstalled: false,
            isImported: false,
          },
        },
      ];
    } finally {
      quickPick.busy = false;
    }
  }, 500);

  quickPick.onDidChangeValue(updateItems);

  quickPick.onDidChangeSelection(async (selection) => {
    if (!selection[0]) {
      return;
    }
    const { pkg } = selection[0];
    quickPick.value = "";
    quickPick.items = [];

    const doc = document || getActiveDartEditor()?.document;
    const rng = range || getActiveDartEditor()?.selection;
    if (!doc) {
      return;
    }

    if (pkg.isInstalled) {
      await addImportStatement(
        pkg.name,
        doc,
        rng ?? new vscode.Range(0, 0, 0, 0)
      );
    } else {
      await runFlutterPubAdd(pkg.name, doc, rng);
    }
  });

  quickPick.onDidTriggerItemButton(async ({ item, button }) => {
    const { pkg } = item;
    quickPick.value = "";
    quickPick.items = [];

    if ((button as any).iconPath.id === "trash") {
      await runFlutterPubRemove(pkg.name);
    } else if ((button as any).iconPath.id === "add") {
      const doc = document || getActiveDartEditor()?.document;
      const rng = range || getActiveDartEditor()?.selection;
      if (doc) {
        await runFlutterPubAdd(pkg.name, doc, rng);
      }
    }
  });

  quickPick.onDidTriggerButton(async () => {
    showInstalledOnly = !showInstalledOnly;
    quickPick.title = showInstalledOnly
      ? "📦 Installed *📦 Installed Packages"
      : "🌐 All Packages";
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
  });

  quickPick.onDidHide(() => quickPick.dispose());
  await updateItems(initialQuery);
}

async function checkAndShowPackageSuggestions(
  query: string,
  document: vscode.TextDocument,
  range: vscode.Range
): Promise<void> {
  const loadingMessage = vscode.window.setStatusBarMessage(
    "🔍 Searching for packages..."
  );
  try {
    const packages = await fetchMatchingPackages(query, document);
    const availablePackages = packages.filter(
      (pkg) => !(pkg.isInstalled && pkg.isImported)
    );
    if (!availablePackages.length) {
      vscode.window.showInformationMessage(
        `All matching packages are already installed and imported`
      );
      return;
    }
    await showPackageQuickPick(query, document, range);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to search for packages: ${error}`);
  } finally {
    loadingMessage.dispose();
  }
}

// --- Extension Activation ---

export function activate(context: vscode.ExtensionContext): void {
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
    ),
    vscode.languages.registerHoverProvider("dart", new PackageHoverProvider()),
    vscode.languages.registerCompletionItemProvider(
      "dart",
      new FunctionCompletionProvider(),
      "."
    )
  );

  vscode.workspace.onDidSaveTextDocument((document) => {
    const isPubspec = document.fileName.endsWith(PUBSPEC_FILE);
    const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
    if (isPubspec && config.get<boolean>("autoPubGetOnSave", true)) {
      if (pubGetTimeout) {
        clearTimeout(pubGetTimeout);
      }
      pubGetTimeout = setTimeout(
        () => executeFlutterCommand("pub get", getWorkspacePath() || ""),
        1000
      );
    }
  });

  const commands = [
    {
      id: "flutterAutoImport.addPubPackage",
      handler: async (
        pkg: string,
        document?: vscode.TextDocument,
        range?: vscode.Range
      ) => runFlutterPubAdd(pkg, document, range),
    },
    {
      id: "flutterAutoImport.removePubPackage",
      handler: async (pkg: string) => runFlutterPubRemove(pkg),
    },
    {
      id: "flutterAutoImport.showPackageSuggestions",
      handler: async () => {
        const editor = getActiveDartEditor();
        if (!editor) {
          return;
        }
        const selectedText = editor.document.getText(editor.selection).trim();
        if (!selectedText || !selectedText.match(/^[a-z0-9_]+$/i)) {
          await showPackageQuickPick("");
        } else {
          await checkAndShowPackageSuggestions(
            selectedText,
            editor.document,
            editor.selection
          );
        }
      },
    },
    {
      id: "flutterAutoImport.searchPackages",
      handler: async () => {
        const editor = getActiveDartEditor();
        if (!editor) {
          return;
        }
        await showPackageQuickPick(
          editor.document.getText(editor.selection).trim()
        );
      },
    },
    {
      id: "flutterAutoImport.searchPackagesKey",
      handler: async () => {
        const editor = getActiveDartEditor();
        if (!editor) {
          return;
        }
        await showPackageQuickPick(
          editor.document.getText(editor.selection).trim()
        );
      },
    },
  ];

  commands.forEach(({ id, handler }) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler))
  );
}
