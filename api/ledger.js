// Ledger inbox endpoint.
//
// DFV is the intake screen for R-Spike. When an idea passes screening, the app
// POSTs it here and we append it as one JSON line to an "inbox" file. A separate
// R-Spike importer reads that file into the SQLite ideas ledger. This keeps the
// Node app and the Python ledger decoupled — one writer to the DB — and works
// fully locally today (via `npm run dev`), while leaving room to become a hosted
// API later.
//
// Mirrors api/claude.js's request handling, origin check, and body caps.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MAX_BODY_BYTES = 64 * 1024;

// Read at request time (not import time) so env overrides are reliable
// regardless of when the module is loaded.
const inboxPath = () => process.env.LEDGER_INBOX || "./data/dfv_inbox.jsonl";
const userId = () => process.env.DFV_USER_ID || "david";

class PayloadTooLarge extends Error {}

// Blocks other websites from pointing their front end at this endpoint.
// A missing Origin (curl, server-to-server) is allowed through — this is a
// cross-site control, not authentication.
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const { host, hostname } = new URL(origin);
    // Always allow local development (loopback), regardless of ALLOWED_ORIGIN.
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
    const allowed = process.env.ALLOWED_ORIGIN;
    if (allowed) return origin === allowed;
    return host === req.headers.host;
  } catch {
    return false;
  }
}

// Vercel pre-parses JSON onto req.body; the Vite dev middleware does not, so
// fall back to draining the stream. Bails during the read rather than buffering
// an unbounded upload.
async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new PayloadTooLarge();
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

// Map the app's analysis into the R-Spike ledger's idea shape. Server stamps
// user_id and timestamp so the browser can't. Full DFV output is preserved
// under dfv_detail so nothing is lost. market_size stays null — the separate
// downstream agent fills it later.
function toLedgerIdea(idea) {
  const r = idea?.results || {};
  const num = (v) => (typeof v === "number" ? v : null);
  const title =
    (idea?.summary && String(idea.summary).trim()) ||
    (idea?.idea ? String(idea.idea).slice(0, 80) : "Untitled idea");
  return {
    title,
    description: idea?.idea || "",
    user_id: userId(),
    status: "scored",
    origin_insights: Array.isArray(idea?.origin_insights) ? idea.origin_insights : [],
    dfv_desirability: num(r?.desirability?.score),
    dfv_feasibility: num(r?.feasibility?.score),
    dfv_viability: num(r?.viability?.score),
    market_size: null,
    opportunity_notes: null,
    dfv_detail: idea?.results ?? null,
    source: "dfv-screen",
    screened_at: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return send(res, 405, { error: { message: "Method not allowed" } });
  }
  if (!originAllowed(req)) {
    return send(res, 403, { error: { message: "Forbidden origin" } });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    if (e instanceof PayloadTooLarge) {
      return send(res, 413, { error: { message: "Request body too large" } });
    }
    return send(res, 400, { error: { message: "Invalid JSON body" } });
  }

  const idea = body?.idea;
  if (!idea || typeof idea !== "object") {
    return send(res, 400, { error: { message: "Body must be { idea: {...} }" } });
  }

  const record = toLedgerIdea(idea);
  if (!record.title) {
    return send(res, 400, { error: { message: "Idea has no title/summary" } });
  }

  try {
    const path = resolve(inboxPath());
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(record) + "\n", "utf8");
    return send(res, 200, { ok: true });
  } catch (err) {
    console.error("[api/ledger]", err);
    return send(res, 500, { error: { message: "Could not write to the ledger inbox." } });
  }
}
