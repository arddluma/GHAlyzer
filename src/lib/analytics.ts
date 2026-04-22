import type { WorkflowRunSummary } from "./github";

export interface WorkflowStats {
  key: string; // repo::workflow
  repo: string;
  workflow_name: string;
  runs: number;
  avg_seconds: number;
  min_seconds: number;
  max_seconds: number;
  p95_seconds: number;
  failure_rate: number;
  total_seconds: number;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  avg_seconds: number;
  runs: number;
}

export interface Insight {
  type: "warning" | "info" | "success";
  message: string;
}

export interface Analytics {
  total_runs: number;
  total_repos: number;
  workflows: WorkflowStats[];
  daily_trend: DailyPoint[];
  slowest: WorkflowStats[];
  insights: Insight[];
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function computeAnalytics(runs: WorkflowRunSummary[]): Analytics {
  const byWorkflow = new Map<string, WorkflowRunSummary[]>();
  const repos = new Set<string>();

  for (const r of runs) {
    repos.add(r.repo);
    const key = `${r.repo}::${r.workflow_name}`;
    const arr = byWorkflow.get(key) ?? [];
    arr.push(r);
    byWorkflow.set(key, arr);
  }

  const workflows: WorkflowStats[] = [];
  for (const [key, group] of byWorkflow) {
    const durations = group
      .map((g) => g.duration_seconds)
      .sort((a, b) => a - b);
    const sum = durations.reduce((a, b) => a + b, 0);
    const failures = group.filter(
      (g) => g.conclusion && g.conclusion !== "success" && g.conclusion !== "skipped"
    ).length;
    workflows.push({
      key,
      repo: group[0].repo,
      workflow_name: group[0].workflow_name,
      runs: group.length,
      avg_seconds: group.length ? Math.round(sum / group.length) : 0,
      min_seconds: durations[0] ?? 0,
      max_seconds: durations[durations.length - 1] ?? 0,
      p95_seconds: percentile(durations, 95),
      failure_rate: group.length ? failures / group.length : 0,
      total_seconds: sum,
    });
  }

  workflows.sort((a, b) => b.avg_seconds - a.avg_seconds);

  // Daily trend across all runs
  const byDay = new Map<string, number[]>();
  for (const r of runs) {
    const day = r.created_at.slice(0, 10);
    const arr = byDay.get(day) ?? [];
    arr.push(r.duration_seconds);
    byDay.set(day, arr);
  }
  const daily_trend: DailyPoint[] = Array.from(byDay.entries())
    .map(([date, arr]) => ({
      date,
      avg_seconds: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
      runs: arr.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const slowest = workflows.slice(0, 5);
  const insights = generateInsights(runs, workflows, daily_trend);

  return {
    total_runs: runs.length,
    total_repos: repos.size,
    workflows,
    daily_trend,
    slowest,
    insights,
  };
}

function generateInsights(
  runs: WorkflowRunSummary[],
  workflows: WorkflowStats[],
  daily: DailyPoint[]
): Insight[] {
  const insights: Insight[] = [];

  // 7-day trend comparison
  if (daily.length >= 4) {
    const half = Math.floor(daily.length / 2);
    const older = daily.slice(0, half);
    const newer = daily.slice(half);
    const avgOlder =
      older.reduce((a, b) => a + b.avg_seconds, 0) / older.length;
    const avgNewer =
      newer.reduce((a, b) => a + b.avg_seconds, 0) / newer.length;
    if (avgOlder > 0) {
      const change = ((avgNewer - avgOlder) / avgOlder) * 100;
      if (Math.abs(change) >= 10) {
        insights.push({
          type: change > 0 ? "warning" : "success",
          message: `CI time ${change > 0 ? "increased" : "decreased"} ${Math.abs(
            change
          ).toFixed(0)}% in the recent half of the window.`,
        });
      } else {
        insights.push({
          type: "info",
          message: `CI time is stable (${change >= 0 ? "+" : ""}${change.toFixed(
            1
          )}% recently).`,
        });
      }
    }
  }

  // Top bottleneck
  if (workflows.length) {
    const top = workflows[0];
    const totalTime = workflows.reduce((a, b) => a + b.total_seconds, 0);
    const pct = totalTime ? (top.total_seconds / totalTime) * 100 : 0;
    insights.push({
      type: "warning",
      message: `"${top.workflow_name}" in ${top.repo} is the slowest workflow (avg ${formatDur(
        top.avg_seconds
      )}) and accounts for ${pct.toFixed(0)}% of total CI time.`,
    });
  }

  // Failure rate
  const highFailure = workflows
    .filter((w) => w.runs >= 3 && w.failure_rate >= 0.25)
    .sort((a, b) => b.failure_rate - a.failure_rate)[0];
  if (highFailure) {
    insights.push({
      type: "warning",
      message: `"${highFailure.workflow_name}" (${highFailure.repo}) fails ${(
        highFailure.failure_rate * 100
      ).toFixed(0)}% of the time — flaky or broken.`,
    });
  }

  // Volume
  if (runs.length) {
    insights.push({
      type: "info",
      message: `Analyzed ${runs.length} runs across ${new Set(
        runs.map((r) => r.repo)
      ).size} repo(s).`,
    });
  } else {
    insights.push({
      type: "info",
      message: "No workflow runs found in the selected window.",
    });
  }

  return insights;
}

export function formatDur(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
