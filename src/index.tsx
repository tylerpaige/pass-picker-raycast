import { List, ActionPanel, Action, Clipboard, showToast, Toast, useNavigation } from "@raycast/api";
import { useState, useEffect } from "react";
import { execFile } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { readdir, stat } from "fs/promises";
import { join, relative } from "path";

const execFileAsync = promisify(execFile);

const STORE_DIR = process.env.PASSWORD_STORE_DIR || join(homedir(), ".password-store");

const PATH = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  process.env.PATH,
].join(":");

const EXEC_ENV = { ...process.env, PATH };

async function scanStore(dir: string, base: string = dir): Promise<string[]> {
  const entries: string[] = [];
  const items = await readdir(dir);
  for (const item of items) {
    if (item.startsWith(".")) continue;
    const full = join(dir, item);
    const s = await stat(full);
    if (s.isDirectory()) {
      entries.push(...(await scanStore(full, base)));
    } else if (item.endsWith(".gpg")) {
      const rel = relative(base, full);
      entries.push(rel.replace(/\.gpg$/, ""));
    }
  }
  return entries;
}

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

async function getPassword(entry: string): Promise<string> {
  const { stdout } = await execFileAsync("pass", ["show", entry], { env: EXEC_ENV });
  return stdout;
}

function entryName(entry: string): string {
  const parts = entry.split("/");
  return parts[parts.length - 1];
}

interface Field {
  label: string;
  value: string;
  concealed?: boolean;
}

function parseFields(raw: string): Field[] {
  const lines = raw.split("\n");
  if (lines.length === 0) return [];

  const fields: Field[] = [{ label: "password", value: lines[0], concealed: true }];

  let i = 1;
  while (i < lines.length) {
    const line = lines[i];
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

  return fields;
}

function DetailsView({ entry, raw }: { entry: string; raw: string }) {
  const fields = parseFields(raw);

  return (
    <List navigationTitle={entry}>
      {fields.map((field, i) => (
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
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function EntryItem({ entry }: { entry: string }) {
  const { push } = useNavigation();

  async function selectEntry() {
    try {
      const raw = await getPassword(entry);
      const lines = raw.trim().split("\n");
      if (lines.length <= 1) {
        await Clipboard.copy(lines[0], { concealed: true });
        await showToast({ style: Toast.Style.Success, title: "Password copied" });
      } else {
        push(<DetailsView entry={entry} raw={raw} />);
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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    scanStore(STORE_DIR)
      .then((list) => {
        setAllEntries(groupByFolder(list));
        setLoading(false);
      })
      .catch((err) => {
        showToast({ style: Toast.Style.Failure, title: "Failed to scan password store", message: String(err) });
        setLoading(false);
      });
  }, []);

  const filtered = filterEntries(allEntries, search);

  return (
    <List
      isLoading={loading}
      searchBarPlaceholder="Search passwords..."
      filtering={false}
      onSearchTextChange={setSearch}
    >
      {[...filtered.entries()].map(([folder, items]) => (
        <List.Section key={folder} title={folder}>
          {items.map((entry) => (
            <EntryItem key={entry} entry={entry} />
          ))}
        </List.Section>
      ))}
    </List>
  );
}
