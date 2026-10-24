import { defineConfig } from "@playwright/test";

// Con BASE_URL (smoke contra un despliegue) no se levanta servidor local.
const BASE_URL_EXTERNA = process.env.BASE_URL;

// Specs del recorrido que además se pasan a tamaño de tableta (tb-2). Las que ya recorren los tres tamaños por su cuenta repiten
// aquí, y es a propósito: el proyecto fija el viewport de todo lo demás.
const RECORRIDO_TABLETA =
  /(ritmo-pista|ayuda|como-se-juega|nombre-campeon|versionado-migracion|rankings-clasificacion|diagnostico|fragilidad|pistas-nuevas|mosaico|sin-red-externa|tarjeta-gancho|lienzo|icono-causa)\.spec\.ts$/;

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.(e2e|spec)\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  retries: 0,
  use: {
    serviceWorkers: "block",
    baseURL: BASE_URL_EXTERNA ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium" },
    { name: "tableta-vertical", testMatch: RECORRIDO_TABLETA, use: { viewport: { width: 820, height: 1180 } } },
    { name: "tableta-horizontal", testMatch: RECORRIDO_TABLETA, use: { viewport: { width: 1180, height: 820 } } },
  ],
  webServer: BASE_URL_EXTERNA
    ? undefined
    : { command: "npm run start", url: "http://127.0.0.1:3000", reuseExistingServer: true, timeout: 120000 },
});
