# Flutter Auto Import

![Extension Icon](images/icon2.png)

A Visual Studio Code extension that simplifies Flutter development by automatically detecting and importing required packages with intelligent suggestions.

## Features

### Smart Package Detection

![Demo](images/preview.gif)

- **Ctrl+Shift+A** on any text to search for matching Flutter packages
- Shows packages already installed in your project
- One-click import for new packages

### Intelligent Import Management

- Automatically adds imports at the correct file position
- Detects existing imports to prevent duplicates
- Runs `flutter pub get` automatically when needed

### Quick Actions

- Lightbulb 💡 suggestions for quick imports
- Status bar notifications for import status

## Installation

1. Open VS Code Extensions view (`Ctrl+Shift+X`)
2. Search for "Flutter Auto Import"
3. Click Install
4. Reload VS Code when prompted

## Configuration

Add these to your VS Code `settings.json`:

```json
{
  "flutterAutoImport.autoPubGetOnSave": true,
  "flutterAutoImport.enableSuggestions": true
}
```
