import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// Mirrors the rewrites in vercel.json so local dev/preview behaves like production.
const devProxy = {
  "/api/near-rpc": {
    target: "https://rpc.testnet.fastnear.com",
    changeOrigin: true,
    rewrite: () => "/",
  },
  "/api/nearblocks": {
    target: "https://api-testnet.nearblocks.io",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/nearblocks/, ""),
  },
};

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ["buffer", "process", "util", "stream", "crypto", "events"],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      buffer: "buffer",
      process: "process/browser",
    },
  },
  optimizeDeps: {
    include: ["buffer", "process"],
  },
  server: {
    port: 5173,
    host: true,
    proxy: devProxy,
  },
  preview: {
    proxy: devProxy,
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
