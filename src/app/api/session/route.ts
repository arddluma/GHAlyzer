import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, openSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Returns the current user's public profile (no token), or null if signed out.
 * Safe to call from the client; the encrypted cookie stays on the server.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("x-requested-with") !== "fetch") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const s = openSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: { login: s.login, id: s.id, avatar_url: s.avatar_url },
  });
}
