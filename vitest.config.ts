import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "umbraco/OlavurEllefsen.Umbraco/App_Plugins/OlavurProjection/article-blocks.test.js",
      "umbraco/OlavurEllefsen.Umbraco/App_Plugins/OlavurProjection/backoffice-request.test.js",
      "umbraco/OlavurEllefsen.Umbraco/App_Plugins/OlavurProjection/native-article-blocks.test.js",
      "umbraco/OlavurEllefsen.Umbraco/App_Plugins/OlavurProjection/native-article-document.test.js",
      "umbraco/OlavurEllefsen.Umbraco/App_Plugins/OlavurProjection/native-home-document.test.js",
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
