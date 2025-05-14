# Flutter Package Manager

<img src="https://github.com/GowlikarAjitesh/auto_import_flutter_package/blob/main/images/icon2.png" alt="Flutter Package Manager Logo" width="100" height="100">

[![Version](https://img.shields.io/badge/version-0.0.1-blue.svg)](https://marketplace.visualstudio.com/) [![Build Status](https://img.shields.io/badge/build-passing-green.svg)](https://github.com/GowlikarAjitesh/auto_import_flutter_package)

**Flutter Package Manager** is a powerful Visual Studio Code (VS Code) extension designed to streamline the **management of Flutter packages** in your project's `pubspec.yaml` file. With an intuitive interface and seamless integration, it simplifies package management, saving developers time and effort. The repository also includes a companion extension, **Flutter Dependency Fixer**, to address dependency-related issues.

## Prerequisites

- **Flutter**: Ensure Flutter is installed and configured on your system.
- **VS Code**: Use Visual Studio Code with a Flutter project open (must include a `pubspec.yaml` file in the workspace root).
- **Node.js**: Required for building the extension from source.



## Features

- **Quick Package Search**:
  - Trigger with `Ctrl+Shift+A` to open a Quick Pick UI.
  - Search packages using a responsive search bar, prefilled with selected text for faster lookups.
  - Displays up to 10 package suggestions with name, version, and description.

- **Toggle Installed/Uninstalled Packages**:
  - Toggle button to switch between installed and uninstalled packages.
  - Dynamically updates search results based on toggle state.

- **Add/Delete Packages**:
  - Add packages with a `+` icon, silently updating `pubspec.yaml`.
  - Remove installed packages with a `×` icon, marked as "Already installed."
  - Executes `flutter pub get` in the background without opening a terminal.

- **Hover Information**:
  - Hover over package names in `pubspec.yaml` to view detailed descriptions and available methods (placeholder due to pub.dev API limitations).
  - Presented in a clean, Markdown-formatted tooltip.

- **Robust and Efficient**:
  - Comprehensive error handling for missing or invalid `pubspec.yaml` files.
  - Caches package data for faster searches.
  - Responsive UI with clear icons and text for an intuitive experience.

## Installation

### From VS Code (Easy Way)

1. Download the `.vsix` files from our [GitHub repository](https://github.com/GowlikarAjitesh/auto_import_flutter_package).  **(This is the same Repository, just scroll up)**
   - `auto-import-flutter-0.1.1.vsix` (Flutter Package Manager)
   - `flutter-dep-fixer-0.0.1.vsix` (Flutter Dependency Fixer, optional)
2. Open VS Code.
3. Go to the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X` on macOS).
4. Click the **...** menu and select **Install from VSIX**.
5. Drag and drop or browse to each `.vsix` file and install.

### From GitHub Repository
To build and install the extension from source:

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/GowlikarAjitesh/auto_import_flutter_package.git
2. **Navigate to the Project Directory**:
    ```bash
    cd auto_import_flutter_package
3. **Install Dependencies**:
   Ensure Node.js is installed, then run:
    ```bash
    npm install
4. **Compile the Code**:
      Build the extension using esbuild:
    ```bash
    npm run build
5. **Package the Extension**:
Create a .vsix file using vsce:
    ```bash
    npm run package
    
**Note:** This generates a file like flutter-package-manager-0.0.1.vsix in the project root.

6. **Install the Extension**: Follow the "From VS Code" steps above to install the .vsix file.

### Development (Debug Mode)

Open the project in VS Code.

Press Ctrl+Shift+F5 (or F5 for standard debugging) to launch the Extension Development Host.

A new VS Code window will open; open a Flutter project in this window to test the extension.

## 🛠️ Usage

### Basic Commands
| Shortcut               | Action                          |
|------------------------|---------------------------------|
| `Ctrl` + `Shift` + `A` | Open package manager interface  |
| `Ctrl` + `Shift` + `P` | Show VS Code command palette    |

### Search and Manage Packages:

Press Ctrl+Shift+A to open the package manager.

Use the search bar to find packages or select text in the editor to prefill the search.

Toggle between Installed Packages and Other Packages using the filter button.

Click the + icon to add a package or the × icon to remove an installed package.

View Package Details:

Open pubspec.yaml and hover over a package name to see its description and methods (placeholder).

## Error Handling
The extension notifies you if pubspec.yaml is missing or if there are network issues.

Example Screenshot
Example Screenshot

## Contributors
This project was brought to life by the dedicated efforts of:

Ajitesh

Dharmendra

Phanindra
## Screen Shots
![image](https://github.com/user-attachments/assets/539deaa8-96b1-4963-90c3-a72b884792c3)
![image](https://github.com/user-attachments/assets/820829e7-2c1c-4f63-ba2c-2040f0b88c04)
![image](https://github.com/user-attachments/assets/41c21748-90c7-4196-8b3f-ba460fbb8a8f)
![image](https://github.com/user-attachments/assets/0e7d0cc9-f3ca-4af6-a9d3-b94b9333f939)
![image](https://github.com/user-attachments/assets/d0c62c47-f7cd-4aa2-a2f3-ff4aa9b0195d)

