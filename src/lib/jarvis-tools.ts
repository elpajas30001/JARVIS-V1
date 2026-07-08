/**
 * JARVIS Tool Definitions — OpenAI/Groq-compatible function calling schemas.
 * These are sent to Groq so the model knows which tools exist and how to call them.
 */
export const JARVIS_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "list_files",
      description:
        "Lists all files and folders inside a directory. Accepts shortcuts: 'downloads', 'desktop', 'documents', 'pictures', 'home', or a full absolute path.",
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description:
              "The directory to list. Use shortcuts like 'downloads', 'desktop', 'documents', 'pictures', 'home', or provide a full path.",
          },
        },
        required: ["directory"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_files",
      description:
        "Recursively searches for files and folders matching a name pattern (supports wildcards like *.pdf). Returns matching paths with size and modified date metadata.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The file name or pattern to search for. Supports wildcards, e.g. '*.pdf', 'resume*', 'photo.jpg'.",
          },
          directory: {
            type: "string",
            description:
              "Optional. Directory to search in. Defaults to the user's home directory. Accepts shortcuts: 'downloads', 'desktop', 'documents', 'pictures', 'home'.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file_content",
      description:
        "Reads and returns the text content of a file (up to 10,000 characters). Rejects binary files. Use this to inspect config files, logs, text documents, code, etc.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The absolute path to the file to read.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "open_file",
      description:
        "Opens a file or folder using the system's default application. On Windows this uses 'start', on macOS 'open', on Linux 'xdg-open'.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "The absolute path to the file or folder to open. Accepts shortcuts: 'downloads', 'desktop', 'documents', 'pictures', 'home'.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_system_info",
      description:
        "Returns real-time system information: CPU model and usage percentage, total/free/used RAM, disk usage, OS info, hostname, and system uptime.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_powershell",
      description:
        "Executes a PowerShell (Windows) or bash (Linux/macOS) shell command and returns its stdout/stderr output. IMPORTANT: This requires explicit user confirmation before execution. Use only for safe, read-only or constructive commands. Never use for destructive operations.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              "The shell command to execute. Must be safe and non-destructive.",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Performs a real web search using DuckDuckGo and returns the top 5 results with title, URL, and snippet. Use this for current events, facts, or anything requiring up-to-date information.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to look up on the web.",
          },
        },
        required: ["query"],
      },
    },
  },
] as const;

export type ToolName =
  | "list_files"
  | "search_files"
  | "read_file_content"
  | "open_file"
  | "get_system_info"
  | "run_powershell"
  | "web_search";

export const TOOL_LABELS: Record<ToolName, string> = {
  list_files: "📁 Listing files",
  search_files: "🔍 Searching files",
  read_file_content: "📄 Reading file",
  open_file: "🚀 Opening file",
  get_system_info: "💻 Fetching system info",
  run_powershell: "⚡ Running shell command",
  web_search: "🌐 Searching the web",
};
