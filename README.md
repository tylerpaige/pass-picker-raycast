# Pass Picker for Raycast

A [Raycast](https://raycast.com) extension for searching and copying passwords from the [pass](https://www.passwordstore.org/) password manager.

## Prerequisites

- [Raycast](https://raycast.com) installed
- [pass](https://www.passwordstore.org/) installed and configured (`brew install pass`)
- A GPG key set up with `pass init`
- A populated password store (default `~/.password-store/`)

## Installation

```bash
git clone <repo-url> pass-picker-raycast
cd pass-picker-raycast
npm install
npm run dev
```

This opens the extension in Raycast in development mode. From there you can search "Search Passwords" to use it.

To install it permanently without dev mode, use **Import Extension** in Raycast's developer settings.

## Usage

Open Raycast and search **"Search Passwords"**. Your password store entries appear in a list grouped by folder. Use Raycast's built-in fuzzy search to filter.

### Actions

| Shortcut | Action |
|---|---|
| `Enter` | Copy password to clipboard (concealed) |
| `Cmd + Enter` | Paste password into the frontmost app |
| `Cmd + Shift + Enter` | View full entry details (password + metadata) |

Decryption is handled by `pass show`, which delegates to GPG. If your GPG agent has the passphrase cached, actions are instant; otherwise GPG will prompt for your passphrase.

## Configuration

If your password store is in a non-default location, set the `PASSWORD_STORE_DIR` environment variable and the extension will use it automatically.

## How It Works

The extension scans `~/.password-store/` for `.gpg` files, strips the path prefix and extension to get entry names (e.g. `finance/chase`), and groups them by top-level folder. When you select an entry, it runs `pass show <entry>` to decrypt — the first line is treated as the password, and any remaining lines are displayed as metadata in the detail view.
