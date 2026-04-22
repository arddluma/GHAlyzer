<p align="center">
  <img src="public/logo.png" alt="GHAlyzer logo" width="160" />
</p>

<h1 align="center">GHAlyzer</h1>

<p align="center">
  Lightweight DevOps analytics for <strong>GitHub Actions</strong>.<br/>
  Scan every repo under an owner/org and see which workflows are slow, flaky, or trending worse over time.
</p>

<p align="center">
  <a href="https://ghalyzer.app">Live demo</a> ·
  <a href="https://github.com/arddluma/GHAlyzer/issues">Issues</a>
</p>

## Features

- **Live GitHub API** — no database, no sync jobs, fully stateless
- **Multi-repo** — iterates every repo under a user or org
- **Analytics** — avg / p95 / max duration, failure rate, daily trend
- **Insights** — human-readable callouts (bottlenecks, regressions, flaky workflows)
- **Dashboard** — Next.js + Tailwind + Recharts

## Quick start

```bash
yarn install
cp .env.example .env
# Register a GitHub App (see below) and fill in the required vars
yarn dev
```

Open http://localhost:3000, click **Sign in with GitHub**, then install the app on your accounts/orgs. The owner dropdown populates from your installations.

## Environment

| Var                       | Required | Description |
| ------------------------- | -------- | ----------- |
| `GITHUB_APP_ID`           | yes      | GitHub App numeric ID. |
| `GITHUB_APP_CLIENT_ID`    | yes      | GitHub App OAuth client ID. |
| `GITHUB_APP_CLIENT_SECRET`| yes      | GitHub App OAuth client secret. |
| `GITHUB_APP_PRIVATE_KEY`  | yes      | PEM private key (multi-line, or single-line with `\n`). |
| `GITHUB_APP_SLUG`         | yes      | URL slug (the bit after `github.com/apps/` on the install page). |
| `SESSION_SECRET`          | yes      | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts the session cookie. |
| `TRUSTED_PROXY`           | no       | `1` if behind a trusted reverse proxy (Vercel/nginx/Cloudflare) so rate limiting can key on real client IP. |

## GitHub App setup

1. Go to https://github.com/settings/apps/new.
2. **Permissions → Repository**:
   - **Actions**: Read-only
   - **Metadata**: Read-only (added automatically)
3. **Where can this GitHub App be installed?**: Any account (or Only on this account for personal use).
4. **Identifying and authorizing users**:
   - **Callback URL**: `http://localhost:3000/api/github/callback`
   - ✅ **Request user authorization (OAuth) during installation**
5. **Post-installation Setup URL**: `http://localhost:3000/api/github/callback`
6. Disable webhooks (we don't use them).
7. Create the app. On the app's settings page:
   - Note the **App ID** → `GITHUB_APP_ID`
   - Note the **Client ID** → `GITHUB_APP_CLIENT_ID`
   - Generate a **Client secret** → `GITHUB_APP_CLIENT_SECRET`
   - Generate a **Private key** (downloads a `.pem`) → paste its contents into `GITHUB_APP_PRIVATE_KEY`
   - The **public page URL** is `https://github.com/apps/<slug>` — that slug is `GITHUB_APP_SLUG`

## Security model

- The **GitHub App private key** never leaves the server. Installation access tokens are minted on demand (1h lifetime) and scoped to a single owner's installation.
- Scopes requested: **Actions: Read-only** + **Metadata: Read-only**. The app literally cannot write to any repo, workflow, or secret.
- User identity is established via a short-lived OAuth code flow; the resulting user-to-server token is used only to list the user's installations. It lives in an **AES-256-GCM encrypted, HttpOnly, SameSite=Lax** cookie with an 8-hour TTL.
- Every call to `/api/analytics` or `/api/repos` re-verifies that the signed-in user actually has access to the requested installation (prevents IDOR).
- No PAT entry in the UI; no server-side long-lived token; no `GITHUB_OWNER` allowlist needed — the authorization model is entirely delegated to GitHub App installations.

## Deployment

- Run behind a trusted reverse proxy (Vercel, nginx, Cloudflare) and set `TRUSTED_PROXY=1` so the rate limiter can key on the real client IP. Otherwise the limiter applies a global quota only.
- This repo uses **Yarn**. Install with `yarn install --frozen-lockfile`. Do not mix `npm install` or you risk a divergent dependency tree.
- `.env` is gitignored — never commit your token.

## API

All endpoints require the `X-Requested-With: fetch` header (anti-CSRF) and a valid session cookie (set via `/api/github/login`).

- `GET  /api/session` — current user `{ login, id, avatar_url }` or `{ user: null }`
- `GET  /api/installations` — installations the signed-in user has access to, plus install URL
- `GET  /api/repos?owner=<name>` — list repos for an installation
- `GET  /api/analytics?owner=<name>&days=14&maxRepos=20&maxRunsPerRepo=100` — full analytics payload
- `POST /api/github/logout` — clear the session cookie
- `GET  /api/github/login` — kick off OAuth flow (top-level redirect; not `fetch`-callable)

## How durations are computed

`duration_seconds = updated_at - run_started_at` (falls back to `created_at`). This matches the wall-clock time of each workflow run visible in the Actions UI.

## Notes

- The tool only **reads** from GitHub — no writes, no persistence.
- Large orgs: tune `maxRepos` and `maxRunsPerRepo` to stay under the 5k req/hr rate limit.
