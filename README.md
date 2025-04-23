# Flutter Auto Import Extension

![VS Code Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/your-name.flutter-auto-import)
![VS Code Installs](https://img.shields.io/visual-studio-marketplace/i/your-name.flutter-auto-import)
![License](https://img.shields.io/github/license/your-name/flutter-auto-import)

A Visual Studio Code extension that simplifies Flutter package management by automatically suggesting, adding, and importing packages with intelligent detection of existing dependencies.

## Features

- 🔍 **Smart Package Search**: Find Flutter packages by typing partial names
- ⚡ **One-Click Import**: Add packages to `pubspec.yaml` and import them with a single action
- ✅ **Dependency Awareness**: Know which packages are already installed or imported
- 🚀 **Quick Actions**: Code actions for quick package management
- ⏱️ **Auto Pub Get**: Automatically run `flutter pub get` when `pubspec.yaml` changes

## Installation

1. Open VS Code
2. Go to Extensions view (`Ctrl+Shift+X`)
3. Search for "Flutter Auto Import"
4. Click Install

## Usage

### Basic Usage

1. Select a word in your Dart file that might be a package name
2. Press `Ctrl+Shift+A` (Windows/Linux) or `Cmd+Shift+A` (Mac)
3. Select a package from the suggestions
4. The extension will:
   - Add the package to `pubspec.yaml` (if not present)
   - Run `flutter pub get`
   - Add the import statement at the top of your file
   - Remove your original selected text

### Code Actions

When you select text that matches a package name, you'll see lightbulb 💡 suggestions:
- **Add & import**: For new packages
- **Import**: For packages already in `pubspec.yaml`
- (No action shown for packages already imported)

### Commands

| Command | Description | Default Keybinding |
|---------|-------------|--------------------|
| `Flutter: Show Package Suggestions` | Search for packages matching selected text | `Ctrl+Shift+A` |

## Configuration

Add these to your VS Code settings (`settings.json`):

```json
{
  "flutterAutoImport.autoPubGetOnSave": true,
  "flutterAutoImport.enableSuggestions": true
}
