import { NextRequest, NextResponse } from "next/server";
import { isValidOwner, isValidRepo } from "@/lib/validate";
import { checkPublicRateLimit, clientKey } from "@/lib/ratelimit";
import {
  listPublicRepos,
  scanPublic,
  PUBLIC_MAX_REPOS,
  PUBLIC_MAX_RUNS_PER_REPO,
} from "@/lib/public-scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Minimal Model Context Protocol server over Streamable HTTP.
 *
 * Stateless: each POST is an independent JSON-RPC 2.0 request. Supports the
 * three methods MCP clients (Claude Desktop, Cursor, Windsurf, etc.) need to
 * bootstrap and call tools:
 *
 *   - initialize        → server capabilities + info
 *   - tools/list        → schema of every callable tool
 *   - tools/call        → invoke a tool, return content blocks
 *
 * All tools run in PUBLIC MODE only — no auth, same rate limits as the
 * website's "public scan" path.
 *
 * Discovery: GET /api/mcp returns a tiny banner so humans hitting the URL
 * see something useful instead of "Method Not Allowed".
 */

const SERVER_INFO = {
  name: "ghalyzer-mcp",
  version: "0.1.0",
  title: "GHAlyzer — GitHub Actions analytics",
};

const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "list_public_repos",
    title: "List public repos for an owner",
    description:
      "Lists public, non-archived repositories owned by a GitHub user or organization. Use this before scan_public_workflows to discover repo names.",
    inputSchema: {
      type: "object",
      properties: {
        owner: {
          type: "string",
          description: "GitHub user or organization login (e.g. 'vercel').",
        },
      },
      required: ["owner"],
      additionalProperties: false,
    },
  },
  {
    name: "scan_public_workflows",
    title: "Scan GitHub Actions workflows",
    description:
      "Analyzes GitHub Actions workflow runs across a public owner's repositories. Returns per-workflow stats (avg/p95/max duration, failure rate), daily trend, and human-readable insights about slow or flaky pipelines. Capped at " +
      PUBLIC_MAX_REPOS +
      " repos and " +
      PUBLIC_MAX_RUNS_PER_REPO +
      " runs per repo per call.",
    inputSchema: {
      type: "object",
      properties: {
        owner: {
          type: "string",
          description: "GitHub user or organization login.",
        },
        days: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          default: 14,
          description: "Look-back window in days.",
        },
        repos: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of specific repo names to scan. If omitted, the first " +
            PUBLIC_MAX_REPOS +
            " non-archived public repos are used.",
        },
      },
      required: ["owner"],
      additionalProperties: false,
    },
  },
  {
    name: "get_public_insights",
    title: "Get CI health insights only",
    description:
      "Cheaper variant of scan_public_workflows that returns only the list of insights (slow/flaky/regressing workflows). Use this when the caller just wants the narrative, not the raw stats.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        days: { type: "integer", minimum: 1, maximum: 90, default: 14 },
      },
      required: ["owner"],
      additionalProperties: false,
    },
  },
] as const;

type JsonRpcId = string | number | null;
interface JsonRpcReq {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: any;
}

function rpcResult(id: JsonRpcId, result: any) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id: JsonRpcId, code: number, message: string, data?: any) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

function textContent(text: string) {
  return { content: [{ type: "text", text }] };
}
function jsonContent(obj: unknown) {
  return {
    content: [
      { type: "text", text: JSON.stringify(obj, null, 2) },
    ],
    structuredContent: obj,
  };
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, mcp-session-id",
  "Access-Control-Max-Age": "86400",
};

