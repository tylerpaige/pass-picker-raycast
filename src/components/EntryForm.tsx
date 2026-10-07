import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  Icon,
  getPreferenceValues,
  popToRoot,
  showHUD,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { getPassword, insertEntry, joinEntryPath, scanStore, validateEntryPath } from "../lib/pass";
import { DEFAULT_SPECIALS, MAX_LENGTH, generatePassword, minLength } from "../lib/generate";

const ROOT = "";

interface EntryFormProps {
  mode: "create" | "edit";
  /** Edit mode: the entry being edited. */
  entry?: string;
  /** Create mode: folder to preselect ("" for the store root). */
  initialFolder?: string;
  /** Create mode: name to prefill, may contain "/" for new subfolders. */
  initialName?: string;
  /** Called after a successful save. When omitted the form is treated as a standalone command. */
  onSaved?: () => void;
}

function defaults(): { length: string; specials: string } {
  const prefs = getPreferenceValues<Preferences>();
  const length = parseInt(prefs.defaultLength ?? "", 10);
  return {
    length: String(Number.isInteger(length) && length > 0 ? length : 20),
    specials: prefs.defaultSpecials ?? DEFAULT_SPECIALS,
  };
}

function parseLength(value: string, specials: string): { length?: number; error?: string } {
  const min = minLength(specials);
  if (!/^\d+$/.test(value.trim())) return { error: "Enter a whole number" };
  const length = parseInt(value, 10);
  if (length < min) return { error: `Must be at least ${min}` };
  if (length > MAX_LENGTH) return { error: `Must be at most ${MAX_LENGTH}` };
  return { length };
}

