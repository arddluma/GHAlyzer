import type { Octokit } from "@octokit/rest";

/**
 * List every repository an installation has been granted access to.
 * Authoritative for GitHub App flows.
 */
export type RepoSummary = {
  name: string;
  full_name: string;
  archived: boolean;
  private: boolean;
};

export async function listInstallationRepos(
  octokit: Octokit
): Promise<RepoSummary[]> {
  const repos = await octokit.paginate(
    octokit.apps.listReposAccessibleToInstallation,
    { per_page: 100 }
  );
  return (repos as any[]).map((r) => ({
    name: r.name,
    full_name: r.full_name,
    archived: r.archived ?? false,
    private: r.private ?? false,
  }));
}

export interface WorkflowRunSummary {
  id: number;
  repo: string;
  workflow_name: string;
  status: string | null;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
  duration_seconds: number;
  html_url: string;
}

/**
 * List all repos owned by a user or org. Tries org first, falls back to user.
 */
export async function listRepos(
  octokit: Octokit,
  owner: string
): Promise<RepoSummary[]> {
  try {
    const repos = await octokit.paginate(octokit.repos.listForOrg, {
      org: owner,
      per_page: 100,
      type: "all",
    });
    return repos.map((r) => ({
      name: r.name,
      full_name: r.full_name,
      archived: r.archived ?? false,
      private: r.private ?? false,
    }));
  } catch (e: any) {
    if (e?.status !== 404) throw e;
    const repos = await octokit.paginate(octokit.repos.listForUser, {
      username: owner,
      per_page: 100,
      type: "owner",
    });
    return repos.map((r) => ({
      name: r.name,
      full_name: r.full_name,
      archived: r.archived ?? false,
      private: r.private ?? false,
    }));
  }
}

/**
 * Fetch workflow runs for a single repo within the last `days` days.
 * Limits to `maxRuns` to avoid hammering the API.
 */
export async function fetchRunsForRepo(
  octokit: Octokit,
  owner: string,
  repo: string,
  days: number,
  maxRuns: number
): Promise<WorkflowRunSummary[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const created = `>=${since.toISOString().slice(0, 10)}`;

  const results: WorkflowRunSummary[] = [];
  const perPage = 100;
  let page = 1;

  while (results.length < maxRuns) {
    let data: { workflow_runs: any[] };
    try {
      const res = await octokit.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        per_page: perPage,
        page,
        created,
      });
      data = res.data;
    } catch (e: any) {
      // GitHub's Actions API returns 500 for repos where Actions has never
      // been enabled, or 404 for empty repos / missing Actions. Treat these
      // as "no runs" instead of surfacing a scary warning.
      if (e?.status === 500 || e?.status === 404 || e?.status === 403) {
        break;
      }
      // For real transient failures, retry once before giving up.
      try {
        const res = await octokit.actions.listWorkflowRunsForRepo({
          owner,
          repo,
          per_page: perPage,
          page,
          created,
        });
        data = res.data;
      } catch {
        throw e;
      }
    }

    if (!data.workflow_runs.length) break;

    for (const run of data.workflow_runs) {
      const start = run.run_started_at
        ? new Date(run.run_started_at)
        : new Date(run.created_at);
      const end = new Date(run.updated_at);
      const duration = Math.max(
        0,
        Math.round((end.getTime() - start.getTime()) / 1000)
      );
      results.push({
        id: run.id,
        repo,
        workflow_name: run.name ?? "unknown",
        status: run.status,
        conclusion: run.conclusion,
        created_at: run.created_at,
        updated_at: run.updated_at,
        run_started_at: run.run_started_at ?? null,
        duration_seconds: duration,
        html_url: run.html_url,
      });
      if (results.length >= maxRuns) break;
    }

    if (data.workflow_runs.length < perPage) break;
    page += 1;
  }

  return results;
}
