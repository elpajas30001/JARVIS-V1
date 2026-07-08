# JARVIS Tool-Calling System — Developer Reference

## Overview

JARVIS uses **Groq's function calling API** (OpenAI-compatible) with the model `llama-3.3-70b-versatile`. When a user sends a message, JARVIS determines whether to use a tool or respond directly. If a tool is chosen, the API route executes it server-side in Node.js, then sends the result back to Groq for a natural language response.

### Architecture Flow

```
User Message
     ↓
POST /api/chat
     ↓
Groq (llama-3.3-70b-versatile) + Tool Definitions
     ↓
  finish_reason == "tool_calls"?
   YES ──→ server executes tool (Node.js) ──→ result appended to messages ──→ Groq again (loop up to 5x)
   NO  ──→ return final content to client
```

---

## Tools

### 1. `list_files(directory)`

**What it does:** Lists all files and folders in a directory using `fs.readdirSync`.

**Supported shortcuts:**
| Shortcut     | Resolves to              |
|--------------|--------------------------|
| `home`       | `os.homedir()`           |
| `downloads`  | `~/Downloads`            |
| `desktop`    | `~/Desktop`              |
| `documents`  | `~/Documents`            |
| `pictures`   | `~/Pictures`             |

Or pass a full absolute path like `/var/log`.

**Returns:** `{ directory, count, items[] }` where each item has `{ name, type, size, modified, path }`.

**Security:** Read-only. No restrictions on which directories can be listed.

---

### 2. `search_files(query, directory?)`

**What it does:** Recursively walks a directory tree matching filenames against a pattern. Supports wildcards:
- `*.pdf` — find all PDF files
- `resume*` — files starting with "resume"
- `*.{ts,tsx}` — (note: brace expansion not supported, use separate searches)

**Defaults:** Searches `os.homedir()` if no directory specified.

**Returns:** Up to 50 matching results with `{ name, path, type, size, modified }`.

**Performance notes:**
- Max depth: 6 directory levels
- Max results: 50
- Skips hidden directories (`.git`, `.next`, etc.)
- Skips `node_modules`, `AppData`, `$Recycle.Bin`

---

### 3. `read_file_content(path)`

**What it does:** Reads a text file and returns its contents.

**Limits:**
- Max 10,000 characters (file is truncated with a note)
- Max file size: 5 MB
- Rejects known binary extensions: `.exe`, `.dll`, `.png`, `.jpg`, `.zip`, `.pdf`, `.docx`, etc.
- Detects binary by checking for null bytes in content

**Returns:** `{ path, size, modified, lines, content, truncated }`

**Security:** Read-only. Cannot write files.

---

### 4. `open_file(path)`

**What it does:** Opens a file or folder using the OS default application.

| Platform | Command used          |
|----------|-----------------------|
| Windows  | `start "" "path"`     |
| macOS    | `open "path"`         |
| Linux    | `xdg-open "path"`     |

**Note:** In headless server environments (like cloud VMs), GUI applications cannot open. The tool reports success/failure honestly.

**Supports shortcuts:** Same as `list_files` (downloads, desktop, etc.)

---

### 5. `get_system_info()`

**What it does:** Returns real-time system diagnostics using:
- `os` module: total/free RAM, platform, hostname, uptime, CPU model
- `systeminformation` npm package: CPU usage %, disk usage per filesystem

**Returns:**
```json
{
  "os": { "platform", "release", "arch", "hostname", "type" },
  "cpu": { "model", "cores", "usage_percent" },
  "memory": { "total", "used", "free", "usage_percent" },
  "disk": [{ "filesystem", "size", "used", "available", "usePercent", "mount" }],
  "uptime": "Xh Ym"
}
```

**Fallback:** If `systeminformation` fails (e.g., insufficient permissions for CPU sampling), the tool still returns OS/memory data from the `os` module.

---

### 6. `run_powershell(command)`

**What it does:** Executes a shell command and returns stdout/stderr.

| Platform | Shell used   |
|----------|--------------|
| Windows  | PowerShell   |
| Linux/macOS | bash (direct) |

**⚠️ Security — Two-layer protection:**

#### Layer 1: Safety Filter (server-side, always on)
The following command patterns are **always blocked**, regardless of user approval:

