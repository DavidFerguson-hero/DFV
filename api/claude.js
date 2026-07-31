import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2000;

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
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // These agents return short JSON documents, so thinking is off to keep
      // the whole max_tokens budget available for the answer. To let the model
      // reason first, drop this line and raise MAX_TOKENS to ~8000.
      thinking: { type: "disabled" },
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
