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

export interface StepRunSummary {
  name: string;
  number: number;
  conclusion: string | null;
  duration_seconds: number;
}

export interface JobRunSummary {
  id: number;
  run_id: number;
  name: string;
  conclusion: string | null;
  duration_seconds: number;
  steps: StepRunSummary[];
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

/**
 * Fetch jobs (with steps) for a single workflow run. Used to drill into the
 * slowest workflow and surface per-job / per-step bottlenecks.
 */
export async function fetchJobsForRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  run_id: number
): Promise<JobRunSummary[]> {
  let data: { jobs: any[] };
  try {
    const res = await octokit.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id,
      per_page: 100,
      filter: "latest",
    });
    data = res.data;
  } catch (e: any) {
    if (e?.status === 404 || e?.status === 403 || e?.status === 500) {
      return [];
    }
    throw e;
  }

  return data.jobs.map((j: any) => {
    const jobStart = j.started_at ? new Date(j.started_at).getTime() : null;
    const jobEnd = j.completed_at ? new Date(j.completed_at).getTime() : null;
    const jobDuration =
      jobStart !== null && jobEnd !== null
        ? Math.max(0, Math.round((jobEnd - jobStart) / 1000))
        : 0;
    const steps: StepRunSummary[] = (j.steps ?? [])
      .map((s: any) => {
        const start = s.started_at ? new Date(s.started_at).getTime() : null;
        const end = s.completed_at ? new Date(s.completed_at).getTime() : null;
        const duration =
          start !== null && end !== null
            ? Math.max(0, Math.round((end - start) / 1000))
            : 0;
        return {
          name: s.name ?? "unknown",
          number: s.number ?? 0,
          conclusion: s.conclusion ?? null,
          duration_seconds: duration,
        };
      });
    return {
      id: j.id,
      run_id: j.run_id ?? run_id,
      name: j.name ?? "unknown",
      conclusion: j.conclusion ?? null,
      duration_seconds: jobDuration,
      steps,
    };
  });
}
