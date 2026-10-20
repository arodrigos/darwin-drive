import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "especies-24";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

const adelantar = (page: Page, s: number) => page.evaluate((x) => window.__debug!.adelantarSimulacion(x), s);

async function abrir(page: Page, escenario: Record<string, unknown> = { vacio: true }) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

const llenas = (page: Page) => page.locator('[data-testid^="celda-"][data-llena="1"]');

test("es-2 la pantalla explica qué es cada casilla y cuántas hay descubiertas", async ({ page }) => {
  await abrir(page);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await page.getByTestId("acceso-especies").click();
    await expect(page.getByTestId("especies")).toBeVisible();
    await expect(page.getByTestId("ayuda-especies")).toContainText("Cada casilla es una especie");
    await expect(page.getByTestId("contador-especies")).toHaveText("Lote 0 · 0/16 especies descubiertas en La Cordillera");
    await expect(page.locator('[data-testid^="celda-"]')).toHaveCount(16);
    await expect(llenas(page)).toHaveCount(0);
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(ancho).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${DIR}/${ID}-vacia-${t.w}x${t.h}.png` });
    await page.getByTestId("volver").click();
    await expect(page.getByTestId("portada")).toBeVisible();
  }
});

test("es-3 explorar corre un lote, descubre especies, responde en ≤200 ms y se guarda", async ({ page }) => {
  await abrir(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.getByTestId("acceso-especies").click();
  await page.getByTestId("explorar-especies").click();
  await expect(page.getByTestId("progreso-especies")).toBeVisible();
  await page.screenshot({ path: `${DIR}/${ID}-explorando-360x640.png` });
  await expect
    .poll(async () => {
      await adelantar(page, 200);
      return page.getByTestId("contador-especies").textContent();
    }, { timeout: 90_000 })
    .toMatch(/^Lote 1 · [1-9]\d*\/16 especies/);
  const lat = await page.evaluate(() => window.__debug!.latencias().filter((l) => l.evento === "explorar-especies"));
  expect(lat.length).toBeGreaterThan(0);
  expect(lat[lat.length - 1]!.ms).toBeLessThanOrEqual(200);
  const descubiertas = await llenas(page).count();
  expect(descubiertas).toBeGreaterThan(0);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-especies").click();
  await expect(llenas(page)).toHaveCount(descubiertas);
  await expect(page.getByTestId("contador-especies")).toContainText("Lote 1 ·");
});

test("es-4 una casilla descubierta se ve, se abre y se puede guardar o llevar al taller", async ({ page }) => {
  await abrir(page, { vacio: true, especies: "demo" });
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await page.getByTestId("acceso-especies").click();
    const n = await llenas(page).count();
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThan(16);
    await expect(page.getByTestId("celda-metros").first()).toContainText(" m");
    await page.screenshot({ path: `${DIR}/${ID}-rejilla-${t.w}x${t.h}.png` });
    await llenas(page).first().click();
    await expect(page.getByTestId("hoja-especie")).toBeVisible();
    await page.screenshot({ path: `${DIR}/${ID}-hoja-${t.w}x${t.h}.png` });
    await page.getByTestId("especie-cerrar").click();
    await page.getByTestId("volver").click();
  }
  await page.getByTestId("acceso-especies").click();
  await llenas(page).first().click();
  await page.getByTestId("especie-guardar").click();
  await expect(page.getByTestId("aviso-especies")).toContainText("Guardado");
  expect((await page.evaluate(() => window.__debug!.estado())).garaje).toBe(1);
  await page.getByTestId("especie-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
});
