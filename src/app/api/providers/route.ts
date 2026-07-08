/**
 * Provider test endpoint — checks which AI providers are configured.
 */
import { NextResponse } from "next/server";
import { getAvailableProviders } from "@/lib/ai-providers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const providers = getAvailableProviders();
    return NextResponse.json({ success: true, providers });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
