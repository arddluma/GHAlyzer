import { NextRequest, NextResponse } from "next/server";
import { listRepos, listInstallationRepos } from "@/lib/github";
import { isValidOwner } from "@/lib/validate";
import { checkRateLimit, checkPublicRateLimit, clientKey } from "@/lib/ratelimit";
import { SESSION_COOKIE, openSession } from "@/lib/session";
import { installationOctokit } from "@/lib/github-app";
import { verifyUserInstallation } from "@/lib/installation-access";
import { Octokit } from "@octokit/rest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (req.headers.get("x-requested-with") !== "fetch") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isPublic = req.nextUrl.searchParams.get("public") === "1";

  const rl = isPublic
    ? checkPublicRateLimit(clientKey(req))
    : checkRateLimit(clientKey(req));
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: isPublic
          ? "Too many public scans. Sign in for higher limits."
          : "Rate limit exceeded",
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const headerToken = req.headers.get("x-github-token") || undefined;
  const session = headerToken
    ? null
    : openSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!isPublic && !headerToken && !session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const owner = (req.nextUrl.searchParams.get("owner") || "").trim();
  if (!owner || !isValidOwner(owner)) {
    return NextResponse.json({ error: "Invalid 'owner'" }, { status: 400 });
  }

  try {
    const octokit = isPublic
      ? new Octokit() // unauthenticated — only sees public repos
      : headerToken
      ? new Octokit({ auth: headerToken })
      : installationOctokit(await verifyUserInstallation(session!, owner));
    const all =
      isPublic || headerToken
        ? await listRepos(octokit, owner)
        : await listInstallationRepos(octokit);
    const repos = all.filter((r) => !r.archived);
    return NextResponse.json({ owner, repos });
  } catch (e: any) {
    console.error("[repos] error:", e);
    const status = typeof e?.status === "number" ? e.status : 500;
    const safe =
      status === 401
        ? "GitHub authentication failed"
        : status === 403
        ? e.message || "GitHub App not installed on this owner"
        : status === 404
        ? "Owner not found"
        : "Failed to list repositories";
    return NextResponse.json({ error: safe }, { status });
  }
}
