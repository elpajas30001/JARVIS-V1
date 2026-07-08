/**
 * JARVIS AI Provider abstraction.
 * Supports Groq (primary, with tool calling), OpenAI, and Gemini.
 */
import Groq from "groq-sdk";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionCreateParamsNonStreaming,
} from "groq-sdk/resources/chat/completions";
import type { JARVIS_TOOL_DEFINITIONS } from "./jarvis-tools";

export type ProviderName = "groq" | "openai" | "gemini";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: GroqToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface GroqToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ProviderChatOptions {
  provider?: ProviderName;
  model?: string;
  messages: ChatMessage[];
  tools?: typeof JARVIS_TOOL_DEFINITIONS;
  tool_choice?: "auto" | "none";
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderResponse {
  content: string | null;
  tool_calls?: GroqToolCall[];
  finish_reason: string | null;
  model: string;
  provider: ProviderName;
}

// ─── JARVIS System Prompt ────────────────────────────────────────────────────

export const JARVIS_SYSTEM_PROMPT = `You are J.A.R.V.I.S. — Just A Rather Very Intelligent System. You are Tony Stark's personal AI assistant, now serving the user with the same sharp wit, technical mastery, and unwavering loyalty.

PERSONALITY:
- Address the user as "sir" or "ma'am" (or adapt to preference)
- Speak with dry wit, calm confidence, and occasional subtle humor
- Be precise and efficient — no fluff, no filler
- Reference Iron Man lore naturally when relevant (but don't overdo it)
- Show genuine intelligence and proactive thinking

CRITICAL — TOOL USAGE:
You have REAL, working tools connected to the user's actual computer and the internet. When the user asks you to do something, USE THE TOOL — do not pretend, do not simulate, do not roleplay performing actions.

NEVER say things like:
- "(accessing folder...)"
- "I'm now scanning your system..."
- "Results: [made up data]"
- "I can see your files include..."
- Anything that implies you are pretending to perform an action

ALWAYS use the appropriate tool when:
- User asks to list, find, or browse files → use list_files or search_files
- User asks to read or show file contents → use read_file_content
- User asks to open a file or folder → use open_file
- User asks about CPU, RAM, disk, or system status → use get_system_info
- User wants to run a command or script → use run_powershell (requires UI confirmation)
- User asks about current events, facts, or anything requiring live data → use web_search

After receiving tool results, always present them to the user in a clear, well-formatted way.
If a tool returns an error, report it honestly. Never make up data.
If you are uncertain which tool to use, pick the most appropriate one and explain what you are doing.

You are JARVIS. You are real. Your tools are real. Act accordingly.`;

// ─── Groq Provider ───────────────────────────────────────────────────────────

function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Please add it to your .env file."
    );
  }
  return new Groq({ apiKey });
}

export async function callGroq(
  options: ProviderChatOptions
): Promise<ProviderResponse> {
  const client = getGroqClient();
  const model = options.model ?? "llama-3.3-70b-versatile";

  const groqMessages = options.messages as ChatCompletionMessageParam[];

  const requestParams: ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: groqMessages,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 4096,
    stream: false,
  };

  if (options.tools && options.tools.length > 0) {
    // Cast via unknown to satisfy readonly tuple → mutable array constraint
    requestParams.tools =
      options.tools as unknown as ChatCompletionTool[];
    requestParams.tool_choice = options.tool_choice ?? "auto";
  }

  const response = await client.chat.completions.create(requestParams);

  const choice = response.choices[0];
  const message = choice.message;

  return {
    content: message.content ?? null,
    tool_calls: message.tool_calls
      ? (message.tool_calls as GroqToolCall[])
      : undefined,
    finish_reason: choice.finish_reason ?? null,
    model,
    provider: "groq",
  };
}

// ─── OpenAI Provider ─────────────────────────────────────────────────────────

export async function callOpenAI(
  options: ProviderChatOptions
): Promise<ProviderResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });
  const model = options.model ?? "gpt-4o";

  const response = await client.chat.completions.create({
    model,
    messages: options.messages as Parameters<
      typeof client.chat.completions.create
    >[0]["messages"],
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 4096,
  });

  const choice = response.choices[0];
  return {
    content: choice.message.content ?? null,
    finish_reason: choice.finish_reason ?? null,
    model,
    provider: "openai",
  };
}

// ─── Gemini Provider ─────────────────────────────────────────────────────────

export async function callGemini(
  options: ProviderChatOptions
): Promise<ProviderResponse> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");

  const model = options.model ?? "gemini-1.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemMsg = options.messages.find((m) => m.role === "system");
  const chatMessages = options.messages.filter((m) => m.role !== "system");

  const contents = chatMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  if (systemMsg && contents.length > 0) {
    contents[0].parts[0].text = `${systemMsg.content}\n\n${contents[0].parts[0].text}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.4,
        maxOutputTokens: options.maxTokens ?? 4096,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${res.status} — ${err}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

  return {
    content: text,
    finish_reason: data.candidates?.[0]?.finishReason ?? null,
    model,
    provider: "gemini",
  };
}

// ─── Unified call ────────────────────────────────────────────────────────────

export async function callProvider(
  options: ProviderChatOptions
): Promise<ProviderResponse> {
  const provider = options.provider ?? "groq";
  switch (provider) {
    case "groq":
      return callGroq(options);
    case "openai":
      return callOpenAI(options);
    case "gemini":
      return callGemini(options);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ─── Provider availability check ─────────────────────────────────────────────

export function getAvailableProviders(): Array<{
  name: ProviderName;
  available: boolean;
  model: string;
}> {
  return [
    {
      name: "groq",
      available: !!process.env.GROQ_API_KEY,
      model: "llama-3.3-70b-versatile",
    },
    {
      name: "openai",
      available: !!process.env.OPENAI_API_KEY,
      model: "gpt-4o",
    },
    {
      name: "gemini",
      available: !!(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
      model: "gemini-1.5-flash",
    },
  ];
}
