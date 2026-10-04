import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist-electron/**",
    "release/**",
    "legacy/**",
    "next-env.d.ts",
    "scripts/**/*.mjs",
  ]),
]);

export default eslintConfig;
