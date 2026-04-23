import { NextRequest, NextResponse } from "next/server";
import { listRepos, listInstallationRepos, fetchRunsForRepo, WorkflowRunSummary } from "@/lib/github";
import { computeAnalytics } from "@/lib/analytics";
import { isValidOwner, isValidRepo, parseBoundedInt } from "@/lib/validate";
import { checkRateLimit, checkPublicRateLimit, clientKey } from "@/lib/ratelimit";
import { SESSION_COOKIE, openSession } from "@/lib/session";
import { installationOctokit } from "@/lib/github-app";
import { verifyUserInstallation } from "@/lib/installation-access";
import { Octokit } from "@octokit/rest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // CSRF-style guard: browsers cannot set this header on simple <img>/<form>
  // cross-site requests, so requiring it blocks rate-limit abuse via victims.
  if (req.headers.get("x-requested-with") !== "fetch") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const isPublic = sp.get("public") === "1";

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

  const owner = (sp.get("owner") || "").trim();
  const days = parseBoundedInt(sp.get("days"), 14, 1, 90);
  // Public (unauth) mode uses GitHub's 60/hr-per-IP budget, so cap hard.
  // Authenticated mode can use the full ceiling.
  const maxReposParam = isPublic
    ? parseBoundedInt(sp.get("maxRepos"), 10, 1, 15)
    : parseBoundedInt(sp.get("maxRepos"), 500, 1, 500);
  const maxRunsPerRepo = isPublic
    ? parseBoundedInt(sp.get("maxRunsPerRepo"), 20, 5, 30)
    : parseBoundedInt(sp.get("maxRunsPerRepo"), 100, 10, 500);
  const repoFilter = sp.get("repos");

  if (!owner || !isValidOwner(owner)) {
    return NextResponse.json({ error: "Invalid 'owner'" }, { status: 400 });
  }

  try {
    // Auth path:
    //  (a) `x-github-token` PAT provided -> use it as-is; GitHub enforces
    //      whatever permissions the token has.
    //  (b) signed-in via GitHub App -> mint an installation token for the
    //      requested owner after verifying membership.
    const octokit = isPublic
      ? new Octokit()
      : headerToken
      ? new Octokit({ auth: headerToken })
      : installationOctokit(await verifyUserInstallation(session!, owner));

    let repoNames: string[];
    if (repoFilter) {
      repoNames = repoFilter
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (repoNames.some((r) => !isValidRepo(r))) {
        return NextResponse.json(
          { error: "Invalid repo name in 'repos'" },
          { status: 400 }
        );
      }
      // Explicit selection: honour it fully, only apply the server-side
      // safety cap.
      repoNames = repoNames.slice(0, maxReposParam);
    } else {
      const repos =
        isPublic || headerToken
          ? await listRepos(octokit, owner)
          : await listInstallationRepos(octokit);
      repoNames = repos
        .filter((r) => !r.archived)
        .map((r) => r.name)
        .slice(0, maxReposParam);
    }

    // Fetch runs in parallel (bounded concurrency)
    const runs: WorkflowRunSummary[] = [];
    const errors: { repo: string; error: string }[] = [];
    const concurrency = 5;
    let i = 0;
    async function worker() {
      while (i < repoNames.length) {
        const idx = i++;
        const repo = repoNames[idx];
        try {
          const repoRuns = await fetchRunsForRepo(
            octokit,
            owner,
            repo,
            days,
            maxRunsPerRepo
          );
          runs.push(...repoRuns);
        } catch (e: any) {
          console.error(`[analytics] repo=${repo}`, e);
          errors.push({
            repo,
            error:
              typeof e?.status === "number"
                ? `GitHub ${e.status}`
                : "fetch failed",
          });
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));

    const analytics = computeAnalytics(runs);

    // Repos we scanned that produced zero runs in the time window. Either
    // they have no workflows configured, or have workflows that didn't run.
    const reposWithRuns = new Set(runs.map((r) => r.repo));
    const repos_without_runs = repoNames.filter((r) => !reposWithRuns.has(r));
    if (repos_without_runs.length > 0 && repoNames.length > 0) {
      analytics.insights.push({
        type: "info",
        message: `${repos_without_runs.length} of ${repoNames.length} repo(s) had no workflow runs in the last ${days} day(s). They may be missing GitHub Actions workflows or have been idle.`,
      });
    }

    return NextResponse.json({
      owner,
      days,
      repos_scanned: repoNames.length,
      repos: repoNames,
      repos_without_runs,
      errors,
      ...analytics,
    });
  } catch (e: any) {
    console.error("[analytics] error:", e);
    const status = typeof e?.status === "number" ? e.status : 500;
    const safe =
      status === 401
        ? "GitHub authentication failed"
        : status === 403
        ? e.message || "GitHub App not installed on this owner"
        : status === 404
        ? "Owner or repo not found"
        : "Failed to fetch analytics";
    return NextResponse.json({ error: safe }, { status });
  }
}
