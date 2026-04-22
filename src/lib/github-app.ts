import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

function appConfig() {
  const appId = process.env.GITHUB_APP_ID;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY ?? "";
  // Accept the PEM either as a real multi-line string or with literal `\n`
  // escapes (common when pasted into a single-line env var).
  const privateKey = rawKey.includes("\\n")
    ? rawKey.replace(/\\n/g, "\n")
    : rawKey;
  if (!appId || !privateKey) {
    throw new Error(
      "GitHub App is not configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY."
    );
  }
  return { appId, privateKey };
}

/** Octokit authenticated as the App itself (for /app/* endpoints). */
export function appOctokit() {
  return new Octokit({ authStrategy: createAppAuth, auth: appConfig() });
}

/**
 * Octokit authenticated as a specific installation. Tokens are minted
 * on-demand, cached internally by @octokit/auth-app for ~1h.
 */
export function installationOctokit(installationId: number) {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { ...appConfig(), installationId },
  });
}

/** Octokit authenticated as a user (user-to-server OAuth token). */
export function userOctokit(userToken: string) {
  return new Octokit({ auth: userToken });
}

export function installUrl(): string | null {
  const slug = process.env.GITHUB_APP_SLUG;
  return slug ? `https://github.com/apps/${slug}/installations/new` : null;
}

export function oauthClientConfig() {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GitHub App OAuth not configured. Set GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET."
    );
  }
  return { clientId, clientSecret };
}

/** Exchange an OAuth code for a user-to-server access token. */
export async function exchangeCodeForUserToken(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; expires_in?: number; refresh_token?: string }> {
  const { clientId, clientSecret } = oauthClientConfig();
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "GHAlyzer",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status}`);
  }
  const data = (await res.json()) as any;
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || "No access_token returned");
  }
  return {
    access_token: data.access_token,
    expires_in: data.expires_in,
    refresh_token: data.refresh_token,
  };
}
