import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { readdir, stat } from "fs/promises";
import { join, relative } from "path";

const execFileAsync = promisify(execFile);

export const STORE_DIR = process.env.PASSWORD_STORE_DIR || join(homedir(), ".password-store");

const PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH].join(":");

const EXEC_ENV = { ...process.env, PATH };

export interface StoreContents {
  entries: string[];
  dirs: string[];
}

export async function scanStore(dir: string = STORE_DIR, base: string = dir): Promise<StoreContents> {
  const result: StoreContents = { entries: [], dirs: [] };
  const items = await readdir(dir);
  for (const item of items) {
    if (item.startsWith(".")) continue;
    const full = join(dir, item);
    const s = await stat(full);
    if (s.isDirectory()) {
      result.dirs.push(relative(base, full));
      const sub = await scanStore(full, base);
      result.entries.push(...sub.entries);
      result.dirs.push(...sub.dirs);
    } else if (item.endsWith(".gpg")) {
      const rel = relative(base, full);
      result.entries.push(rel.replace(/\.gpg$/, ""));
    }
  }
  return result;
}

export async function getPassword(entry: string): Promise<string> {
  const { stdout } = await execFileAsync("pass", ["show", entry], { env: EXEC_ENV });
  return stdout;
}

export async function getOtp(entry: string): Promise<string> {
  const { stdout } = await execFileAsync("pass", ["otp", entry], { env: EXEC_ENV });
  return stdout.trim();
}

export function entryName(entry: string): string {
  const parts = entry.split("/");
  return parts[parts.length - 1];
}

/** The folder containing an entry, or "" for the store root. */
export function folderOf(entry: string): string {
  const slash = entry.lastIndexOf("/");
  return slash === -1 ? "" : entry.slice(0, slash);
}

export function joinEntryPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

/** Returns an error message if the path can't be used as an entry name, otherwise undefined. */
export function validateEntryPath(entry: string): string | undefined {
  if (!entry) return "Name is required";
  if (entry.startsWith("/") || entry.endsWith("/")) return "Path can't start or end with /";
  const segments = entry.split("/");
  if (segments.some((s) => s === "")) return "Path can't contain empty segments";
  if (segments.some((s) => s === "." || s === "..")) return "Path can't contain . or .. segments";
  if (segments.some((s) => s.startsWith("."))) return "Names can't start with .";
  if (entry.endsWith(".gpg")) return "Leave off the .gpg extension";
  return undefined;
}

export async function entryExists(entry: string): Promise<boolean> {
  try {
    await stat(join(STORE_DIR, entry + ".gpg"));
    return true;
  } catch {
    return false;
  }
}

/** Writes `content` to `entry`, creating it (and any folders) or overwriting it. */
export function insertEntry(entry: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pass", ["insert", "--multiline", "--force", entry], { env: EXEC_ENV });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `pass insert exited with code ${code}`));
    });
    child.stdin.end(content);
  });
}
