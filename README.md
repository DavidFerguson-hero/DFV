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

### Model

`claude-sonnet-5`, set in `api/claude.js`. Thinking is disabled there because
each agent returns a short JSON document and the whole `max_tokens` budget is
better spent on the answer — see the comment in that file for how to turn it
back on.
