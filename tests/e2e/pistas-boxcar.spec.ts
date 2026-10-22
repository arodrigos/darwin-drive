import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "pistas-boxcar-1";
const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];
const PISTAS = [
  { id: "acantilado", nombre: "El Acantilado" },
  { id: "recta", nombre: "La Recta" },
] as const;

type Estado = { rankings: Record<string, { distance: number }[]>; pistaEnCarrera: string | null };
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

async function abrir(page: Page, escenario: Record<string, unknown> = { vacio: true }) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

test("bx-1 las dos pistas se corren, su marca entra en su ranking y sigue tras recargar", async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 360, height: 640 });
  for (const p of PISTAS) {
    await abrir(page, { vacio: true, pista: p.id });
    await page.getByTestId("acceso-taller").click();
    await expect(page.getByTestId("selector-pista")).toContainText(p.nombre);
    await page.getByTestId("probar").click();
    await expect(page.getByTestId("pista")).toBeVisible();
    await expect.poll(async () => (await estado(page)).pistaEnCarrera).toBe(p.id);
    await page.getByTestId("ritmo-final").click();
    await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("tarjeta-fin")).toContainText(`Fin de la carrera · ${p.nombre}`);
    if (p.id === "recta") {
      await expect(page.getByTestId("fin-motivo")).toHaveText("¡Meta!");
      await expect(page.getByTestId("fin-distancia")).toContainText("5000,0");
      await expect(page.getByTestId("fin-tiempo")).toHaveText(/^\d+:\d\d,\d$/);
    }
    await page.screenshot({ path: `${DIR}/${ID}-fin-${p.id}-360x640.png` });
    await expect.poll(async () => (await estado(page)).rankings[p.id].length).toBe(1);
    const marca = (await estado(page)).rankings[p.id][0].distance;

    await page.reload();
    await page.waitForFunction(() => Boolean(window.__debug));
    await expect.poll(async () => (await estado(page)).rankings[p.id].length).toBe(1);
    expect((await estado(page)).rankings[p.id][0].distance).toBe(marca);
  }
});

test("bx-3 La Recta: coche de serie hasta la meta y ranking con su tiempo", async ({ page }) => {
  test.setTimeout(240_000);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, { vacio: true, pista: "recta" });
    await page.getByTestId("acceso-taller").click();
    await page.getByTestId("probar").click();
    await page.getByTestId("ritmo-final").click();
    await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("fin-motivo")).toHaveText("¡Meta!");
    await page.screenshot({ path: `${DIR}/${ID}-recta-meta-${t.w}x${t.h}.png` });
  }
});

test("bx-4 se ve qué hace cada pista: superficie, escalones y fichas en la guía", async ({ page }) => {
  test.setTimeout(240_000);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    for (const p of PISTAS) {
      await abrir(page, { vacio: true, pista: p.id });
      await page.getByTestId("acceso-taller").click();
      await page.getByTestId("probar").click();
      await expect(page.getByTestId("pista")).toBeVisible();
      await page.evaluate(() => window.__debug!.adelantarSimulacion(12));
      await page.screenshot({ path: `${DIR}/${ID}-pista-${p.id}-${t.w}x${t.h}.png` });
    }
    await abrir(page);
    await page.getByTestId("acceso-guia").click();
    await page.getByTestId("guia-ir-pistas").click();
    for (const p of PISTAS) {
      const ficha = page.getByTestId(`ficha-${p.id}`);
      await expect(ficha).toContainText(p.nombre);
      await expect(ficha).toContainText("Premia:");
    }
    await page.screenshot({ path: `${DIR}/${ID}-guia-fichas-${t.w}x${t.h}.png` });
  }
});
