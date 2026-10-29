import { test, expect, type Page } from "@playwright/test";
import { esperarLatencia } from "./ayudas/latencia";
import { MOVIL } from "./tamano";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "probar-rapida-1";

async function abrir(page: Page, query = "") {
  await page.setViewportSize(MOVIL);
  await page.goto(`/?pruebas=1${query}`);
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.waitForFunction(() => window.__debug!.motor().listo, undefined, { timeout: 15_000 });
  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
}

test("probar-2 el precalentamiento arranca después de cerrar abrir-pista", async ({ page }) => {
  // La escena se calienta una sola vez por juego: la marca se compara con la primera apertura.
  await abrir(page);
  const m = await esperarLatencia(page, "abrir-pista", { maxPintado: null });
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByName("dd:precalentar:inicio").length), { message: "marca de precalentar" })
    .toBeGreaterThan(0);
  const inicio = await page.evaluate(() => performance.getEntriesByName("dd:precalentar:inicio")[0].startTime);
  expect(inicio).toBeGreaterThanOrEqual(m.t);
});

test("probar-1 la primera «Probar» mide hasta el fotograma pintado y no pierde contra las siguientes", async ({ page }) => {
  test.setTimeout(90_000);
  await abrir(page);
  await page.waitForTimeout(1500);
  const veces: number[] = [];
  for (let i = 0; i < 2; i++) {
    await page.getByTestId("volver").click();
    await page.getByTestId("acceso-taller").click();
    await page.getByTestId("probar").click();
    await expect(page.getByTestId("pista")).toBeVisible();
    const m = await esperarLatencia(page, "probar", { maxPintado: null });
    expect(m.ms).toBeGreaterThanOrEqual(m.trabajoMs);
    veces.push(m.trabajoMs);
    if (i === 0) await page.getByTestId("volver").click();
  }
  // Holgura amplia: en el CI el dibujo es por software; lo que se vigila es que la primera no sea un orden de magnitud peor.
  expect(veces[0]).toBeLessThanOrEqual(veces[1] * 1.25 + 120);
});

test("probar-3 con el hilo ocupado la línea «probar» del panel sale lenta y con ✗", async ({ page }) => {
  test.setTimeout(90_000);
  await abrir(page, "&rendimiento=1");
  // Un fotograma de 260 ms de hilo ocupado imita un equipo lento: limitarFps no retrasa el primer dibujo.
  await page.evaluate(() => {
    const ocupar = () => {
      const fin = performance.now() + 260;
      while (performance.now() < fin);
      requestAnimationFrame(ocupar);
    };
    requestAnimationFrame(ocupar);
  });
  await page.getByTestId("volver").click();
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("probar").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  const linea = page.locator("[data-testid=rend-latencias] li[data-evento=probar]").first();
  await expect(linea).toBeVisible({ timeout: 15_000 });
  await expect(linea).toHaveClass(/lenta/);
  await expect(linea).toContainText("✗");
  await page.screenshot({ path: `${DIR}/${ID}-panel-lento-360x640.png` });
});

test("probar-4 entrar y salir de la pista no deja juegos ni contextos de más", async ({ page }) => {
  test.setTimeout(90_000);
  await abrir(page);
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(400);
    await page.getByTestId("volver").click();
    await page.getByTestId("acceso-serie").click();
    await expect(page.getByTestId("pista")).toBeVisible();
  }
  const e = await page.evaluate(() => ({ m: window.__debug!.motor(), ctx: window.__debug!.estado().contextosWebgl }));
  expect(e.m.juegosVivos).toBe(1);
  expect(e.ctx).toBe(1);
});