| Pattern | Reason |
|---------|--------|
| `Remove-Item -Recurse` | Mass deletion |
| `rm -rf` | Mass deletion |
| `rmdir /s` | Mass deletion (Windows) |
| `format X:` | Disk format |
| `Invoke-Expression`, `iex(` | Code injection |
| `curl \| bash` / `wget \| bash` | Remote code execution |
| `net user /add` | User escalation |
| `reg delete HKLM` | Registry manipulation |
| `Stop-Service` | Service disruption |
| `Set-ExecutionPolicy Unrestricted` | Policy bypass |
| Fork bomb pattern | DoS prevention |

#### Layer 2: UI Confirmation (client-side)
When JARVIS decides to call `run_powershell`, **the API pauses** and returns a `requiresConfirmation: true` response. The UI displays the exact command and asks for explicit user approval before executing. The user can **Approve** or **Cancel**.

**Limits:**
- Timeout: 15 seconds
- Max output buffer: 1 MB

---

### 7. `web_search(query)`

**What it does:** Searches the web using DuckDuckGo's HTML endpoint and returns the top 5 results.

**Endpoint used:** `https://html.duckduckgo.com/html/?q=...`

**Parsing:** Uses `node-html-parser` to extract `.result__a` (title/URL) and `.result__snippet` (description) from DuckDuckGo's static HTML.

**Fallback:** If HTML parsing yields 0 results, falls back to DuckDuckGo's Instant Answer JSON API (`api.duckduckgo.com/?format=json`).

**Returns:**
```json
{
  "query": "your search",
  "count": 5,
  "source": "DuckDuckGo",
  "results": [
    { "title": "...", "url": "https://...", "snippet": "..." }
  ]
}
```

**Note:** DuckDuckGo does not require an API key. No rate limiting is enforced server-side (DuckDuckGo may throttle excessive requests).

---

## Adding New Tools

1. **Define the tool schema** in `src/lib/jarvis-tools.ts` — add to `JARVIS_TOOL_DEFINITIONS` array and `TOOL_LABELS`.

2. **Implement the executor** in `src/lib/tool-executor.ts` — add your function and a case in the `executeTool` dispatcher.

3. **Update the system prompt** in `src/lib/ai-providers.ts` if needed (tell JARVIS when to use the new tool).

4. **If it needs user confirmation**, add `toolName === "your_tool"` check in the confirmation block in `src/app/api/chat/route.ts`.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/chat` | Send a message; handles tool calling loop |
| `GET`  | `/api/chat` | List all conversations |
| `GET`  | `/api/chat?conversationId=xxx` | Get messages for a conversation |
| `DELETE` | `/api/chat` | Delete a conversation |
| `GET`  | `/api/providers` | Check which AI providers are configured |
| `GET`  | `/api/tools` | List available tool definitions |

### POST `/api/chat` request body
```typescript
{
  message: string;                // User's message
  conversationId?: string;        // Omit to start a new conversation
  provider?: "groq"|"openai"|"gemini";  // Default: "groq"
  
  // For confirmed tool execution (run_powershell):
  confirmToolExecution?: boolean;
  pendingToolCall?: {
    toolName: string;
    args: Record<string, unknown>;
    toolCallId: string;
    messagesSnapshot: ChatMessage[];
  };
}
```

---

## Configuration

Add to your `.env` file:

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
GROQ_API_KEY=gsk_...          # Required — from https://console.groq.com
OPENAI_API_KEY=sk-...         # Optional fallback
GEMINI_API_KEY=...            # Optional fallback
```

---

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Arbitrary file read | `read_file_content` is read-only; rejects binaries |
| Shell command injection | `run_powershell` requires UI approval + server-side blocklist |
| Path traversal | Tools use `path.join` consistently; no special handling needed for read-only ops |
| API key exposure | All keys are server-side only; never sent to the client |
| Infinite tool loops | Loop capped at 5 iterations in `POST /api/chat` |
| Large file reads | 5MB limit + 10,000 char truncation |
| Search result injection | Results are plain text; rendered via `dangerouslySetInnerHTML` with HTML escaping for code blocks |

**Important:** This system is designed for personal/local use where the operator trusts themselves. For multi-user deployments, add authentication before exposing file system tools.
