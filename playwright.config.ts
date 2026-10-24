import { defineConfig } from "@playwright/test";

// Con BASE_URL (smoke contra un despliegue) no se levanta servidor local.
const BASE_URL_EXTERNA = process.env.BASE_URL;

// Specs del recorrido que además se pasan a tamaño de tableta (tb-2). Solo las de un único tamaño: las que ya recorren los tres
// por su cuenta (diagnostico, mosaico, tarjeta-gancho, icono-causa, como-se-juega...) no ganan nada repitiéndose, y con todas
// el job pasaba de los 40 min.
const RECORRIDO_TABLETA = /(ritmo-pista|ayuda|nombre-campeon|sin-red-externa|lienzo)\.spec\.ts$/;

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
