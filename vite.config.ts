import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/star_rail_wiki/",
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
