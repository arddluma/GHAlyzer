import { NextRequest, NextResponse } from "next/server";
import { userOctokit, installUrl } from "@/lib/github-app";
import { SESSION_COOKIE, openSession } from "@/lib/session";
import { checkRateLimit, clientKey } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lists the GitHub App installations the signed-in user has access to.
 * Also returns the app's install URL so the UI can link "Install on more
 * orgs".
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("x-requested-with") !== "fetch") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rl = checkRateLimit(clientKey(req));
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const session = openSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const octokit = userOctokit(session.userToken);
    const { data } = await octokit.apps.listInstallationsForAuthenticatedUser({
      per_page: 100,
    });
    const installations = data.installations.map((i) => ({
      id: i.id,
      login: i.account && "login" in i.account ? i.account.login : "unknown",
      type:
        i.account && "type" in i.account && i.account.type === "Organization"
          ? ("org" as const)
          : ("user" as const),
      avatar_url:
        i.account && "avatar_url" in i.account ? i.account.avatar_url : "",
    }));
    return NextResponse.json({
      installations,
      installUrl: installUrl(),
    });
  } catch (e: any) {
    console.error("[installations]", e);
    const status = typeof e?.status === "number" ? e.status : 500;
    return NextResponse.json(
      { error: status === 401 ? "GitHub authentication expired" : "Failed to list installations" },
      { status }
    );
  }
}