function withCors<T extends NextResponse>(res: T): T {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET() {
  return withCors(
    NextResponse.json({
      ...SERVER_INFO,
      protocol: "Model Context Protocol",
      protocolVersion: PROTOCOL_VERSION,
      transport: "Streamable HTTP (stateless)",
      endpoint: "POST /api/mcp",
      tools: TOOLS.map((t) => t.name),
      docs: "https://modelcontextprotocol.io",
    })
  );
}

export async function POST(req: NextRequest) {
  // No x-requested-with gate here: MCP clients are non-browser and cannot
  // set arbitrary headers consistently. We compensate with strict rate
  // limiting and JSON-only bodies.
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return withCors(
      NextResponse.json(
        rpcError(null, -32700, "Content-Type must be application/json"),
        { status: 415 }
      )
    );
  }

  let body: JsonRpcReq | JsonRpcReq[];
  try {
    body = (await req.json()) as JsonRpcReq | JsonRpcReq[];
  } catch {
    return withCors(
      NextResponse.json(
        rpcError(null, -32700, "Parse error: invalid JSON"),
        { status: 400 }
      )
    );
  }

  const batch = Array.isArray(body);
  const reqs: JsonRpcReq[] = batch ? (body as JsonRpcReq[]) : [body as JsonRpcReq];
  const rlKey = clientKey(req);
  const responses = await Promise.all(reqs.map((r) => handleOne(r, rlKey)));
  // Per JSON-RPC spec: notifications (no id) get no response.
  const filtered = responses.filter((r) => r !== null);
  if (filtered.length === 0) return withCors(new NextResponse(null, { status: 204 }));
  return withCors(NextResponse.json(batch ? filtered : filtered[0]));
}

async function handleOne(r: JsonRpcReq, rlKey: string): Promise<any | null> {
  if (!r || r.jsonrpc !== "2.0" || typeof r.method !== "string") {
    return rpcError(r?.id ?? null, -32600, "Invalid Request");
  }
  const id = r.id;
  const isNotification = id === undefined;

  try {
    switch (r.method) {
      case "initialize":
        return rpcResult(id ?? null, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            "Analyze GitHub Actions workflow health for any public GitHub user or organization. Start with list_public_repos(owner) to discover repos, then call scan_public_workflows(owner, days?, repos?) for full analytics, or get_public_insights(owner, days?) for just the high-signal narrative.",
        });

      case "notifications/initialized":
      case "notifications/cancelled":
        return null; // fire-and-forget

      case "ping":
        return rpcResult(id ?? null, {});

      case "tools/list":
        return rpcResult(id ?? null, { tools: TOOLS });

      case "tools/call": {
        const rl = checkPublicRateLimit(rlKey);
        if (!rl.ok) {
          return rpcError(
            id ?? null,
            -32000,
            `Rate limit exceeded. Try again in ${rl.retryAfterSec}s.`,
            { retryAfterSec: rl.retryAfterSec }
          );
        }
        const name = r.params?.name as string | undefined;
        const args = (r.params?.arguments ?? {}) as Record<string, any>;
        if (!name) throw rpcError(id ?? null, -32602, "Missing tool name");
        return rpcResult(id ?? null, await callTool(name, args));
      }

      default:
        if (isNotification) return null;
        return rpcError(id ?? null, -32601, `Method not found: ${r.method}`);
    }
  } catch (e: any) {
    if (e && typeof e === "object" && "jsonrpc" in e) return e;
    console.error("[mcp] handler error", e);
    return rpcError(id ?? null, -32603, "Internal error", {
      reason: e?.message ?? "unknown",
    });
  }
}

async function callTool(name: string, args: Record<string, any>) {
  const owner = String(args.owner ?? "").trim();
  if (!owner || !isValidOwner(owner)) {
    return {
      isError: true,
      ...textContent(`Invalid 'owner': '${owner}'. Must be a valid GitHub login.`),
    };
  }

  switch (name) {
    case "list_public_repos": {
      const repos = await listPublicRepos(owner);
      return jsonContent({
        owner,
        count: repos.length,
        repos: repos.map((r) => ({
          name: r.name,
          full_name: r.full_name,
          archived: r.archived,
          private: r.private,
        })),
      });
    }

    case "scan_public_workflows": {
      const repos = Array.isArray(args.repos)
        ? args.repos.map(String).filter((s: string) => isValidRepo(s))
        : undefined;
      const result = await scanPublic({
        owner,
        days: typeof args.days === "number" ? args.days : undefined,
        repos,
      });
      return jsonContent(result);
    }

    case "get_public_insights": {
      const result = await scanPublic({
        owner,
        days: typeof args.days === "number" ? args.days : undefined,
      });
      return jsonContent({
        owner: result.owner,
        days: result.days,
        repos_scanned: result.repos_scanned,
        insights: result.insights,
      });
    }

    default:
      return {
        isError: true,
        ...textContent(`Unknown tool: ${name}`),
      };
  }
}