export default function EntryForm({ mode, entry, initialFolder = ROOT, initialName = "", onSaved }: EntryFormProps) {
  const { pop } = useNavigation();
  const initial = useRef(defaults()).current;

  const [dirs, setDirs] = useState<string[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  const [folder, setFolder] = useState(initialFolder);
  const [name, setName] = useState(initialName);
  const [password, setPassword] = useState("");
  const [originalPassword, setOriginalPassword] = useState("");
  const [lengthText, setLengthText] = useState(initial.length);
  const [specials, setSpecials] = useState(initial.specials);
  const [extra, setExtra] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);

  // While true, the password came from the generator and tracks length/specials changes.
  const [isGenerated, setIsGenerated] = useState(mode === "create");
  const lastGenerated = useRef("");

  const { length, error: lengthError } = parseLength(lengthText, specials);
  const fullPath = joinEntryPath(folder, name.trim());

  function regenerate(len = length, chars = specials) {
    if (len === undefined) return;
    const pw = generatePassword(len, chars);
    lastGenerated.current = pw;
    setPassword(pw);
    setIsGenerated(true);
  }

  useEffect(() => {
    if (mode === "create") {
      regenerate();
      scanStore()
        .then(({ entries, dirs }) => {
          setDirs(dirs.sort());
          setExisting(new Set(entries));
        })
        .catch((err) => {
          showToast({ style: Toast.Style.Failure, title: "Failed to scan password store", message: String(err) });
        })
        .finally(() => setIsLoading(false));
    } else if (entry) {
      getPassword(entry)
        .then((raw) => {
          const [first, ...rest] = raw.split("\n");
          setPassword(first);
          setOriginalPassword(first);
          setExtra(rest.join("\n").replace(/\n+$/, ""));
          setIsLoading(false);
        })
        .catch(async (err) => {
          await showToast({ style: Toast.Style.Failure, title: "Decryption failed", message: String(err) });
          pop();
        });
    }
  }, []);

  function onLengthChange(value: string) {
    setLengthText(value);
    if (isGenerated) regenerate(parseLength(value, specials).length, specials);
  }

  function onSpecialsChange(value: string) {
    setSpecials(value);
    if (isGenerated) regenerate(parseLength(lengthText, value).length, value);
  }

  function onPasswordChange(value: string) {
    setPassword(value);
    if (value !== lastGenerated.current) setIsGenerated(false);
  }

  const pathError = mode === "create" ? validateEntryPath(fullPath) : undefined;
  const duplicateError = mode === "create" && existing.has(fullPath) ? "An entry already exists here" : undefined;
  const nameError = duplicateError ?? (nameTouched ? pathError : undefined);

  async function submit() {
    const target = mode === "create" ? fullPath : entry!;
    const error = mode === "create" ? (duplicateError ?? pathError) : undefined;
    if (error) {
      setNameTouched(true);
      await showToast({ style: Toast.Style.Failure, title: error });
      return;
    }
    if (!password) {
      await showToast({ style: Toast.Style.Failure, title: "Password is required" });
      return;
    }
    if (/[\r\n]/.test(password)) {
      await showToast({ style: Toast.Style.Failure, title: "Password can't contain line breaks" });
      return;
    }

    const content = password + (extra.trim() ? "\n" + extra.trimEnd() : "") + "\n";
    const toast = await showToast({ style: Toast.Style.Animated, title: "Saving…" });
    try {
      await insertEntry(target, content);
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = "Save failed";
      toast.message = String(err);
      return;
    }

    const copied = mode === "create" || password !== originalPassword;
    if (copied) await Clipboard.copy(password, { concealed: true });
    const message = `${mode === "create" ? "Created" : "Saved"} ${target}${copied ? " — password copied" : ""}`;

    if (onSaved) {
      toast.style = Toast.Style.Success;
      toast.title = message;
      onSaved();
      pop();
    } else {
      await showHUD(message);
      await popToRoot({ clearSearchBar: true });
    }
  }

  // Keep the preselected folder selectable before the store scan finishes
  const folderOptions = folder && !dirs.includes(folder) ? [folder, ...dirs] : dirs;
  const PasswordField = showPassword ? Form.TextField : Form.PasswordField;

  return (
    <Form
      isLoading={isLoading}
      navigationTitle={mode === "create" ? "New Entry" : `Edit ${entry}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={mode === "create" ? "Save" : "Save Changes"}
            icon={Icon.Check}
            onSubmit={submit}
          />
          <Action
            title="Generate Password"
            icon={Icon.Key}
            shortcut={{ modifiers: ["cmd"], key: "g" }}
            onAction={() => regenerate()}
          />
          <Action
            title={showPassword ? "Hide Password" : "Show Password"}
            icon={showPassword ? Icon.EyeDisabled : Icon.Eye}
            shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
            onAction={() => setShowPassword((v) => !v)}
          />
          <Action.CopyToClipboard
            title="Copy Password"
            content={password}
            concealed
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
        </ActionPanel>
      }
    >
      {mode === "create" ? (
        <>
          <Form.Dropdown id="folder" title="Folder" value={folder} onChange={setFolder}>
            <Form.Dropdown.Item value={ROOT} title="(root)" icon={Icon.HardDrive} />
            {folderOptions.map((dir) => (
              <Form.Dropdown.Item key={dir} value={dir} title={dir} icon={Icon.Folder} />
            ))}
          </Form.Dropdown>
          <Form.TextField
            id="name"
            title="Name"
            placeholder="site-name or new-folder/site-name"
            value={name}
            onChange={(v) => setName(v)}
            onBlur={() => setNameTouched(true)}
            error={nameError}
            info="Use / to create subfolders inside the selected folder"
          />
          <Form.Description title="Path" text={name.trim() ? fullPath : `${folder ? folder + "/" : ""}…`} />
        </>
      ) : (
        <Form.Description title="Entry" text={entry ?? ""} />
      )}

      <Form.Separator />

      <PasswordField
        key={showPassword ? "visible" : "hidden"}
        id="password"
        title="Password"
        value={password}
        onChange={onPasswordChange}
        info="⌘G generates a new password from the settings below"
      />
      <Form.TextField
        id="length"
        title="Length"
        value={lengthText}
        onChange={onLengthChange}
        error={lengthError}
      />
      <Form.TextField
        id="specials"
        title="Special Characters"
        placeholder="(none — letters and digits only)"
        value={specials}
        onChange={onSpecialsChange}
        info="Generated passwords always include an uppercase letter, a lowercase letter and a digit, plus one of these characters if any are listed"
      />

      <Form.Separator />

      <Form.TextArea
        id="extra"
        title="Extra Lines"
        placeholder={"username: alice\nurl: https://example.com"}
        value={extra}
        onChange={setExtra}
        info="Everything after the first line of the entry"
      />
    </Form>
  );
}
