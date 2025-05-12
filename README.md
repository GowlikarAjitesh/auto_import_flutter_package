# Flutter Package Manager

![Flutter Package Manager Logo](https://via.placeholder.com/150?text=Logo) <!-- Placeholder for logo -->

[![Version](https://img.shields.io/badge/version-0.0.1-blue.svg)](https://marketplace.visualstudio.com/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Build Status](https://img.shields.io/badge/build-passing-green.svg)](https://github.com/your-repo)

**Flutter Package Manager** is a powerful VS Code extension designed to streamline the process of adding and managing packages in your Flutter project's `pubspec.yaml` file. With an intuitive interface and seamless integration, it simplifies package management, saving you time and effort.

## Features

- **Quick Package Search**:
  - Trigger with `Ctrl+Shift+A` to open a Quick Pick UI.
  - Search for packages with a responsive search bar.
  - Prefills search with selected text for faster lookups.
  - Displays up to 10 package suggestions with name, version, and description.

- **Toggle Installed/Uninstalled Packages**:
  - Toggle button to switch between installed and uninstalled packages.
  - Dynamically updates search results based on toggle state.

- **Add/Delete Packages**:
  - Add packages with a `+` icon, silently updating `pubspec.yaml`.
  - Remove installed packages with a `×` icon, marked as "Already installed."
  - No terminal opened during operations; runs `flutter pub get` in the background.

- **Robust and Efficient**:
  - Comprehensive error handling for missing or invalid `pubspec.yaml`.
  - Caches package data for faster searches.
  - Responsive UI with clear icons and text for an intuitive experience.

## Installation

### From VS Code
1. Open VS Code.
2. Go to the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X` on macOS).
3. Search for **install from VSIX**.
4. Click **Drag and Drop our Project and Install**.

### From GitHub Repository
To install the extension directly from the GitHub repository, follow these steps:

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-repo/flutter-package-manager.git
2. **Install npm**:
   ```bash
   npm I
3. **Run and compile the code**:
   ```bash
   npm run compile
4. **Open in Debug Mode**:
   ```bash
   ctrl + shift + f5
  **Note:** A new window pops out, now open a Flutter project in that window.
5. **To search for a Flutter package**:
   ```bash
   ctrl + shift + a


Hurray!. You are ready to search, explore, add, or remove Flutter packages automatically through VS Code.

**Thankyou**
