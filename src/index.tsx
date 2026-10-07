import { List, ActionPanel, Action, Clipboard, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useState, useEffect } from "react";
import { folderOf, getOtp, getPassword, joinEntryPath, scanStore } from "./lib/pass";
import EntryForm from "./components/EntryForm";

function groupByFolder(entries: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const entry of entries.sort()) {
    const slash = entry.indexOf("/");
    const folder = slash === -1 ? "(root)" : entry.slice(0, slash);
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder)!.push(entry);
  }
  return groups;
}

interface Field {
  label: string;
  value: string;
  concealed?: boolean;
  otp?: boolean;
}

function parseFields(raw: string): Field[] {
  const lines = raw.split("\n");
  if (lines.length === 0) return [];

  const fields: Field[] = [{ label: "password", value: lines[0], concealed: true }];
  let hasOtp = false;

  let i = 1;
  while (i < lines.length) {
    const line = lines[i];

    // Detect otpauth:// URI — don't expose the secret, just flag for OTP generation
    if (line.trim().startsWith("otpauth://")) {
      hasOtp = true;
      i++;
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const firstLineValue = line.slice(colonIdx + 1).trim();

      // Collect continuation lines (indented or empty lines following a key)
      const valueParts: string[] = [];
      if (firstLineValue) valueParts.push(firstLineValue);
      while (i + 1 < lines.length && lines[i + 1].match(/^[\s]/) && lines[i + 1].trim() !== "") {
        i++;
        valueParts.push(lines[i].trim());
      }

      if (valueParts.length <= 1) {
        fields.push({ label: key, value: valueParts[0] || "" });
      } else {
        // Multiline value: one row per line
        for (const part of valueParts) {
          fields.push({ label: key, value: part });
        }
      }
    } else if (line.trim() !== "") {
      // Line with no colon — treat as unlabeled
      fields.push({ label: "", value: line.trim() });
    }
    i++;
  }

  if (hasOtp) {
    fields.push({ label: "otp", value: "", otp: true });
  }

  return fields;
}

