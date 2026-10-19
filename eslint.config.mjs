import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // andamiaje-3: sin escapatorias de tipado. eslint-config-next/typescript
    // ya trae estas reglas, pero como "warn" -- aquí se suben a "error" para
    // que el propio lint falle el build, no solo avise.
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },
  {
    // nf-8: el núcleo se ejecuta entero en Node.
    files: ["src/sim/**/*.ts", "src/evolution/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["phaser", "phaser/*", "react", "react/*", "react-dom", "react-dom/*", "next", "next/*"] },
      ],
      "no-restricted-globals": [
        "error",
        { name: "window", message: "El núcleo no toca el navegador." },
        { name: "document", message: "El núcleo no toca el navegador." },
        { name: "navigator", message: "El núcleo no toca el navegador." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
