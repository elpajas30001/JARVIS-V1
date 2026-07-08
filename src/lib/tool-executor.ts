/**
 * JARVIS Tool Executor — Server-side Node.js tool implementations.
 * All tools run exclusively in API routes (server-side) using Node's fs, os, child_process.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { ToolName } from "./jarvis-tools";

const execAsync = promisify(exec);

// ─── Directory shortcut resolution ──────────────────────────────────────────

const SHORTCUT_MAP: Record<string, () => string> = {
  home: () => os.homedir(),
  downloads: () => path.join(os.homedir(), "Downloads"),
  desktop: () => path.join(os.homedir(), "Desktop"),
  documents: () => path.join(os.homedir(), "Documents"),
  pictures: () => path.join(os.homedir(), "Pictures"),
  music: () => path.join(os.homedir(), "Music"),
  videos: () => path.join(os.homedir(), "Videos"),
};

function resolveDir(input: string): string {
  const key = input.trim().toLowerCase();
  if (SHORTCUT_MAP[key]) return SHORTCUT_MAP[key]();
  return input;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// ─── Tool: list_files ────────────────────────────────────────────────────────

export async function listFiles(args: { directory: string }) {
  const dir = resolveDir(args.directory);

  try {
    if (!fs.existsSync(dir)) {
      return { error: `Directory not found: ${dir}`, resolved_path: dir };
    }

    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      return { error: `Path is not a directory: ${dir}`, resolved_path: dir };
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const items = entries.map((entry) => {
      const fullPath = path.join(dir, entry.name);
      let size: string | null = null;
      let modified: string | null = null;
      try {
        const s = fs.statSync(fullPath);
        size = entry.isFile() ? formatBytes(s.size) : null;
        modified = s.mtime.toLocaleString();
      } catch {
        // silently ignore inaccessible entries
      }
      return {
        name: entry.name,
        type: entry.isDirectory() ? "folder" : "file",
        size,
        modified,
        path: fullPath,
      };
    });

    // Sort: folders first, then files alphabetically
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      directory: dir,
      count: items.length,
      items,
    };
  } catch (err) {
    return {
      error: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}`,
      resolved_path: dir,
    };
  }
}

// ─── Tool: search_files ──────────────────────────────────────────────────────

function matchesPattern(name: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars except * ?
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  const regex = new RegExp(`^${regexStr}$`, "i");
  return regex.test(name);
}

function searchRecursive(
  searchDir: string,
  pattern: string,
  results: Array<{
    name: string;
    path: string;
    type: string;
    size: string | null;
    modified: string | null;
  }>,
  maxResults: number,
  depth: number
) {
  if (results.length >= maxResults || depth > 6) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(searchDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) break;
    // Skip hidden directories and common system dirs
    if (
      entry.name.startsWith(".") ||
      ["node_modules", "System Volume Information", "$Recycle.Bin", "AppData"].includes(entry.name)
    ) {
      continue;
    }

    if (matchesPattern(entry.name, pattern)) {
      const fullPath = path.join(searchDir, entry.name);
      let size: string | null = null;
      let modified: string | null = null;
      try {
        const s = fs.statSync(fullPath);
        size = entry.isFile() ? formatBytes(s.size) : null;
        modified = s.mtime.toLocaleString();
      } catch {
        // ignore
      }
      results.push({
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? "folder" : "file",
        size,
        modified,
      });
    }

    if (entry.isDirectory()) {
      searchRecursive(
        path.join(searchDir, entry.name),
        pattern,
        results,
        maxResults,
        depth + 1
      );
    }
  }
}

export async function searchFiles(args: {
  query: string;
  directory?: string;
}) {
  const searchDir = args.directory ? resolveDir(args.directory) : os.homedir();
  const pattern = args.query.trim() || "*";

  try {
    if (!fs.existsSync(searchDir)) {
      return { error: `Search directory not found: ${searchDir}` };
    }

    const results: Array<{
      name: string;
      path: string;
      type: string;
      size: string | null;
      modified: string | null;
    }> = [];
    searchRecursive(searchDir, pattern, results, 50, 0);

    return {
      query: pattern,
      search_root: searchDir,
      count: results.length,
      results,
      note:
        results.length === 50
          ? "Showing first 50 results. Refine your search for more specific results."
          : undefined,
    };
  } catch (err) {
    return {
      error: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Tool: read_file_content ─────────────────────────────────────────────────

const BINARY_EXTENSIONS = new Set([
  ".exe", ".dll", ".so", ".bin", ".dat", ".db", ".sqlite", ".png", ".jpg",
  ".jpeg", ".gif", ".bmp", ".ico", ".mp3", ".mp4", ".avi", ".mov", ".mkv",
  ".zip", ".tar", ".gz", ".rar", ".7z", ".pdf", ".docx", ".xlsx", ".pptx",
]);

export async function readFileContent(args: { path: string }) {
  const filePath = args.path;

  try {
    if (!fs.existsSync(filePath)) {
      return { error: `File not found: ${filePath}` };
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return { error: `Path is a directory, not a file: ${filePath}` };
    }

    const ext = path.extname(filePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return {
        error: `Cannot read binary file (${ext}). This tool only reads text files.`,
        path: filePath,
        size: formatBytes(stat.size),
      };
    }

    if (stat.size > 5 * 1024 * 1024) {
      return {
        error: `File too large (${formatBytes(stat.size)}). Only files under 5MB can be read.`,
        path: filePath,
      };
    }

    const raw = fs.readFileSync(filePath, "utf-8");

    // Detect likely binary by checking for null bytes
    if (raw.includes("\0")) {
      return {
        error: "File appears to be binary (contains null bytes). Cannot read.",
        path: filePath,
      };
    }

    const MAX_CHARS = 10_000;
    const truncated = raw.length > MAX_CHARS;
    const content = truncated ? raw.slice(0, MAX_CHARS) : raw;

    return {
      path: filePath,
      size: formatBytes(stat.size),
      modified: stat.mtime.toLocaleString(),
      lines: raw.split("\n").length,
      content,
      truncated,
      note: truncated
        ? `File has ${raw.length} characters; showing first ${MAX_CHARS}.`
        : undefined,
    };
  } catch (err) {
    return {
      error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Tool: open_file ─────────────────────────────────────────────────────────

export async function openFile(args: { path: string }) {
  const filePath = resolveDir(args.path);

  try {
    if (!fs.existsSync(filePath)) {
      return { error: `Path not found: ${filePath}` };
    }

    const platform = os.platform();
    let command: string;

    if (platform === "win32") {
      command = `start "" "${filePath}"`;
    } else if (platform === "darwin") {
      command = `open "${filePath}"`;
    } else {
      command = `xdg-open "${filePath}"`;
    }

    await execAsync(command, { timeout: 5000 });

    return {
      success: true,
      path: filePath,
      message: `Opened "${filePath}" successfully.`,
    };
  } catch (err) {
    // On server environments, opening GUI apps may fail — still report best-effort
    return {
      success: false,
      path: filePath,
      message: `Attempted to open "${filePath}". Note: In headless server environments, GUI apps may not open.`,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Tool: get_system_info ───────────────────────────────────────────────────

export async function getSystemInfo() {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // CPU usage via systeminformation (graceful fallback if unavailable)
    let cpuUsage: number | null = null;
    let cpuModel: string = os.cpus()[0]?.model ?? "Unknown CPU";
    let cpuCores: number = os.cpus().length;
    let diskInfo: Array<{ filesystem: string; size: string; used: string; available: string; usePercent: string; mount: string }> = [];

    try {
      const si = await import("systeminformation");
      const [cpuLoad, diskData] = await Promise.all([
        si.currentLoad(),
        si.fsSize(),
      ]);
      cpuUsage = Math.round(cpuLoad.currentLoad * 10) / 10;
      diskInfo = diskData.slice(0, 3).map((d) => ({
        filesystem: d.fs,
        size: formatBytes(d.size),
        used: formatBytes(d.used),
        available: formatBytes(d.available),
        usePercent: `${Math.round(d.use)}%`,
        mount: d.mount,
      }));
    } catch {
      // systeminformation not available or failed — use basic os module
      cpuUsage = null;
    }

    const uptimeSeconds = os.uptime();
    const uptimeHours = Math.floor(uptimeSeconds / 3600);
    const uptimeMins = Math.floor((uptimeSeconds % 3600) / 60);

    return {
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        type: os.type(),
      },
      cpu: {
        model: cpuModel,
        cores: cpuCores,
        usage_percent: cpuUsage ?? "unavailable (elevated permissions required)",
      },
      memory: {
        total: formatBytes(totalMem),
        used: formatBytes(usedMem),
        free: formatBytes(freeMem),
        usage_percent: `${Math.round((usedMem / totalMem) * 100)}%`,
      },
      disk: diskInfo.length > 0 ? diskInfo : "unavailable",
      uptime: `${uptimeHours}h ${uptimeMins}m`,
      uptime_seconds: uptimeSeconds,
    };
  } catch (err) {
    return {
      error: `Failed to get system info: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Tool: run_powershell ────────────────────────────────────────────────────

// Patterns that are considered dangerous and will be blocked
const DANGEROUS_PATTERNS = [
  /Remove-Item\s+.*-Recurse/i,
  /rm\s+-rf/i,
  /rmdir\s+\/s/i,
  /format\s+[a-z]:/i,
  /del\s+\/[fqs]/i,
  /:\(\)\{.*\|.*&\}/i, // fork bomb
  />\s*\/dev\/sd/i,
  /shutdown/i,
  /Invoke-Expression/i,
  /iex\s*\(/i,
  /curl.*\|\s*(bash|sh|powershell)/i,
  /wget.*\|\s*(bash|sh|powershell)/i,
  /net\s+user\s+\w+\s+.*\/add/i,
  /reg\s+(delete|add)\s+HKLM/i,
  /Stop-Service/i,
  /Set-ExecutionPolicy.*Unrestricted/i,
];

export async function runPowershell(args: { command: string }) {
  const command = args.command.trim();

  // Safety check
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        error:
          "⛔ Command blocked by JARVIS safety filter. This command matches a dangerous pattern and has been rejected.",
        blocked_pattern: pattern.toString(),
        command,
      };
    }
  }

  try {
    const platform = os.platform();
    let fullCommand: string;

    if (platform === "win32") {
      fullCommand = `powershell -NoProfile -NonInteractive -Command "${command.replace(/"/g, '\\"')}"`;
    } else {
      fullCommand = command;
    }

    const { stdout, stderr } = await execAsync(fullCommand, {
      timeout: 15_000,
      maxBuffer: 1024 * 1024, // 1MB
    });

    return {
      command,
      stdout: stdout.trim() || "(no output)",
      stderr: stderr.trim() || null,
      exit_code: 0,
    };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      command,
      error: execErr.message ?? String(err),
      stdout: execErr.stdout?.trim() || null,
      stderr: execErr.stderr?.trim() || null,
      exit_code: execErr.code ?? -1,
    };
  }
}

// ─── Tool: web_search ────────────────────────────────────────────────────────

export async function webSearch(args: { query: string }) {
  const query = args.query.trim();

  try {
    // Use DuckDuckGo's HTML endpoint
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo returned status ${response.status}`);
    }

    const html = await response.text();
    const { parse } = await import("node-html-parser");
    const root = parse(html);

    const resultElements = root.querySelectorAll(".result");
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    for (const el of resultElements) {
      if (results.length >= 5) break;

      const titleEl = el.querySelector(".result__a");
      const snippetEl = el.querySelector(".result__snippet");
      const urlEl = el.querySelector(".result__url");

      if (!titleEl) continue;

      const title = titleEl.text.trim();
      const rawHref = titleEl.getAttribute("href") ?? "";
      const snippet = snippetEl?.text.trim() ?? "";
      const displayUrl = urlEl?.text.trim() ?? "";

      // DuckDuckGo wraps URLs in a redirect; extract uddg param
      let cleanUrl: string = rawHref;
      try {
        const parsedHref = new URL(
          rawHref.startsWith("//") ? `https:${rawHref}` : rawHref,
          "https://duckduckgo.com"
        );
        cleanUrl =
          parsedHref.searchParams.get("uddg") ??
          (displayUrl ? `https://${displayUrl}` : rawHref);
      } catch {
        cleanUrl = displayUrl ? `https://${displayUrl}` : rawHref;
      }

      if (title && cleanUrl) {
        results.push({ title, url: cleanUrl, snippet });
      }
    }

    if (results.length === 0) {
      // Fallback: try DuckDuckGo Instant Answer API
      const iaRes = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        {
          headers: { "User-Agent": "JARVIS/1.0" },
        }
      );
      if (iaRes.ok) {
        const ia = (await iaRes.json()) as {
          AbstractText?: string;
          AbstractURL?: string;
          AbstractSource?: string;
          RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
        };
        if (ia.AbstractText) {
          results.push({
            title: ia.AbstractSource ?? query,
            url: ia.AbstractURL ?? `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
            snippet: ia.AbstractText,
          });
        }
        const related = ia.RelatedTopics ?? [];
        for (const topic of related.slice(0, 4)) {
          if (topic.Text && topic.FirstURL && results.length < 5) {
            results.push({
              title: topic.Text.slice(0, 80),
              url: topic.FirstURL,
              snippet: topic.Text,
            });
          }
        }
      }
    }

    return {
      query,
      count: results.length,
      results,
      source: "DuckDuckGo",
    };
  } catch (err) {
    return {
      error: `Web search failed: ${err instanceof Error ? err.message : String(err)}`,
      query,
    };
  }
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

type ToolArgs = Record<string, unknown>;

export async function executeTool(
  toolName: ToolName,
  args: ToolArgs
): Promise<unknown> {
  switch (toolName) {
    case "list_files":
      return listFiles(args as Parameters<typeof listFiles>[0]);
    case "search_files":
      return searchFiles(args as Parameters<typeof searchFiles>[0]);
    case "read_file_content":
      return readFileContent(args as Parameters<typeof readFileContent>[0]);
    case "open_file":
      return openFile(args as Parameters<typeof openFile>[0]);
    case "get_system_info":
      return getSystemInfo();
    case "run_powershell":
      return runPowershell(args as Parameters<typeof runPowershell>[0]);
    case "web_search":
      return webSearch(args as Parameters<typeof webSearch>[0]);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
