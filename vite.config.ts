import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

// dev only: POST /__save?name=<file> with an image body -> ../screenshots/<file> (frames of the canvas for refs/underlays)
function saveFrames(): Plugin {
  return {
    name: "save-frames",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__save", (req, res) => {
        const name = basename(new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "frame.png");
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const dir = resolve(__dirname, "../screenshots");
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, name), Buffer.concat(chunks));
          res.end("saved " + name);
        });
      });
    },
  };
}

// PORT comes from the preview launcher (.claude/launch.json, autoPort); default 5173
export default defineConfig({
  plugins: [react(), saveFrames()],
  base: "./",          // relative paths: works at the domain root (dev) and at /cozy-portfolio/ (GitHub Pages)
  server: { port: Number(process.env.PORT) || 5173, strictPort: !!process.env.PORT },
});
