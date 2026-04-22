import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForUserToken, userOctokit } from "@/lib/github-app";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  safeEqual,
  sealSession,
  sessionCookieOpts,
} from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * OAuth redirect target. Handles two cases:
 *  1. Regular sign-in: ?code=...&state=...
 *  2. Post-install redirect: ?installation_id=...&setup_action=install (+code if
 *     "Request user authorization (OAuth) during installation" is enabled on
 *     the App).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const state = sp.get("state");

  // --- CSRF state check (skipped on pure post-install redirects) ---
  if (code) {
    const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
    if (!state || !cookieState || !safeEqual(state, cookieState)) {
      return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
    }
  }

  // --- No code: user arrived from install redirect without OAuth ---
  if (!code) {
    // Nothing we can do without a user token. Send them to /login to identify.
    const loginUrl = new URL("/api/github/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // --- Exchange code for user token + fetch profile ---
  try {
    const redirectUri = new URL("/api/github/callback", req.url).toString();
    const { access_token, expires_in } = await exchangeCodeForUserToken(
      code,
      redirectUri
    );
    const me = await userOctokit(access_token).users.getAuthenticated();

    const cookie = sealSession({
      login: me.data.login,
      id: me.data.id,
      avatar_url: me.data.avatar_url,
      userToken: access_token,
      userTokenExp: expires_in
        ? Math.floor(Date.now() / 1000) + expires_in
        : undefined,
    });

    const res = NextResponse.redirect(new URL("/", req.url));
    res.cookies.set(SESSION_COOKIE, cookie, sessionCookieOpts());
    // Clear CSRF state cookie
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (e: any) {
    console.error("[github/callback]", e);
    return NextResponse.json(
      {
        error: "OAuth callback failed",
        detail: e?.message || String(e),
        hint:
          "Check that GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET / SESSION_SECRET in .env are correct. SESSION_SECRET must decode to 32 bytes (openssl rand -base64 32).",
      },
      { status: 500 }
    );
  }
}
