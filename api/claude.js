import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2000;

// One analysis is 3 calls plus 1 clarification, so 20/min leaves room for
// normal use (~5 analyses) while capping what a scripted abuser can spend.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

// Caps on what a caller can push into the prompt. Without these, one request
// can carry an arbitrarily large `user` string and bill you for the tokens.
const MAX_SYSTEM_CHARS = 8_000;
const MAX_USER_CHARS = 20_000;
const MAX_BODY_BYTES = 64 * 1024;

class PayloadTooLarge extends Error {}

// NOTE: this map is per warm serverless instance, not global. Under
// concurrency the effective limit is (instances x RATE_LIMIT_MAX), and it
// resets on cold start. It stops casual scripted abuse; it is not a hard
// quota. For that, use Vercel's platform rate limiting or a shared store
// (Upstash/Redis) keyed the same way.
const hits = new Map();

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) {
    for (const [key, times] of hits) {
      if (!times.some((t) => now - t < RATE_LIMIT_WINDOW_MS)) hits.delete(key);
    }
  }
  return false;
}

// Blocks other websites from pointing their front end at this endpoint.
// A missing Origin (curl, server-to-server) is allowed through and left to
// the rate limiter — this is a cross-site control, not authentication.
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const { host } = new URL(origin);
    const allowed = process.env.ALLOWED_ORIGIN;
    if (allowed) return origin === allowed;
    return host === req.headers.host;
  } catch {
    return false;
  }
}

// Built once per warm container, not per request, so the underlying HTTPS
// connection pool is reused and repeat calls skip the TLS handshake.
// The SDK default timeout is 10 minutes with 2 retries — worst case ~30
// minutes of a user watching loading dots. 60s x 1 retry is plenty here.
let client;
function getClient(apiKey) {
  if (!client) {
    client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  }
  return client;
}

// Reads the body as JSON. Vercel pre-parses it onto req.body; the Vite dev
// middleware does not, so fall back to draining the stream.
async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    // Bail during the read rather than buffering an unbounded upload.
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return send(res, 405, { error: { message: "Method not allowed" } });
  }

  if (!originAllowed(req)) {
    return send(res, 403, { error: { message: "Forbidden origin" } });
  }

  if (rateLimited(clientIp(req))) {
    res.setHeader("Retry-After", String(RATE_LIMIT_WINDOW_MS / 1000));
    return send(res, 429, {
      error: { message: "Too many requests — wait a minute and try again." },
    });
  }

  let system, user;
  try {
    ({ system, user } = await readJsonBody(req));
  } catch (e) {
    if (e instanceof PayloadTooLarge) {
      return send(res, 413, { error: { message: "Request body too large" } });
    }
    return send(res, 400, { error: { message: "Invalid JSON body" } });
  }

  if (typeof system !== "string" || typeof user !== "string" || !user.trim()) {
    return send(res, 400, {
      error: { message: "Body must be { system: string, user: string }" },
    });
  }

  if (system.length > MAX_SYSTEM_CHARS || user.length > MAX_USER_CHARS) {
    return send(res, 413, { error: { message: "Prompt too large" } });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return send(res, 500, {
      error: { message: "ANTHROPIC_API_KEY is not set on the server." },
    });
  }

  try {
    const message = await getClient(apiKey).messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // These agents return short JSON documents, so thinking is off to keep
      // the whole max_tokens budget available for the answer. To let the model
      // reason first, drop this line and raise MAX_TOKENS to ~8000.
      thinking: { type: "disabled" },
      // Effort defaults to "high". These prompts are tightly specified and the
      // output shape is fixed, so "high" buys little and costs latency on
      // every one of the three parallel analysis calls. Raise to "high" if
      // analysis quality drops.
      output_config: { effort: "medium" },
      system,
      messages: [{ role: "user", content: user }],
    });

    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    return send(res, 200, { text, stop_reason: message.stop_reason });
  } catch (err) {
    // Log server-side; return only a safe message to the browser.
    console.error("[api/claude]", err);
    const status = err?.status ?? 500;
    const message =
      err instanceof Anthropic.APIError
        ? err.message
        : "Upstream request to the Claude API failed.";
    return send(res, status, { error: { message } });
  }
}
