import { ShieldCheck, Github } from "lucide-react";

const REPO = "arddluma/GHAlyzer";
const REPO_URL = `https://github.com/${REPO}`;

export default function Footer() {
  const sha = process.env.NEXT_PUBLIC_BUILD_SHA ?? "";
  const shortSha = sha ? sha.slice(0, 7) : "dev";
  const commitUrl = sha ? `${REPO_URL}/commit/${sha}` : REPO_URL;
  const attestationsUrl = `${REPO_URL}/attestations`;

  return (
    <footer className="max-w-7xl mx-auto px-4 sm:px-6 py-8 mt-10 border-t border-slate-800/70">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
        <a
          href={attestationsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition"
          title="Every commit is signed with a SLSA build provenance attestation. Click to verify."
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="font-medium tracking-wide">Verified build</span>
        </a>

        <span className="inline-flex items-center gap-1.5">
          <span className="text-slate-500">commit</span>
          <a
            href={commitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-slate-300 hover:text-slate-100 underline decoration-dotted underline-offset-4"
          >
            {shortSha}
          </a>
        </span>

        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-200"
        >
          <Github className="w-3.5 h-3.5" />
          <span>{REPO}</span>
        </a>

        <span className="ml-auto text-slate-500">
          This site was built from the linked commit —{" "}
          <a
            href={attestationsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-4 hover:text-slate-300"
          >
            verify it yourself
          </a>
          .
        </span>
      </div>
    </footer>
  );
}
