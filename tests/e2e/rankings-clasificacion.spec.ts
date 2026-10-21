import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "clasificacion-10";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

async function abrir(page: Page, rankings: string) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((r) => window.__debug!.cargarEscenario({ rankings: r }), rankings);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("tarjeta-cordillera").click();
  await expect(page.getByTestId("rankings")).toBeVisible();
}

test("cla-3 los empates enseñan tiempo, estado e insignia de la clave que decide", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, "demo-empates");
  await expect(page.getByTestId("fila-ranking")).toHaveCount(6);
  // 3000 pasos son 50,0 s: el tiempo sale del paso de la marca, no de la fecha.
  await expect(page.getByTestId("fila-tiempo").first()).toContainText("0:50,0");
  const insignias = page.getByTestId("fila-insignia");
  expect(await insignias.count()).toBeGreaterThanOrEqual(3);
  await insignias.first().click();
  await expect(page.getByTestId("insignia-explicacion")).toBeVisible();
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${DIR}/${ID}-empates-${t.w}x${t.h}.png` });
  }
});

test("cla-8 los límites (5000 m, 40 caracteres, 8 piezas, pendiente) no desbordan en ningún tamaño", async ({ page }) => {
  await abrir(page, "demo-limites");
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByTestId("fila-ranking").first()).toBeVisible();
    await page.screenshot({ path: `${DIR}/${ID}-limites-${t.w}x${t.h}.png` });
  }
});
