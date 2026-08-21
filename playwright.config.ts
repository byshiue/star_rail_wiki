import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:4173/star_rail_wiki/",
  },
  webServer: {
    command: "npm run build && npm exec vite preview -- --host 127.0.0.1",
    url: "http://127.0.0.1:4173/star_rail_wiki/",
    reuseExistingServer: !process.env.CI,
  },
});
