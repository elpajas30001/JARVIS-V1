/**
 * Tools introspection endpoint — returns available tool definitions for the UI.
 */
import { NextResponse } from "next/server";
import { JARVIS_TOOL_DEFINITIONS, TOOL_LABELS } from "@/lib/jarvis-tools";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    success: true,
    tools: JARVIS_TOOL_DEFINITIONS.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      label: TOOL_LABELS[t.function.name as keyof typeof TOOL_LABELS],
      parameters: t.function.parameters,
    })),
  });
}
