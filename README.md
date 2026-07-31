# DFV — Innovation Sense-Checker

A UK-energy innovation triage tool. Submit an idea, answer four clarifying
questions, and get a Desirability / Feasibility / Viability analysis with
scores, a UK persona, TRL assessment, £-denominated market sizing, and a
portfolio matrix of everything analysed so far. Saved ideas live in
`localStorage`.

Vite + React. Claude calls go through a serverless function so the API key
stays on the server.

## Setup

```bash
npm install
```

Put your key in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

`.env` is gitignored. **Note the missing `VITE_` prefix** — that prefix tells
Vite to inline a variable into the browser bundle, which is exactly what we're
avoiding here. Only `api/claude.js` reads this value.

## Run

```bash
npm run dev
```

The dev server mounts `api/claude.js` at `/api/claude` (see `vite.config.js`),
so local behaviour matches production.

## Build

```bash
npm run build
```

## Deploy (Vercel)

`api/claude.js` is a standard Vercel serverless function — no config needed.
Set `ANTHROPIC_API_KEY` in the project's environment variables in the Vercel
dashboard; the local `.env` is not uploaded.

For Netlify or Cloudflare instead, the handler body ports over directly; only
the `(req, res)` signature and file location change.

## Architecture

```
browser (src/App.jsx)
  └─ POST /api/claude  { system, user }
       └─ api/claude.js   ← ANTHROPIC_API_KEY lives here
            └─ Claude Messages API
       ←─ { text }
```

The browser never sees the key, the model name, or the request shape. The
proxy accepts only `{ system, user }` strings.

### Endpoint limits

`api/claude.js` applies, in order: an Origin check (403), a per-IP rate limit
of 20 requests/minute (429 + `Retry-After`), a 64 KB body cap (413), and
per-field prompt caps (413). One analysis costs 4 calls, so the limit allows
roughly five analyses per minute per IP.

Set `ALLOWED_ORIGIN` to your deployed origin (e.g.
`https://dfv.vercel.app`) to pin the Origin check; otherwise it falls back to
same-host. Requests with no `Origin` header (curl, server-to-server) are
allowed through and governed by the rate limit alone — this is a cross-site
control, not authentication.

**The rate limit is best-effort.** Its counter lives in memory on each warm
serverless instance, so the effective ceiling is
`instances × 20/min` and it resets on cold start. It stops casual scripted
abuse. For a hard quota, use Vercel's platform rate limiting or move the
counter to a shared store such as Upstash Redis.

There is no user authentication. The app has no login, so any secret shipped
to the browser would be readable in the bundle. If this needs to be genuinely
private, put it behind Vercel Deployment Protection or an SSO proxy.

### Model

`claude-sonnet-5`, set in `api/claude.js`. Thinking is disabled there because
each agent returns a short JSON document and the whole `max_tokens` budget is
better spent on the answer — see the comment in that file for how to turn it
back on.
