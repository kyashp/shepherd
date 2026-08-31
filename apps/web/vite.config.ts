import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import istanbul from "vite-plugin-istanbul";

export default defineConfig({
  plugins: [
    react(),
    ...(process.env.VITE_COVERAGE === "true"
      ? [
          istanbul({
            include: "src/**/*",
            exclude: ["node_modules", "src/**/*.test.{ts,tsx}"],
            extension: [".ts", ".tsx"],
            requireEnv: false,
            forceBuildInstrument: true,
          }),
        ]
      : []),
  ],
  build: {
    sourcemap: process.env.VITE_COVERAGE === "true" ? "hidden" : false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
