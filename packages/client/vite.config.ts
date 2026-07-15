import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), Icons({ compiler: "jsx", jsx: "react" })],
  server: {
    port: 5173,
    proxy: {
      // SSE (sync stream) rides plain HTTP through this proxy fine, no ws needed.
      "/api": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
});
