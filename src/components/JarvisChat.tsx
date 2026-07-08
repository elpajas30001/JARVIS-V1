"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import Image from "next/image";
import { TOOL_LABELS, type ToolName } from "@/lib/jarvis-tools";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToolUsage {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

interface UIMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolsUsed?: ToolUsage[];
  requiresConfirmation?: boolean;
  pendingToolCall?: PendingToolCall;
  isLoading?: boolean;
  timestamp: Date;
}

interface PendingToolCall {
  toolName: string;
  args: Record<string, unknown>;
  toolCallId: string;
  messagesSnapshot: unknown[];
  description: string;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── Markdown-lite renderer (no external deps) ────────────────────────────────

function renderMarkdown(text: string): string {
  return text
    // Code blocks
    .replace(/```[\s\S]*?```/g, (match) => {
      const code = match.replace(/^```\w*\n?/, "").replace(/```$/, "");
      return `<pre class="jarvis-code-block"><code>${escapeHtml(code)}</code></pre>`;
    })
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="jarvis-inline-code">$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="jarvis-h3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="jarvis-h2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="jarvis-h1">$1</h1>')
    // Unordered list items
    .replace(/^[-•] (.+)$/gm, '<li class="jarvis-li">$1</li>')
    .replace(/(<li class="jarvis-li">.*<\/li>\n?)+/g, (match) => `<ul class="jarvis-ul">${match}</ul>`)
    // Numbered list items
    .replace(/^\d+\. (.+)$/gm, '<li class="jarvis-oli">$1</li>')
    .replace(/(<li class="jarvis-oli">.*<\/li>\n?)+/g, (match) => `<ol class="jarvis-ol">${match}</ol>`)
    // Horizontal rules
    .replace(/^---$/gm, "<hr />")
    // Paragraphs — wrap double newlines
    .replace(/\n\n/g, "</p><p>")
    // Single line breaks
    .replace(/\n/g, "<br />");
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolBadge({ tool }: { tool: ToolUsage }) {
  const [expanded, setExpanded] = useState(false);
  const label = TOOL_LABELS[tool.name as ToolName] ?? `🔧 ${tool.name}`;

  return (
    <div className="jarvis-tool-badge">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="jarvis-tool-badge-btn"
        title="Click to see tool details"
      >
        <span className="jarvis-tool-badge-label">{label}</span>
        <span className="jarvis-tool-badge-chevron">
          {expanded ? "▲" : "▼"}
        </span>
      </button>
      {expanded && (
        <div className="jarvis-tool-details">
          <div className="jarvis-tool-detail-section">
            <span className="jarvis-tool-detail-title">Arguments:</span>
            <pre className="jarvis-tool-detail-pre">
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          </div>
          {tool.result !== undefined && (
            <div className="jarvis-tool-detail-section">
              <span className="jarvis-tool-detail-title">Result:</span>
              <pre className="jarvis-tool-detail-pre">
                {typeof tool.result === "string"
                  ? tool.result
                  : JSON.stringify(tool.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  msg,
  onConfirm,
  onDeny,
}: {
  msg: UIMessage;
  onConfirm?: (pending: PendingToolCall) => void;
  onDeny?: () => void;
}) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";

  if (isSystem) {
    return (
      <div className="jarvis-system-msg">
        <span>{msg.content}</span>
      </div>
    );
  }

  return (
    <div className={`jarvis-bubble-row ${isUser ? "jarvis-bubble-user-row" : "jarvis-bubble-ai-row"}`}>
      {!isUser && (
        <div className="jarvis-avatar-wrap">
          <Image
            src="/jarvis-avatar.png"
            alt="JARVIS"
            width={32}
            height={32}
            className="jarvis-avatar-img"
          />
        </div>
      )}
      <div className={`jarvis-bubble ${isUser ? "jarvis-bubble-user" : "jarvis-bubble-ai"}`}>
        {/* Tool usage badges */}
        {msg.toolsUsed && msg.toolsUsed.length > 0 && (
          <div className="jarvis-tools-used">
            {msg.toolsUsed.map((t, i) => (
              <ToolBadge key={i} tool={t} />
            ))}
          </div>
        )}

        {/* Loading animation */}
        {msg.isLoading ? (
          <div className="jarvis-typing">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <div
            className="jarvis-bubble-content"
            dangerouslySetInnerHTML={{ __html: `<p>${renderMarkdown(msg.content)}</p>` }}
          />
        )}

        {/* Confirmation prompt for run_powershell */}
        {msg.requiresConfirmation && msg.pendingToolCall && (
          <div className="jarvis-confirm-box">
            <div className="jarvis-confirm-icon">⚡</div>
            <div className="jarvis-confirm-text">
              <p className="jarvis-confirm-title">Shell Command — Confirmation Required</p>
              <code className="jarvis-confirm-cmd">
                {String(msg.pendingToolCall.args.command ?? "")}
              </code>
              <p className="jarvis-confirm-warning">
                This command will execute on your system. Approve only if you trust it.
              </p>
            </div>
            <div className="jarvis-confirm-actions">
              <button
                className="jarvis-confirm-btn-approve"
                onClick={() => onConfirm?.(msg.pendingToolCall!)}
              >
                ✅ Approve &amp; Execute
              </button>
              <button
                className="jarvis-confirm-btn-deny"
                onClick={() => onDeny?.()}
              >
                ❌ Cancel
              </button>
            </div>
          </div>
        )}

        <div className="jarvis-bubble-meta">
          {!isUser && <span className="jarvis-ai-label">J.A.R.V.I.S.</span>}
          <span className="jarvis-timestamp">{formatTime(msg.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

function SidebarConversation({
  convo,
  active,
  onClick,
  onDelete,
}: {
  convo: Conversation;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`jarvis-convo-item ${active ? "jarvis-convo-active" : ""}`}
      onClick={onClick}
    >
      <span className="jarvis-convo-title">{convo.title}</span>
      <button
        className="jarvis-convo-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete conversation"
      >
        ✕
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function JarvisChat() {
  const [messages, setMessages] = useState<UIMessage[]>([
    {
      id: uid(),
      role: "assistant",
      content:
        "Good day, sir. I am J.A.R.V.I.S. — your personal AI interface. I have real tools available: file system access, web search, system monitoring, and shell execution. How may I assist you today?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [groqAvailable, setGroqAvailable] = useState<boolean | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load conversations + check providers
  useEffect(() => {
    void loadConversations();
    void checkProviders();
  }, []);

  const checkProviders = async () => {
    try {
      const res = await fetch("/api/providers");
      const data = (await res.json()) as {
        providers: Array<{ name: string; available: boolean }>;
      };
      const groq = data.providers?.find((p) => p.name === "groq");
      setGroqAvailable(groq?.available ?? false);
    } catch {
      setGroqAvailable(false);
    }
  };

  const loadConversations = async () => {
    try {
      const res = await fetch("/api/chat");
      const data = (await res.json()) as { conversations: Conversation[] };
      setConversations(data.conversations ?? []);
    } catch {
      // ignore
    }
  };

  const loadConversation = async (id: string) => {
    try {
      const res = await fetch(`/api/chat?conversationId=${id}`);
      const data = (await res.json()) as {
        messages: Array<{
          id: string;
          role: string;
          content: string;
          toolCalls?: ToolUsage[];
          createdAt: string;
        }>;
      };
      setConversationId(id);
      setMessages(
        data.messages
          .filter((m) => m.role !== "tool")
          .map((m) => ({
            id: m.id,
            role: m.role as UIMessage["role"],
            content: m.content,
            toolsUsed: m.toolCalls ?? undefined,
            timestamp: new Date(m.createdAt),
          }))
      );
      setSidebarOpen(false);
    } catch {
      // ignore
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      await fetch("/api/chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id }),
      });
      if (conversationId === id) {
        startNewChat();
      }
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // ignore
    }
  };

  const startNewChat = () => {
    setConversationId(null);
    setMessages([
      {
        id: uid(),
        role: "assistant",
        content:
          "Good day, sir. I am J.A.R.V.I.S. — your personal AI interface. I have real tools available: file system access, web search, system monitoring, and shell execution. How may I assist you today?",
        timestamp: new Date(),
      },
    ]);
    setSidebarOpen(false);
  };

  const appendMessage = useCallback((msg: UIMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateLastMessage = useCallback(
    (updater: (msg: UIMessage) => UIMessage) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last) next[next.length - 1] = updater(last);
        return next;
      });
    },
    []
  );

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    setInput("");
    setIsLoading(true);

    // Add user message
    appendMessage({
      id: uid(),
      role: "user",
      content: text,
      timestamp: new Date(),
    });

    // Add loading placeholder
    const loadingId = uid();
    appendMessage({
      id: loadingId,
      role: "assistant",
      content: "",
      isLoading: true,
      timestamp: new Date(),
    });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId,
          provider: "groq",
        }),
      });

      const data = (await res.json()) as {
        success: boolean;
        reply?: string;
        conversationId?: string;
        toolsUsed?: ToolUsage[];
        requiresConfirmation?: boolean;
        pendingToolCall?: PendingToolCall;
        error?: string;
      };

      if (!res.ok || !data.success) {
        updateLastMessage((m) => ({
          ...m,
          isLoading: false,
          content:
            data.error ??
            "I apologize — something went wrong. Please try again.",
        }));
        return;
      }

      if (data.conversationId) {
        setConversationId(data.conversationId);
        void loadConversations();
      }

      if (data.requiresConfirmation && data.pendingToolCall) {
        // Show confirmation UI
        updateLastMessage((m) => ({
          ...m,
          isLoading: false,
          content: `I need your authorization to execute a shell command:`,
          requiresConfirmation: true,
          pendingToolCall: data.pendingToolCall,
          toolsUsed: data.toolsUsed,
        }));
      } else {
        updateLastMessage((m) => ({
          ...m,
          isLoading: false,
          content: data.reply ?? "No response.",
          toolsUsed: data.toolsUsed,
          requiresConfirmation: false,
          pendingToolCall: undefined,
        }));
      }
    } catch (err) {
      updateLastMessage((m) => ({
        ...m,
        isLoading: false,
        content: `Connection error: ${err instanceof Error ? err.message : "Unknown error"}. Please check your API keys and try again.`,
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmTool = async (pending: PendingToolCall) => {
    setIsLoading(true);

    // Replace confirmation message with loading
    updateLastMessage((m) => ({
      ...m,
      isLoading: true,
      requiresConfirmation: false,
      content: "",
      pendingToolCall: undefined,
    }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "",
          conversationId,
          provider: "groq",
          confirmToolExecution: true,
          pendingToolCall: pending,
        }),
      });

      const data = (await res.json()) as {
        success: boolean;
        reply?: string;
        toolsUsed?: ToolUsage[];
        error?: string;
      };

      updateLastMessage((m) => ({
        ...m,
        isLoading: false,
        content:
          data.reply ??
          (data.error ? `Error: ${data.error}` : "Command executed."),
        toolsUsed: data.toolsUsed,
      }));
    } catch (err) {
      updateLastMessage((m) => ({
        ...m,
        isLoading: false,
        content: `Failed to execute command: ${err instanceof Error ? err.message : "Unknown error"}`,
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDenyTool = () => {
    updateLastMessage((m) => ({
      ...m,
      isLoading: false,
      requiresConfirmation: false,
      pendingToolCall: undefined,
      content:
        "Understood, sir. Command execution cancelled. Is there anything else I can do for you?",
    }));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const quickPrompts = [
    "List my Downloads folder",
    "What's my CPU and RAM usage?",
    "Search for PDF files on my system",
    "Search the web for latest AI news",
    "Show system info",
  ];

  return (
    <div className="jarvis-root">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <div className={`jarvis-sidebar ${sidebarOpen ? "jarvis-sidebar-open" : ""}`}>
        <div className="jarvis-sidebar-header">
          <span className="jarvis-sidebar-title">JARVIS</span>
          <span className="jarvis-sidebar-subtitle">Conversation Archive</span>
        </div>
        <button className="jarvis-new-chat-btn" onClick={startNewChat}>
          + New Session
        </button>
        <div className="jarvis-convo-list">
          {conversations.length === 0 && (
            <p className="jarvis-convo-empty">No conversations yet</p>
          )}
          {conversations.map((c) => (
            <SidebarConversation
              key={c.id}
              convo={c}
              active={c.id === conversationId}
              onClick={() => loadConversation(c.id)}
              onDelete={() => deleteConversation(c.id)}
            />
          ))}
        </div>
        <div className="jarvis-sidebar-footer">
          <div className="jarvis-provider-status">
            <span
              className={`jarvis-status-dot ${
                groqAvailable === true
                  ? "jarvis-status-green"
                  : groqAvailable === false
                  ? "jarvis-status-red"
                  : "jarvis-status-yellow"
              }`}
            />
            <span>
              {groqAvailable === true
                ? "Groq Online"
                : groqAvailable === false
                ? "Groq API Key Missing"
                : "Checking…"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Overlay ─────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="jarvis-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Main ─────────────────────────────────────────────── */}
      <div className="jarvis-main">
        {/* Header */}
        <header className="jarvis-header">
          <button
            className="jarvis-menu-btn"
            onClick={() => setSidebarOpen((s) => !s)}
            aria-label="Toggle sidebar"
          >
            ☰
          </button>
          <div className="jarvis-header-brand">
            <Image
              src="/jarvis-avatar.png"
              alt="JARVIS"
              width={36}
              height={36}
              className="jarvis-header-avatar"
            />
            <div>
              <h1 className="jarvis-header-title">J.A.R.V.I.S.</h1>
              <p className="jarvis-header-subtitle">
                Just A Rather Very Intelligent System
              </p>
            </div>
          </div>
          <div className="jarvis-header-right">
            <div className="jarvis-hud-dot" />
            <span className="jarvis-hud-label">ONLINE</span>
          </div>
        </header>

        {/* Messages */}
        <main className="jarvis-messages">
          {/* Quick prompts — show only at beginning */}
          {messages.length <= 1 && (
            <div className="jarvis-quick-prompts">
              <p className="jarvis-quick-label">
                Try asking JARVIS to:
              </p>
              <div className="jarvis-quick-grid">
                {quickPrompts.map((p) => (
                  <button
                    key={p}
                    className="jarvis-quick-btn"
                    onClick={() => void sendMessage(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onConfirm={handleConfirmTool}
              onDeny={handleDenyTool}
            />
          ))}
          <div ref={bottomRef} />
        </main>

        {/* Input */}
        <footer className="jarvis-footer">
          <div className="jarvis-input-wrap">
            <textarea
              ref={inputRef}
              className="jarvis-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Speak to JARVIS… (Shift+Enter for new line)"
              rows={1}
              disabled={isLoading}
            />
            <button
              className={`jarvis-send-btn ${isLoading ? "jarvis-send-loading" : ""}`}
              onClick={() => void sendMessage(input)}
              disabled={isLoading || !input.trim()}
              aria-label="Send message"
            >
              {isLoading ? (
                <span className="jarvis-send-spinner" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              )}
            </button>
          </div>
          <p className="jarvis-footer-note">
            🔧 7 real tools active · Groq llama-3.3-70b-versatile ·{" "}
            <span className="jarvis-footer-warn">
              Shell commands require explicit approval
            </span>
          </p>
        </footer>
      </div>
    </div>
  );
}
