// GitHub owner/repo naming: https://docs.github.com/en/rest/repos
// Usernames: 1-39 chars, alphanumeric or hyphens, cannot start with hyphen.
// Repo names: up to 100 chars, alphanumeric plus - _ .
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function isValidOwner(s: string): boolean {
  return OWNER_RE.test(s);
}

export function isValidRepo(s: string): boolean {
  return REPO_RE.test(s);
}

export function parseBoundedInt(
  raw: string | null,
  defaultValue: number,
  lo: number,
  hi: number
): number {
  if (raw == null) return defaultValue;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Returns the allowlist of owners the server token may be used for.
 * Configured via GITHUB_OWNER (comma separated). Empty = no implicit access.
 */
export function serverTokenAllowlist(): string[] {
  const raw = process.env.GITHUB_OWNER ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
