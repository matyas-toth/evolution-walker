import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypeScript from "eslint-config-next/typescript"

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "src/generated/**",
    "src-wasm/**/target*/**",
  ]),
  {
    rules: {
      // These React Compiler advisory rules are not correctness gates until the
      // application opts into compiler transforms. The Rules of Hooks remain on.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}", "scripts/**/*.mjs"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["src/app/showcase/**/*.{ts,tsx}"],
    rules: {
      // Showcase pages are presentation-only thesis material and intentionally
      // keep self-contained animation lifecycles outside the tested app core.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
])
