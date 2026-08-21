// Samostatný config pre testy.
//
// Zámerne nerozširuje `vite.config.ts` — ten beží cez obal
// `@lovable.dev/vite-tanstack-config`, ktorý si pridáva vlastné pluginy a pred
// ručnými zásahmi varuje. Testy z nich nič nepotrebujú, stačí im alias `@`.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
