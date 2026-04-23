import { Octokit } from "@octokit/rest";
import {
  listRepos,
  fetchRunsForRepo,
  WorkflowRunSummary,
  RepoSummary,
} from "@/lib/github";
import { computeAnalytics } from "@/lib/analytics";
import type { Analytics } from "@/lib/analytics";

/**
 * Shared helpers for the unauthenticated public-scan path. Used by both the
 * REST routes and the MCP tool handlers so behaviour stays in lockstep.
 *
 * Hard caps mirror the ones in /api/analytics so MCP clients cannot exceed
 * GitHub's 60-req/hour unauthenticated ceiling in a single call.
 */
export const PUBLIC_MAX_REPOS = 10;
export const PUBLIC_MAX_RUNS_PER_REPO = 20;
export const PUBLIC_CONCURRENCY = 3;

export function publicOctokit(): Octokit {
  return new Octokit();
}

export async function listPublicRepos(owner: string): Promise<RepoSummary[]> {
  const octokit = publicOctokit();
  return listRepos(octokit, owner);
}

export interface PublicScanInput {
  owner: string;
  days?: number; // 1..90
  repos?: string[]; // explicit filter
  maxRepos?: number; // <= PUBLIC_MAX_REPOS
  maxRunsPerRepo?: number; // <= PUBLIC_MAX_RUNS_PER_REPO
}

export interface PublicScanResult extends Analytics {
  owner: string;
  days: number;
  repos_scanned: number;
  repos: string[];
  repos_without_runs: string[];
  errors: { repo: string; error: string }[];
}

export async function scanPublic(
  input: PublicScanInput
): Promise<PublicScanResult> {
  const days = clamp(input.days ?? 14, 1, 90);
  const maxRepos = clamp(input.maxRepos ?? PUBLIC_MAX_REPOS, 1, PUBLIC_MAX_REPOS);
  const maxRunsPerRepo = clamp(
    input.maxRunsPerRepo ?? PUBLIC_MAX_RUNS_PER_REPO,
    1,
    PUBLIC_MAX_RUNS_PER_REPO
  );

  const octokit = publicOctokit();
  let repoNames: string[];
  if (input.repos && input.repos.length > 0) {
    repoNames = input.repos.slice(0, maxRepos);
  } else {
    const repos = await listRepos(octokit, input.owner);
    repoNames = repos
      .filter((r) => !r.archived)
      .map((r) => r.name)
      .slice(0, maxRepos);
  }

  const runs: WorkflowRunSummary[] = [];
  const errors: { repo: string; error: string }[] = [];
  let i = 0;
  async function worker() {
    while (i < repoNames.length) {
      const idx = i++;
      const repo = repoNames[idx];
      try {
        const repoRuns = await fetchRunsForRepo(
          octokit,
          input.owner,
          repo,
          days,
          maxRunsPerRepo
        );
        runs.push(...repoRuns);
      } catch (e: any) {
        errors.push({
          repo,
          error:
            typeof e?.status === "number" ? `GitHub ${e.status}` : "fetch failed",
        });
      }
    }
  }
  await Promise.all(Array.from({ length: PUBLIC_CONCURRENCY }, worker));

  const analytics = computeAnalytics(runs);
  const reposWithRuns = new Set(runs.map((r) => r.repo));
  const repos_without_runs = repoNames.filter((r) => !reposWithRuns.has(r));
  if (repos_without_runs.length > 0 && repoNames.length > 0) {
    analytics.insights.push({
      type: "info",
      message: `${repos_without_runs.length} of ${repoNames.length} repo(s) had no workflow runs in the last ${days} day(s).`,
    });
  }

  return {
    owner: input.owner,
    days,
    repos_scanned: repoNames.length,
    repos: repoNames,
    repos_without_runs,
    errors,
    ...analytics,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}
