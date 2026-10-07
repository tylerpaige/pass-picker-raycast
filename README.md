# Pass Picker for Raycast

A [Raycast](https://raycast.com) extension for searching, copying, creating and editing passwords in the [pass](https://www.passwordstore.org/) password manager.

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
| `Enter` | Copy password (single-line entry) or open detail view (multi-line entry) |
| `Cmd + Enter` | Paste password into the frontmost app |
| `Cmd + E` | Edit the entry |
| `Cmd + N` | New entry in the selected entry's folder (or at the path typed in the search bar, see below) |
| `Cmd + Shift + N` | New entry, starting at the store root |

Decryption is handled by `pass show`, which delegates to GPG. If your GPG agent has the passphrase cached, actions are instant; otherwise GPG will prompt for your passphrase.

### Search

Search supports multiple query styles:

- **Path search**: type a literal path like `web/digital-ocean/` to match as a substring
- **Word search**: type space-separated words like `digital ocean` to match against any part of the path (path separators like `/`, `-`, `_`, `.` are treated as word boundaries)

### Creating from search

Type a path containing `/` into the search bar to create an entry there. For example, `web/aws/` gives you "New Entry in web/aws/", and `web/newsite/admin` gives you "Create web/newsite/admin". The deepest folder that already exists is preselected, and the rest becomes the name. When nothing matches, press `Enter` to create it. When entries do match, use `Cmd + N`.

### Multi-line entries

If a password entry contains more than one line, pressing Enter opens a detail view showing each key/value field as a row. From there you can arrow through fields and copy any value. If the entry is a single line (password only), Enter copies it directly.

## Creating and editing entries

Run **"Create Password"** from Raycast, or use the actions in Search Passwords above.

- **Folder**: pick any existing folder in the store (type to filter).
- **Name**: the entry name. Include `/` to create new subfolders inside the selected folder, e.g. `newsite/admin`. Saving is blocked if an entry already exists at that path.
- **Password**: a new password is generated as soon as the form opens. Changing the length or the special characters regenerates it, unless you've typed your own password.
- **Length** / **Special Characters**: generated passwords always contain at least one uppercase letter, one lowercase letter and one digit. They also contain at least one character from the special-character list, if the list isn't empty. Leave it empty for letters and digits only.
- **Extra Lines**: everything after the first line, such as `username: alice` or `url: https://…`.

The edit form (`Cmd + E`) changes an entry's contents in place, but not its path. It prefills the current password and all extra lines, including any `otpauth://` line, so OTP keeps working. The password stays as it is unless you press `Cmd + G` or type a new one.

| Shortcut | Action |
|---|---|
| `Cmd + Enter` | Save |
| `Cmd + G` | Generate a new password |
| `Cmd + Shift + H` | Show / hide the password |
| `Cmd + Shift + C` | Copy the password |

After saving, the new password is copied to the clipboard. This happens on every create, and on an edit only when the password changed. Entries are written with `pass insert --multiline --force`, so if your store is a git repo, `pass` commits the change.

The default length (20) and special characters (`!@#$%^&*()_`) can be changed in the extension's preferences.

## OTP (Two-Factor Authentication)

Pass supports TOTP codes via the [pass-otp](https://github.com/tadfisher/pass-otp) extension.

### Install pass-otp

```bash
brew install pass-otp
```

### Adding OTP to an existing entry

Most services show a QR code when setting up 2FA. You need the `otpauth://` URI hidden inside that QR code.

**Option A: Copy the secret manually**

Many services (including AWS) offer a "Can't scan the barcode?" or "Show secret key" link next to the QR code. Click it to reveal the secret, then construct the URI yourself:

```bash
pass otp append -s my-entry --issuer Example
```

Or use `--account` instead of `--issuer` (or both). Recent `pass-otp` (e.g. Homebrew 1.1.1+) requires **one of** `--issuer` / `--account` when using `-s`, or you will see: `Missing one of either '--issuer' or '--account'`.

This prompts for the secret key. Paste the secret and it generates the `otpauth://` URI for you. By default it assumes TOTP with 30-second period and 6 digits, which is correct for most services.

If you need more control, you can write the full URI directly:

```bash
pass otp append my-entry
```

Then paste a full URI like:

```
otpauth://totp/AWS:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=AWS
```

**Option B: Decode the QR code**

If you only have the QR code image (e.g. a screenshot), decode it to extract the `otpauth://` URI:

```bash
# Install zbar for QR decoding
brew install zbar

# Decode a screenshot
zbarimg --raw screenshot.png
```

This prints the `otpauth://` URI. Then append it:

```bash
pass otp append my-entry
# paste the otpauth:// URI
```

**Option C: Scan from screen**

If the QR code is currently displayed on screen, you can screenshot and decode in one step:

```bash
screencapture -i /tmp/qr.png && zbarimg --raw /tmp/qr.png
```

This lets you select a region of your screen. The decoded URI is printed to the terminal.

### AWS example

When enabling MFA on an AWS IAM user:

1. AWS shows a QR code. Click **"Show secret key"** to reveal the text secret.
2. Add it to your existing AWS entry (issuer label is what many apps show as “AWS”):
   ```bash
   pass otp append -s aws/iam/alice --issuer AWS
   ```
3. Paste the secret key when prompted.
4. Enter the TOTP code back into AWS to confirm:
   ```bash
   pass otp aws/iam/alice
   ```

### Generating OTP codes

```bash
# Print the current TOTP code
pass otp my-entry

# Copy it to clipboard (clears after 45s)
pass otp -c my-entry
```

### Entry format

After appending, your entry will look like:

```
mysecretpassword
username: alice
url: https://example.com
otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example
```

The `otpauth://` line is used by `pass otp` and will appear as a field in the detail view of this extension.

## Configuration

If your password store is in a non-default location, set the `PASSWORD_STORE_DIR` environment variable and the extension will use it automatically.

## How It Works

The extension scans `~/.password-store/` for `.gpg` files, strips the path prefix and extension to get entry names (e.g. `finance/chase`), and groups them by top-level folder. When you select an entry, it runs `pass show <entry>` to decrypt — the first line is treated as the password, and any remaining lines are displayed as metadata in the detail view. Creating and editing pipe the new contents to `pass insert --multiline --force <entry>`.
