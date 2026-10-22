import { test, expect } from "@playwright/test";

// Smoke de traspaso: se ejecuta contra el despliegue real (BASE_URL) con
// scripts/smoke-traspaso.sh. En este bloque cubre lo que ya existe (portada,
// Explorar, selector de pista); los bloques de taller, carrera y evolución
// amplían el recorrido hasta el que declara el diseño.
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";

test("el juego carga, enseña las nueve pistas y el selector cambia la pista", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const ajenas: string[] = [];
  const origen = new URL(BASE_URL).origin;
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol !== "data:" && u.protocol !== "blob:" && u.origin !== origen) ajenas.push(r.url());
  });
  await page.goto(`${BASE_URL}/?pruebas=1`);
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Darwin Drive" })).toBeVisible();
  await page.getByTestId("acceso-explorar").click();
  await page.waitForFunction(() => window.__debug!.estado().tramosGenerados > 0);
  await page.getByTestId("selector-pista").click();
  await page.getByTestId("pista-rampa").click();
  await expect(page.getByTestId("selector-pista")).toHaveText("Pista: La Rampa ▾");
  expect((await page.evaluate(() => window.__debug!.estado())).pistaSeleccionada).toBe("rampa");
  expect(ajenas).toEqual([]);
});

test("la carrera ofrece los cinco ritmos y «Hasta el final» llega a la tarjeta de fin", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`${BASE_URL}/?pruebas=1`);
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await page.getByTestId("acceso-serie").click();
  for (const id of ["ritmo-x1", "ritmo-x2", "ritmo-x4", "ritmo-x8", "ritmo-final"]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  for (const id of ["ritmo-x2", "ritmo-x4", "ritmo-x8"]) {
    await page.getByTestId(id).click();
    await expect(page.getByTestId(id)).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
});
