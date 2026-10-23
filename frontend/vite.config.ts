import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Avoid browser CORS when talking to NearBlocks testnet indexer
      "/api/nearblocks": {
        target: "https://api-testnet.nearblocks.io",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nearblocks/, ""),
      },
    },
  },
});
