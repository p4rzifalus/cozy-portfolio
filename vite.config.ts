import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// PORT comes from the preview launcher (.claude/launch.json, autoPort); default 5173
export default defineConfig({
  plugins: [react()],
  base: "./",          // relative paths: works at the domain root (dev) and at /cozy-portfolio/ (GitHub Pages)
  server: { port: Number(process.env.PORT) || 5173, strictPort: !!process.env.PORT },
});
