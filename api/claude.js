import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2000;

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
  for await (const chunk of req) chunks.push(chunk);
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

  let system, user;
  try {
    ({ system, user } = await readJsonBody(req));
  } catch {
    return send(res, 400, { error: { message: "Invalid JSON body" } });
  }

  if (typeof system !== "string" || typeof user !== "string" || !user.trim()) {
    return send(res, 400, {
      error: { message: "Body must be { system: string, user: string }" },
    });
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
