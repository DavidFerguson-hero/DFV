import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Mounts api/claude.js on the dev server so `npm run dev` behaves like the
// deployed serverless function. In production Vercel serves /api/* itself and
// this plugin is not involved.
function apiDevServer(env) {
  return {
    name: "api-dev-server",
    configureServer(server) {
      server.middlewares.use("/api/claude", async (req, res) => {
        try {
          process.env.ANTHROPIC_API_KEY ||= env.ANTHROPIC_API_KEY;
          const mod = await server.ssrLoadModule("/api/claude.js");
          await mod.default(req, res);
        } catch (err) {
          server.ssrFixStacktrace?.(err);
          console.error("[api-dev-server]", err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: { message: "Dev API handler failed" } }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Third arg "" loads all vars, not just VITE_-prefixed ones. The key is used
  // only inside the Node-side plugin above, so it never reaches the bundle.
  const env = loadEnv(mode, process.cwd(), "");
  return { plugins: [react(), apiDevServer(env)] };
});
