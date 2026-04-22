import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { oauthClientConfig } from "@/lib/github-app";
import { OAUTH_STATE_COOKIE, stateCookieOpts } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Starts the GitHub App OAuth user-authorization flow for identifying who
 * the user is. Generates a CSRF state, stashes it in an HttpOnly cookie,
 * and 302-redirects to github.com/login/oauth/authorize.
 */
export async function GET(req: NextRequest) {
  const { clientId } = oauthClientConfig();
  const state = randomBytes(16).toString("hex");
  const redirectUri = new URL("/api/github/callback", req.url).toString();

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set(OAUTH_STATE_COOKIE, state, stateCookieOpts());
  return res;
}
