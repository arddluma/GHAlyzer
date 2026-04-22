import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware: sets a per-request CSP nonce so we can drop 'unsafe-inline'
 * for scripts. Styles still need 'unsafe-inline' because Next.js + Tailwind
 * inject inline styles that cannot currently carry a nonce.
 */
export function middleware(req: NextRequest) {
  // 16-byte nonce, base64url-encoded. Uses the Web Crypto API (edge-compatible).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // Dev mode needs 'unsafe-eval' for Next.js HMR and React Refresh.
  const isDev = process.env.NODE_ENV !== "production";
  // Databuddy analytics: cdn serves the loader script, basket receives events.
  const databuddyScript = "https://cdn.databuddy.cc";
  const databuddyConnect = "https://basket.databuddy.cc https://api.databuddy.cc";
  const scriptSrc = isDev
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' ${databuddyScript}`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${databuddyScript}`;

  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://avatars.githubusercontent.com",
    // Dev: allow websocket for HMR
    isDev
      ? `connect-src 'self' ws: wss: ${databuddyConnect}`
      : `connect-src 'self' ${databuddyConnect}`,
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://github.com",
    "object-src 'none'",
  ].join("; ");

  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  matcher: [
    // Skip Next internals and static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
