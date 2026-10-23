import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

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
    proxy: {
      "/api/nearblocks": {
        target: "https://api-testnet.nearblocks.io",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nearblocks/, ""),
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
