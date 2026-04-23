"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, Download, ExternalLink, Filter, Github, Info, Loader2, Lock, LogOut, Play, RefreshCw, Search, Unlock, X } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";
import type { Analytics, Insight, WorkflowStats, DailyPoint } from "@/lib/analytics";

type SessionUser = { login: string; id: number; avatar_url: string };

function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/session", { headers: { "x-requested-with": "fetch" }, cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setUser(j.user ?? null);
        setStatus(j.user ? "authenticated" : "unauthenticated");
      })
      .catch(() => !cancelled && setStatus("unauthenticated"));
    return () => {
      cancelled = true;
    };
  }, []);
  async function signOut() {
    await fetch("/api/github/logout", {
      method: "POST",
      headers: { "x-requested-with": "fetch" },
    });
    window.location.reload();
  }
  return { user, status, signOut };
}

type ApiResponse = Analytics & {
  owner: string;
  days: number;
  repos_scanned: number;
  repos: string[];
  repos_without_runs?: string[];
  errors: { repo: string; error: string }[];
};

function fmt(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const REPO_URL = "https://github.com/arddluma/GHAlyzer";

type Owner = { login: string; type: "user" | "org"; avatar_url: string };
type RepoInfo = { name: string; full_name: string; archived: boolean; private: boolean };

const PUBLIC_EXAMPLES = ["vercel", "facebook", "dele-to", "databuddy-analytics"];

export default function Home() {
  const { user, status, signOut } = useSession();
  const [owner, setOwner] = useState("");
  const [token, setToken] = useState("");
  const [days, setDays] = useState("14");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [repoList, setRepoList] = useState<RepoInfo[] | null>(null);
  const [repoListLoading, setRepoListLoading] = useState(false);
  const [repoListError, setRepoListError] = useState<string | null>(null);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [publicMode, setPublicMode] = useState(false);
  const isPublic = publicMode || (status === "unauthenticated" && !token);

  async function loadOwners() {
    setOwnersLoading(true);
    try {
      const res = await fetch("/api/installations", {
        headers: { "x-requested-with": "fetch" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed");
      const json = await res.json();
      const mapped: Owner[] = (json.installations ?? []).map((i: any) => ({
        login: i.login,
        type: i.type,
        avatar_url: i.avatar_url,
      }));
      setOwners(mapped);
      setInstallUrl(json.installUrl ?? null);
      if (!owner && mapped.length) setOwner(mapped[0].login);
    } catch {
      setOwners([]);
    } finally {
      setOwnersLoading(false);
    }
  }

  useEffect(() => {
    if (status !== "authenticated") {
      setOwners(null);
      return;
    }
    loadOwners();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function loadRepoList() {
    if (!owner) return;
    setRepoListLoading(true);
    setRepoListError(null);
    try {
      const qs = new URLSearchParams({ owner });
      if (isPublic) qs.set("public", "1");
      const res = await fetch(`/api/repos?${qs}`, {
        headers: {
          "x-requested-with": "fetch",
          ...(token ? { "x-github-token": token } : {}),
        },
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to list repos");
      setRepoList(json.repos ?? []);
    } catch (e: any) {
      setRepoListError(e.message);
      setRepoList([]);
    } finally {
      setRepoListLoading(false);
    }
  }

  function togglePicker() {
    const next = !pickerOpen;
    setPickerOpen(next);
    if (next && repoList === null && owner) loadRepoList();
  }

  // Clear repo selection/list when owner changes
  useEffect(() => {
    setRepoList(null);
    setSelectedRepos(new Set());
    setPickerOpen(false);
    setRepoListError(null);
  }, [owner]);

  async function run() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const daysNum = Math.min(90, Math.max(1, parseInt(days, 10) || 14));
      const params = new URLSearchParams({
        owner,
        days: String(daysNum),
      });
      if (isPublic) params.set("public", "1");
      if (selectedRepos.size > 0) {
        params.set("repos", Array.from(selectedRepos).join(","));
      }
      const res = await fetch(`/api/analytics?${params}`, {
        headers: {
          "x-requested-with": "fetch",
          ...(token ? { "x-github-token": token } : {}),
        },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6 sm:mb-8 flex flex-wrap items-center gap-3 sm:gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="GHAlyzer logo"
          width={96}
          height={96}
          className="w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-lg flex-shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold">GHAlyzer</h1>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 transition"
              aria-label="Open source on GitHub"
            >
              <Github className="w-3 h-3" />
              Open Source
            </a>
          </div>
          <p className="text-slate-400 text-xs sm:text-sm mt-0.5">
            GitHub Actions analytics — find slow CI pipelines across all your repos.
          </p>
        </div>
        <div className="w-full sm:w-auto sm:ml-auto">
          {status === "authenticated" && user ? (
            <div className="flex items-center gap-2 sm:gap-3 justify-end">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={user.avatar_url}
                alt=""
                className="w-8 h-8 rounded-full border border-slate-700 flex-shrink-0"
              />
              <div className="text-right min-w-0">
                <div className="text-xs text-slate-400">Signed in as</div>
                <div className="text-sm font-medium truncate">{user.login}</div>
              </div>
              <button
                onClick={signOut}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 flex-shrink-0"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          ) : (
            <a
              href="/api/github/login"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-slate-100 hover:bg-white text-slate-900 font-medium px-4 py-2 rounded-lg transition"
            >
              <Github className="w-4 h-4" />
              Sign in with GitHub
            </a>
          )}
        </div>
      </header>

      {isPublic && (
        <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-sm text-sky-100 flex flex-wrap items-center gap-2">
          <Unlock className="w-4 h-4 text-sky-300 flex-shrink-0" />
          <span className="font-medium">Public scan mode</span>
          <span className="text-sky-200/80">
            — no login, up to 10 public repos per run, 3 runs / 10&nbsp;min per IP.
          </span>
          <span className="text-sky-300/70">Try:</span>
          {PUBLIC_EXAMPLES.map((o) => (
            <button
              key={o}
              onClick={() => {
                setOwner(o);
                setSelectedRepos(new Set());
                setRepoList(null);
              }}
              className="px-2 py-0.5 rounded-full border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-xs font-mono"
            >
              {o}
            </button>
          ))}
          {status === "authenticated" && (
            <button
              onClick={() => setPublicMode(false)}
              className="ml-auto text-xs text-sky-300 hover:text-sky-100 underline"
            >
              Exit public mode
            </button>
          )}
        </div>
      )}
      {!isPublic && status === "authenticated" && (
        <div className="mb-4 text-xs text-slate-400">
          <button
            onClick={() => setPublicMode(true)}
            className="inline-flex items-center gap-1 underline hover:text-slate-200"
          >
            <Unlock className="w-3 h-3" />
            Try public scan (no auth)
          </button>
        </div>
      )}

      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 mb-6 sm:mb-8">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-2">
            <label className="text-xs text-slate-400 uppercase tracking-wide">
              GitHub owner / org
            </label>
            {status === "authenticated" && owners && owners.length > 0 && !token ? (
              <OwnerDropdown
                owners={owners}
                value={owner}
                onChange={setOwner}
                onReload={loadOwners}
                reloading={ownersLoading}
                installUrl={installUrl}
              />
            ) : status === "authenticated" && !token ? (
              <div className="mt-1 relative">
                {/* Looks like an open dropdown with a single actionable item */}
                <div className="bg-slate-950 border border-yellow-400/60 rounded-lg shadow-lg overflow-hidden">
                  {ownersLoading ? (
                    <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading installations…
                    </div>
                  ) : (
                    <>
                      <div className="px-4 pt-4 pb-3 border-b border-slate-800">
                        <div className="flex items-start gap-2">
                          <div className="bg-yellow-400/10 p-1.5 rounded-md">
                            <Download className="w-4 h-4 text-yellow-400" />
                          </div>
                          <div>
                            <div className="font-semibold text-slate-100">
                              One more step
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                              Install the GHAlyzer GitHub App on your user or an org to analyze its Actions.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="p-2 flex gap-2">
                        {installUrl ? (
                          <a
                            href={installUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 inline-flex items-center justify-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-3 py-2 rounded-md text-sm transition"
                          >
                            <Download className="w-4 h-4" />
                            Install on GitHub
                          </a>
                        ) : (
                          <span className="flex-1 text-xs text-amber-400 px-3 py-2">
                            Set <code>GITHUB_APP_SLUG</code> in .env to enable install link.
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={loadOwners}
                          className="inline-flex items-center gap-1.5 border border-slate-700 hover:bg-slate-800 text-slate-300 px-3 py-2 rounded-md text-sm"
                          title="I just installed it — refresh"
                        >
                          <RefreshCw className="w-4 h-4" />
                          I&apos;ve installed
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="e.g. vercel"
                className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:border-yellow-400"
              />
            )}
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-400 uppercase tracking-wide">
              Personal Access Token (optional — bypasses the GitHub App)
            </label>
            <div className="relative">
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_..."
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 pr-8 focus:outline-none focus:border-yellow-400"
              />
              {token && (
                <button
                  type="button"
                  aria-label="Clear token"
                  onClick={() => setToken("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 mt-0.5 text-slate-500 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Sent only with this request; never stored or logged.
            </p>
          </div>
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wide">
              Days
            </label>
            <input
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2"
            />
          </div>
        </div>
        {owner && (
          <div className="mt-3">
            <RepoPicker
              open={pickerOpen}
              onToggle={togglePicker}
              repos={repoList}
              loading={repoListLoading}
              error={repoListError}
              onReload={loadRepoList}
              selected={selectedRepos}
              onChange={setSelectedRepos}
            />
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mt-3">
          <div className="md:col-span-5 flex items-end">
            <button
              onClick={run}
              disabled={loading || !owner}
              className="ml-auto inline-flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-semibold px-5 py-2 rounded-lg transition"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {loading
                ? "Analyzing…"
                : selectedRepos.size > 0
                ? `Analyze ${selectedRepos.size} selected`
                : "Analyze pipelines"}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="bg-red-950/40 border border-red-800 text-red-200 rounded-lg p-4 mb-6 flex gap-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {data && <Dashboard data={data} />}

      {!data && !loading && !error && (
        <div className="text-slate-500 text-sm">
          Enter a GitHub owner/org above to analyze CI pipeline performance across their repos.
        </div>
      )}
    </main>
  );
}

function Dashboard({ data }: { data: ApiResponse }) {
  return (
    <div className="space-y-8">
      <StatsRow data={data} />
      <Insights insights={data.insights} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart trend={data.daily_trend} />
        <SlowestChart workflows={data.slowest} />
      </div>
      <WorkflowTable workflows={data.workflows} owner={data.owner} />
      {data.errors.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="font-semibold mb-2 text-amber-400">
            Warnings ({data.errors.length})
          </h3>
          <ul className="text-sm text-slate-400 space-y-1">
            {data.errors.map((e, i) => (
              <li key={i}>
                <span className="text-slate-300">{e.repo}</span>: {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatsRow({ data }: { data: ApiResponse }) {
  const totalTime = data.workflows.reduce((a, b) => a + b.total_seconds, 0);
  const avgOverall =
    data.total_runs > 0 ? Math.round(totalTime / data.total_runs) : 0;
  const failRate =
    data.workflows.length > 0
      ? data.workflows.reduce((a, b) => a + b.failure_rate * b.runs, 0) /
        Math.max(1, data.total_runs)
      : 0;

  const cards = [
    { label: "Runs analyzed", value: data.total_runs.toLocaleString() },
    { label: "Repos scanned", value: String(data.repos_scanned) },
    { label: "Avg run duration", value: fmt(avgOverall) },
    { label: "Failure rate", value: `${(failRate * 100).toFixed(1)}%` },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="bg-slate-900 border border-slate-800 rounded-xl p-4"
        >
          <div className="text-xs text-slate-400 uppercase tracking-wide">
            {c.label}
          </div>
          <div className="text-2xl font-bold mt-1">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function Insights({ insights }: { insights: Insight[] }) {
  if (!insights.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
        <Activity className="w-5 h-5 text-yellow-400" />
        Insights
      </h2>
      <ul className="space-y-2">
        {insights.map((ins, i) => {
          const Icon =
            ins.type === "warning"
              ? AlertTriangle
              : ins.type === "success"
              ? CheckCircle2
              : Info;
          const color =
            ins.type === "warning"
              ? "text-amber-400"
              : ins.type === "success"
              ? "text-emerald-400"
              : "text-sky-400";
          return (
            <li key={i} className="flex gap-2 text-sm">
              <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${color}`} />
              <span>{ins.message}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TrendChart({ trend }: { trend: DailyPoint[] }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <h3 className="font-semibold mb-4">Avg CI duration over time</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trend}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
            <YAxis
              stroke="#94a3b8"
              fontSize={11}
              tickFormatter={(v) => fmt(v)}
            />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
              }}
              formatter={(v: number) => fmt(v)}
            />
            <Line
              type="monotone"
              dataKey="avg_seconds"
              stroke="#facc15"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SlowestChart({ workflows }: { workflows: WorkflowStats[] }) {
  const chartData = workflows.map((w) => ({
    name: `${w.workflow_name} (${w.repo})`.slice(0, 40),
    avg: w.avg_seconds,
  }));
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <h3 className="font-semibold mb-4">Top 5 slowest workflows</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis
              type="number"
              stroke="#94a3b8"
              fontSize={11}
              tickFormatter={(v) => fmt(v)}
            />
            <YAxis
              type="category"
              dataKey="name"
              stroke="#94a3b8"
              fontSize={11}
              width={180}
            />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
              }}
              formatter={(v: number) => fmt(v)}
            />
            <Bar dataKey="avg" fill="#facc15" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function WorkflowTable({ workflows, owner }: { workflows: WorkflowStats[]; owner: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="p-5 border-b border-slate-800">
        <h3 className="font-semibold">All workflows</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-950 text-slate-400 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">Repo</th>
              <th className="text-left px-4 py-2">Workflow</th>
              <th className="text-right px-4 py-2">Runs</th>
              <th className="text-right px-4 py-2">Avg</th>
              <th className="text-right px-4 py-2">P95</th>
              <th className="text-right px-4 py-2">Max</th>
              <th className="text-right px-4 py-2">Fail %</th>
            </tr>
          </thead>
          <tbody>
            {workflows.map((w) => {
              const repoActionsUrl = `https://github.com/${owner}/${w.repo}/actions`;
              const workflowUrl = `${repoActionsUrl}?query=${encodeURIComponent(
                `workflow:"${w.workflow_name}"`
              )}`;
              return (
                <tr
                  key={w.key}
                  className="border-t border-slate-800 hover:bg-slate-800/40"
                >
                  <td className="px-4 py-2 text-slate-300">
                    <a
                      href={repoActionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-yellow-300 hover:underline inline-flex items-center gap-1"
                    >
                      {w.repo}
                      <ExternalLink className="w-3 h-3 opacity-60" />
                    </a>
                  </td>
                  <td className="px-4 py-2 font-medium">
                    <a
                      href={workflowUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-yellow-300 hover:underline inline-flex items-center gap-1"
                    >
                      {w.workflow_name}
                      <ExternalLink className="w-3 h-3 opacity-60" />
                    </a>
                  </td>
                  <td className="px-4 py-2 text-right">{w.runs}</td>
                  <td className="px-4 py-2 text-right">{fmt(w.avg_seconds)}</td>
                  <td className="px-4 py-2 text-right">{fmt(w.p95_seconds)}</td>
                  <td className="px-4 py-2 text-right">{fmt(w.max_seconds)}</td>
                  <td
                    className={`px-4 py-2 text-right ${
                      w.failure_rate > 0.2
                        ? "text-red-400"
                        : w.failure_rate > 0
                        ? "text-amber-400"
                        : "text-emerald-400"
                    }`}
                  >
                    {(w.failure_rate * 100).toFixed(0)}%
                  </td>
                </tr>
              );
            })}
            {workflows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No workflows found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OwnerDropdown({
  owners,
  value,
  onChange,
  onReload,
  reloading,
  installUrl,
}: {
  owners: Owner[];
  value: string;
  onChange: (v: string) => void;
  onReload: () => void;
  reloading: boolean;
  installUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = owners.find((o) => o.login === value);

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-left hover:border-slate-600 focus:outline-none focus:border-yellow-400"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={selected.avatar_url}
            alt=""
            className="w-5 h-5 rounded-full"
          />
        )}
        <span className="flex-1 truncate">
          {selected ? selected.login : "Select owner"}
          {selected && (
            <span className="text-slate-500 text-xs ml-2">
              {selected.type === "user" ? "you" : "org"}
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg shadow-lg overflow-hidden">
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {owners.map((o) => {
              const active = o.login === value;
              return (
                <li key={o.login}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(o.login);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-800 ${
                      active ? "bg-slate-800/60" : ""
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={o.avatar_url} alt="" className="w-5 h-5 rounded-full" />
                    <span className="flex-1 truncate">{o.login}</span>
                    <span className="text-[10px] uppercase text-slate-500">
                      {o.type === "user" ? "you" : "org"}
                    </span>
                    {active && <Check className="w-4 h-4 text-yellow-400" />}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-slate-800">
            <button
              type="button"
              onClick={() => onReload()}
              disabled={reloading}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
            >
              <RefreshCw
                className={`w-4 h-4 ${reloading ? "animate-spin" : ""}`}
              />
              {reloading ? "Refreshing…" : "Reload orgs"}
            </button>
            {installUrl && (
              <a
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-sky-400 hover:bg-slate-800"
              >
                <ExternalLink className="w-4 h-4" />
                Install on more orgs
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RepoPicker({
  open,
  onToggle,
  repos,
  loading,
  error,
  onReload,
  selected,
  onChange,
}: {
  open: boolean;
  onToggle: () => void;
  repos: RepoInfo[] | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const [privateOnly, setPrivateOnly] = useState(false);

  const filtered = (repos ?? []).filter((r) => {
    if (privateOnly && !r.private) return false;
    if (query && !r.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  }

  function selectAllVisible() {
    const next = new Set(selected);
    filtered.forEach((r) => next.add(r.name));
    onChange(next);
  }

  function clearAll() {
    onChange(new Set());
  }

  const summary =
    selected.size > 0
      ? `${selected.size} selected`
      : repos
      ? `${repos.length} available`
      : "click to load";

  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-950 hover:bg-slate-900 text-left"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-400" />
        )}
        <span className="text-sm font-medium text-slate-200">Select specfic repos</span>
        <span className="text-xs text-slate-500">({summary})</span>
        <span className="ml-auto text-[10px] text-slate-500">
          {selected.size === 0 && repos && "if none chosen = scan all"}
        </span>
      </button>

      {open && (
        <div className="bg-slate-950/50 border-t border-slate-800">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-800">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search repos…"
                className="w-full bg-slate-900 border border-slate-700 rounded-md pl-7 pr-2 py-1.5 text-sm focus:outline-none focus:border-yellow-400"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={privateOnly}
                onChange={(e) => setPrivateOnly(e.target.checked)}
                className="accent-yellow-400"
              />
              <Filter className="w-3.5 h-3.5" />
              Private only
            </label>
            <button
              type="button"
              onClick={selectAllVisible}
              disabled={!filtered.length}
              className="text-xs px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-40"
            >
              Select visible
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={selected.size === 0}
              className="text-xs px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-40"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onReload}
              disabled={loading}
              className="text-xs px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-1"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading repos…
              </div>
            ) : error ? (
              <div className="px-4 py-6 text-sm text-red-300">{error}</div>
            ) : !filtered.length ? (
              <div className="px-4 py-6 text-sm text-slate-500">
                {repos && repos.length > 0
                  ? "No repos match your filters."
                  : "No repos found."}
              </div>
            ) : (
              <ul className="divide-y divide-slate-800">
                {filtered.map((r) => {
                  const checked = selected.has(r.name);
                  return (
                    <li key={r.full_name}>
                      <label className="flex items-center gap-2 px-3 py-2 hover:bg-slate-900 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(r.name)}
                          className="accent-yellow-400"
                        />
                        <span className="text-sm text-slate-200 flex-1 truncate">
                          {r.name}
                        </span>
                        {r.private ? (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
                            <Lock className="w-3 h-3" />
                            Private
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded">
                            <Unlock className="w-3 h-3" />
                            Public
                          </span>
                        )}
                        {r.archived && (
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 border border-slate-700 px-1.5 py-0.5 rounded">
                            Archived
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
