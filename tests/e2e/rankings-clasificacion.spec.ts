import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { tamanoBase } from "./tamano";

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
  await tamanoBase(page);
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

for (const t of TAMANOS) {
  test(`cla-5 la bandera a cuadros marca la meta de 5000 m y la llana de pruebas no aparece en ningún listado (${t.w}x${t.h})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: t.w, height: t.h });
    await page.goto("/?pruebas=1");
    await page.waitForFunction(() => Boolean(window.__debug));
    await page.evaluate(() => window.__debug!.cargarEscenario({ pista: "pruebas-llana" }));
    await page.getByTestId("acceso-taller").click();
    await page.getByTestId("probar").click();
    await expect(page.getByTestId("pista")).toBeVisible();
    await page.getByTestId("ritmo-final").click();
    await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
    // La carrera ha corrido en la llana (no en La Cordillera) y acaba en meta.
    await expect(page.getByTestId("fin-motivo")).toContainText("Meta");
    await expect(page.getByTestId("fin-distancia")).toHaveText("5000,0 m");
    const metaX = await page.evaluate(() => (window.__debug!.estado() as unknown as { metaX: number | null }).metaX);
    expect(metaX).not.toBeNull();
    expect(metaX!).toBeGreaterThanOrEqual(0);
    expect(metaX!).toBeLessThanOrEqual(t.w);
    await page.screenshot({ path: `${DIR}/${ID}-meta-${t.w}x${t.h}.png` });
    // cla-10: sin rastro de la pista de pruebas en selectores, Rankings ni Especies.
    await page.getByTestId("volver-fin").click();
    const html = await page.content();
    expect(html).not.toContain("pruebas-llana");
    expect(html).not.toContain("Llana de pruebas");
  });
}

test("cla-7-b / cla-10 una copia con marcas inválidas se importa, queda pendiente y se vuelve a medir", async ({ page }) => {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => m.type() === "error" && errores.push(m.text()));
  const copia = readFileSync("tests/fixtures/copia-valores-invalidos.json");
  await tamanoBase(page);
  await page.goto("/?pruebas=1&migracion=frenada");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-garaje").click();
  await expect(page.getByTestId("garaje")).toBeVisible();
  await page.getByTestId("copia-fichero").setInputFiles({ name: "copia.json", mimeType: "application/json", buffer: copia });
  await page.getByTestId("copia-reemplazar").click();
  await expect(page.getByTestId("copia-ok")).toContainText("Copia importada");
  await expect(page.getByText("Este fichero no es una copia de Darwin Drive")).toHaveCount(0);

  // Recarga con la migración frenada: se ven las marcas pendientes de volver a medir.
  await page.goto("/?pruebas=1&migracion=frenada");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("tarjeta-cordillera").click();
  await expect(page.getByTestId("rankings")).toBeVisible();
  await expect(page.getByTestId("fila-ranking")).toHaveCount(9);
  await expect(page.getByTestId("fila-migracion")).toHaveCount(7);
  await expect(page.getByTestId("fila-migracion").first()).toHaveText("actualizando…");
  // La de 5000 m trae un bestStep de 1: tiene tiempo, pero no es creíble y también se vuelve a medir.
  await expect(page.getByTestId("fila-tiempo").filter({ hasText: "—" })).toHaveCount(6);
  await page.screenshot({ path: `${DIR}/${ID}-copia-pendiente-360x640.png` });

  // La migración completa con la física real no cabe en el tiempo de un e2e en el runner: su resultado (valores
  // válidos y orden) lo prueba copia.test.ts con una medida determinista.
  // «pruebas-llana» no llega a ninguna parte del estado guardado.
  const claves = await page.evaluate(() => JSON.stringify((window.__debug!.estado() as unknown as { rankings: unknown }).rankings));
  expect(claves).not.toContain("pruebas-llana");
  expect(errores).toEqual([]);
});