function OtpItem({ entry }: { entry: string }) {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    getOtp(entry)
      .then(setCode)
      .catch((err) => {
        showToast({ style: Toast.Style.Failure, title: "OTP generation failed", message: String(err) });
      });
  }, [entry]);

  return (
    <List.Item
      title="otp"
      accessories={[{ text: code ?? "generating..." }]}
      actions={
        code ? (
          <ActionPanel>
            <Action.CopyToClipboard title="Copy Value" content={code} />
            <Action.Paste
              title="Paste Value"
              content={code}
              shortcut={{ modifiers: ["cmd"], key: "return" }}
            />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}

function DetailsView({ entry, raw, onSaved }: { entry: string; raw: string; onSaved: () => void }) {
  const { push, pop } = useNavigation();
  const fields = parseFields(raw);

  // After saving, leave this (now stale) view and return to the refreshed list
  const editAction = (
    <Action
      title="Edit Entry"
      icon={Icon.Pencil}
      shortcut={{ modifiers: ["cmd"], key: "e" }}
      onAction={() =>
        push(
          <EntryForm
            mode="edit"
            entry={entry}
            onSaved={() => {
              onSaved();
              pop();
            }}
          />
        )
      }
    />
  );

  return (
    <List navigationTitle={entry}>
      {fields.map((field, i) =>
        field.otp ? (
          <OtpItem key={i} entry={entry} />
        ) : (
          <List.Item
            key={i}
            title={field.label || "(unlabeled)"}
            accessories={[{ text: field.concealed ? "••••••••" : field.value }]}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard
                  title="Copy Value"
                  content={field.value}
                  concealed={field.concealed}
                />
                <Action.Paste
                  title="Paste Value"
                  content={field.value}
                  shortcut={{ modifiers: ["cmd"], key: "return" }}
                />
                {editAction}
              </ActionPanel>
            }
          />
        )
      )}
    </List>
  );
}

/** Where a new entry typed into the search bar (e.g. "web/newsite") should go. */
interface CreateTarget {
  folder: string;
  name: string;
}

/**
 * Splits a search like "web/aws/new-thing" into the deepest existing folder
 * ("web/aws") and the rest ("new-thing"). Returns undefined for searches without "/".
 */
function createTargetFromSearch(search: string, dirs: Set<string>): CreateTarget | undefined {
  const path = search.trim().replace(/^\/+/, "");
  if (!path.includes("/")) return undefined;
  const segments = path.split("/");
  for (let i = segments.length - 1; i > 0; i--) {
    const folder = segments.slice(0, i).join("/");
    if (dirs.has(folder)) return { folder, name: segments.slice(i).join("/") };
  }
  return { folder: "", name: path };
}

function CreateActions({
  folder,
  searchTarget,
  onSaved,
}: {
  folder?: string;
  searchTarget?: CreateTarget;
  onSaved: () => void;
}) {
  const { push } = useNavigation();
  const create = (target: Partial<CreateTarget>) =>
    push(<EntryForm mode="create" initialFolder={target.folder} initialName={target.name} onSaved={onSaved} />);

  return (
    <ActionPanel.Section>
      {searchTarget && (
        <Action
          title={searchTarget.name ? `Create ${joinEntryPath(searchTarget.folder, searchTarget.name)}` : `New Entry in ${searchTarget.folder}/`}
          icon={Icon.PlusCircle}
          shortcut={{ modifiers: ["cmd"], key: "n" }}
          onAction={() => create(searchTarget)}
        />
      )}
      {folder && (
        <Action
          title={`New Entry in ${folder}/`}
          icon={Icon.NewFolder}
          shortcut={searchTarget ? undefined : { modifiers: ["cmd"], key: "n" }}
          onAction={() => create({ folder })}
        />
      )}
      <Action
        title="New Entry…"
        icon={Icon.Plus}
        shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
        onAction={() => create({})}
      />
    </ActionPanel.Section>
  );
}

function EntryItem({
  entry,
  searchTarget,
  onSaved,
}: {
  entry: string;
  searchTarget?: CreateTarget;
  onSaved: () => void;
}) {
  const { push } = useNavigation();

  async function selectEntry() {
    try {
      const raw = await getPassword(entry);
      const lines = raw.trim().split("\n");
      if (lines.length <= 1) {
        await Clipboard.copy(lines[0], { concealed: true });
        await showToast({ style: Toast.Style.Success, title: "Password copied" });
      } else {
        push(<DetailsView entry={entry} raw={raw} onSaved={onSaved} />);
      }
    } catch (err) {
      await showToast({ style: Toast.Style.Failure, title: "Decryption failed", message: String(err) });
    }
  }

  async function pastePassword() {
    try {
      const raw = await getPassword(entry);
      const pw = raw.split("\n")[0];
      await Clipboard.paste(pw);
      await showToast({ style: Toast.Style.Success, title: "Password pasted" });
    } catch (err) {
      await showToast({ style: Toast.Style.Failure, title: "Decryption failed", message: String(err) });
    }
  }

  return (
    <List.Item
      title={entry}
      actions={
        <ActionPanel>
          <Action title="Select" onAction={selectEntry} />
          <Action
            title="Paste Password"
            shortcut={{ modifiers: ["cmd"], key: "return" }}
            onAction={pastePassword}
          />
          <Action
            title="Edit Entry"
            icon={Icon.Pencil}
            shortcut={{ modifiers: ["cmd"], key: "e" }}
            onAction={() => push(<EntryForm mode="edit" entry={entry} onSaved={onSaved} />)}
          />
          <CreateActions folder={folderOf(entry)} searchTarget={searchTarget} onSaved={onSaved} />
        </ActionPanel>
      }
    />
  );
}

function matchesQuery(entry: string, query: string): boolean {
  const lower = entry.toLowerCase();
  // If the query contains path separators, match as a literal substring
  if (query.includes("/")) return lower.includes(query);
  // Otherwise treat each space-separated token as a term that must appear
  // anywhere in the path (split on / - _ . for matching)
  const words = lower.replace(/[\/\-_.]/g, " ");
  return query.split(/\s+/).every((token) => words.includes(token) || lower.includes(token));
}

function filterEntries(grouped: Map<string, string[]>, query: string): Map<string, string[]> {
  if (!query) return grouped;
  const lower = query.toLowerCase();
  const filtered = new Map<string, string[]>();
  for (const [folder, items] of grouped) {
    const matches = items.filter((entry) => matchesQuery(entry, lower));
    if (matches.length > 0) filtered.set(folder, matches);
  }
  return filtered;
}

export default function Command() {
  const [allEntries, setAllEntries] = useState<Map<string, string[]>>(new Map());
  const [dirs, setDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  function reload() {
    setLoading(true);
    scanStore()
      .then(({ entries, dirs }) => {
        setAllEntries(groupByFolder(entries));
        setDirs(new Set(dirs));
        setLoading(false);
      })
      .catch((err) => {
        showToast({ style: Toast.Style.Failure, title: "Failed to scan password store", message: String(err) });
        setLoading(false);
      });
  }

  useEffect(reload, []);

  const filtered = filterEntries(allEntries, search);
  const searchTarget = createTargetFromSearch(search, dirs);

  return (
    <List
      isLoading={loading}
      searchBarPlaceholder="Search passwords, or type a path like web/new-site to create..."
      filtering={false}
      onSearchTextChange={setSearch}
    >
      <List.EmptyView
        title={searchTarget ? `No entries match ${search}` : "No matching entries"}
        description={searchTarget ? "Press Enter to create it" : "Type a path containing / to create a new entry"}
        actions={
          <ActionPanel>
            <CreateActions searchTarget={searchTarget} onSaved={reload} />
          </ActionPanel>
        }
      />
      {[...filtered.entries()].map(([folder, items]) => (
        <List.Section key={folder} title={folder}>
          {items.map((entry) => (
            <EntryItem key={entry} entry={entry} searchTarget={searchTarget} onSaved={reload} />
          ))}
        </List.Section>
      ))}
    </List>
  );
}
