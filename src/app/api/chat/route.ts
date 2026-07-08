/**
 * JARVIS Chat API Route
 * Handles multi-turn tool-calling loop with Groq function calling.
 * Tools run server-side using Node.js fs, os, child_process.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import {
  callGroq,
  callProvider,
  JARVIS_SYSTEM_PROMPT,
  type ChatMessage,
  type ProviderName,
} from "@/lib/ai-providers";
import { JARVIS_TOOL_DEFINITIONS, type ToolName } from "@/lib/jarvis-tools";
import { executeTool } from "@/lib/tool-executor";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60s for tool calls

// ─── POST /api/chat ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      message: string;
      conversationId?: string;
      provider?: ProviderName;
      // For tool confirmation flow
      confirmToolExecution?: boolean;
      pendingToolCall?: {
        toolName: string;
        args: Record<string, unknown>;
        toolCallId: string;
        messagesSnapshot: ChatMessage[];
      };
    };

    const { message, provider = "groq", confirmToolExecution, pendingToolCall } =
      body;

    // ── Handle confirmed tool execution (run_powershell) ───────────────────
    if (confirmToolExecution && pendingToolCall) {
      const toolResult = await executeTool(
        pendingToolCall.toolName as ToolName,
        pendingToolCall.args
      );

      const messagesForGroq: ChatMessage[] = [
        ...pendingToolCall.messagesSnapshot,
        {
          role: "tool",
          content: JSON.stringify(toolResult),
          tool_call_id: pendingToolCall.toolCallId,
          name: pendingToolCall.toolName,
        },
      ];

      const finalResponse = await callGroq({
        messages: messagesForGroq,
        tools: JARVIS_TOOL_DEFINITIONS,
        tool_choice: "auto",
      });

      return NextResponse.json({
        success: true,
        reply: finalResponse.content ?? "Tool executed. No further response.",
        toolsUsed: [
          {
            name: pendingToolCall.toolName,
            args: pendingToolCall.args,
            result: toolResult,
          },
        ],
        finish_reason: finalResponse.finish_reason,
      });
    }

    // ── Get or create conversation ─────────────────────────────────────────
    let conversationId = body.conversationId;

    if (!conversationId) {
      const [newConvo] = await db
        .insert(conversations)
        .values({
          title:
            message.slice(0, 60) + (message.length > 60 ? "…" : ""),
        })
        .returning();
      conversationId = newConvo.id;
    }

    // ── Load conversation history ─────────────────────────────────────────
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.order));

    // ── Save user message ─────────────────────────────────────────────────
    const userMsgOrder = history.length;
    await db.insert(messages).values({
      conversationId,
      role: "user",
      content: message,
      order: userMsgOrder,
    });

    // ── Build messages array for the LLM ──────────────────────────────────
    const systemMessage: ChatMessage = {
      role: "system",
      content: JARVIS_SYSTEM_PROMPT,
    };

    const historyMessages: ChatMessage[] = history.map((m) => {
      const msg: ChatMessage = {
        role: m.role as ChatMessage["role"],
        content: m.content,
      };
      if (m.toolCalls) msg.tool_calls = m.toolCalls as ChatMessage["tool_calls"];
      if (m.toolCallId) msg.tool_call_id = m.toolCallId;
      if (m.toolName) msg.name = m.toolName;
      return msg;
    });

    const currentMessages: ChatMessage[] = [
      systemMessage,
      ...historyMessages,
      { role: "user", content: message },
    ];

    // ── Tool-calling loop (max 5 iterations to prevent infinite loops) ─────
    const MAX_TOOL_ROUNDS = 5;
    let round = 0;
    let currentMsgs = [...currentMessages];
    const toolsUsed: Array<{
      name: string;
      args: Record<string, unknown>;
      result: unknown;
    }> = [];
    let needsConfirmation: null | {
      toolName: string;
      args: Record<string, unknown>;
      toolCallId: string;
      messagesSnapshot: ChatMessage[];
      description: string;
    } = null;
    let finalContent: string | null = null;

    while (round < MAX_TOOL_ROUNDS) {
      // Use provider for non-groq; groq always gets tools
      let response;
      if (provider === "groq") {
        response = await callGroq({
          messages: currentMsgs,
          tools: JARVIS_TOOL_DEFINITIONS,
          tool_choice: "auto",
          temperature: 0.4,
        });
      } else {
        response = await callProvider({
          provider,
          messages: currentMsgs,
          temperature: 0.4,
        });
      }

      // No tool calls — we have our final answer
      if (
        !response.tool_calls ||
        response.tool_calls.length === 0 ||
        response.finish_reason === "stop"
      ) {
        finalContent = response.content;
        break;
      }

      // Add assistant message with tool_calls to the conversation
      currentMsgs.push({
        role: "assistant",
        content: response.content ?? "",
        tool_calls: response.tool_calls,
      });

      // Execute each tool call
      for (const toolCall of response.tool_calls) {
        const toolName = toolCall.function.name as ToolName;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments) as Record<
            string,
            unknown
          >;
        } catch {
          args = {};
        }

        // run_powershell requires confirmation — pause and ask UI
        if (toolName === "run_powershell") {
          needsConfirmation = {
            toolName,
            args,
            toolCallId: toolCall.id,
            messagesSnapshot: currentMsgs,
            description: `Execute shell command: \`${String(args.command ?? "")}\``,
          };
          // Return early, asking for confirmation
          break;
        }

        // Execute the tool server-side
        let toolResult: unknown;
        try {
          toolResult = await executeTool(toolName, args);
        } catch (err) {
          toolResult = {
            error: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        toolsUsed.push({ name: toolName, args, result: toolResult });

        // Append tool result to messages
        currentMsgs.push({
          role: "tool",
          content: JSON.stringify(toolResult),
          tool_call_id: toolCall.id,
          name: toolName,
        });
      }

      // If we need confirmation, stop the loop
      if (needsConfirmation) break;

      round++;
    }

    // ── If needs confirmation, save state and return ───────────────────────
    if (needsConfirmation) {
      // Save assistant's partial response to DB
      await db.insert(messages).values({
        conversationId,
        role: "assistant",
        content: `⏳ Awaiting your confirmation to run: \`${String(needsConfirmation.args.command ?? "")}\``,
        order: userMsgOrder + 1,
      });

      return NextResponse.json({
        success: true,
        requiresConfirmation: true,
        pendingToolCall: {
          toolName: needsConfirmation.toolName,
          args: needsConfirmation.args,
          toolCallId: needsConfirmation.toolCallId,
          messagesSnapshot: needsConfirmation.messagesSnapshot,
          description: needsConfirmation.description,
        },
        conversationId,
        toolsUsed,
      });
    }

    // ── Save final assistant reply to DB ──────────────────────────────────
    const assistantContent =
      finalContent ??
      "I encountered an issue processing your request. Please try again.";

    const toolsMetadata =
      toolsUsed.length > 0
        ? toolsUsed.map((t) => ({ name: t.name, args: t.args }))
        : null;

    await db.insert(messages).values({
      conversationId,
      role: "assistant",
      content: assistantContent,
      toolCalls: toolsMetadata ?? undefined,
      order: userMsgOrder + 1,
    });

    // ── Update conversation title after first real message ─────────────────
    if (history.length === 0) {
      const firstWords = message.slice(0, 50);
      await db
        .update(conversations)
        .set({ title: firstWords, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    }

    return NextResponse.json({
      success: true,
      reply: assistantContent,
      conversationId,
      toolsUsed,
      finish_reason: "stop",
    });
  } catch (err) {
    console.error("[JARVIS Chat API Error]", err);
    return NextResponse.json(
      {
        success: false,
        error:
          err instanceof Error ? err.message : "An unexpected error occurred.",
      },
      { status: 500 }
    );
  }
}

// ─── GET /api/chat?conversationId=xxx ────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversationId");

    if (conversationId) {
      // Return messages for a specific conversation
      const msgs = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.order));

      return NextResponse.json({ success: true, messages: msgs });
    }

    // Return all conversations
    const convos = await db
      .select()
      .from(conversations)
      .orderBy(asc(conversations.createdAt));

    return NextResponse.json({ success: true, conversations: convos });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/chat ─────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { conversationId: string };
    await db
      .delete(conversations)
      .where(eq(conversations.id, body.conversationId));
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
