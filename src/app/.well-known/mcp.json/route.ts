import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lightweight discovery document for MCP clients that probe /.well-known/mcp.json.
 * The actual server lives at /api/mcp and speaks Streamable HTTP.
 */
export async function GET() {
  return NextResponse.json({
    name: "ghalyzer-mcp",
    version: "0.1.0",
    protocol: "mcp",
    protocolVersion: "2025-06-18",
    transport: "streamable-http",
    endpoint: "/api/mcp",
    description:
      "GitHub Actions CI analytics for any public user or organization. Read-only, no auth.",
  });
}
