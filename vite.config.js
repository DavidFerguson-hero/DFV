import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Mounts the api/* serverless functions on the dev server so `npm run dev`
// behaves like production. In production Vercel serves /api/* itself and this
// plugin is not involved.
function apiDevServer(env) {
  const mount = (server, route, modulePath, envKeys = []) =>
    server.middlewares.use(route, async (req, res) => {
      try {
        for (const key of envKeys) process.env[key] ||= env[key];
        const mod = await server.ssrLoadModule(modulePath);
        await mod.default(req, res);
      } catch (err) {
        server.ssrFixStacktrace?.(err);
        console.error("[api-dev-server]", err);
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: { message: "Dev API handler failed" } }));
      }
    });

  return {
    name: "api-dev-server",
    configureServer(server) {
      mount(server, "/api/claude", "/api/claude.js", ["ANTHROPIC_API_KEY"]);
      mount(server, "/api/ledger", "/api/ledger.js", ["LEDGER_INBOX", "DFV_USER_ID", "ALLOWED_ORIGIN"]);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Third arg "" loads all vars, not just VITE_-prefixed ones. The key is used
  // only inside the Node-side plugin above, so it never reaches the bundle.
  const env = loadEnv(mode, process.cwd(), "");
  return { plugins: [react(), apiDevServer(env)] };
});
