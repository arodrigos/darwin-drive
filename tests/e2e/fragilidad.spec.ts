import { test, expect, type Page } from "@playwright/test";
import { tamanoBase } from "./tamano";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "fragilidad-26";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Estado = { piezas: number; sueltas: number; destellos: number };
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

async function abrir(page: Page, escenario: Record<string, unknown>) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e as never), escenario);
}

test("fra-1 el coche demo-fragil pierde piezas en La Cordillera y la pista las enseña", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, { vacio: true, genoma: "demo-fragil", pista: "cordillera" });
    await page.getByTestId("acceso-taller").click();
    await page.getByTestId("probar").click();
    await expect(page.getByTestId("pista")).toBeVisible();
    await page.getByTestId("ritmo-x1").click();
    expect((await estado(page)).piezas).toBe(255);
    await page.screenshot({ path: `${DIR}/${ID}-entero-${t.w}x${t.h}.png` });
    // La rotura es a ~247 m: se avanza a trozos hasta que la máscara pierde algún triángulo.
    for (let k = 0; k < 12 && (await estado(page)).piezas === 255; k++) {
      await page.evaluate(() => window.__debug!.adelantarSimulacion(5));
    }
    const e = await estado(page);
    expect(e.piezas).not.toBe(255);
    await page.screenshot({ path: `${DIR}/${ID}-roto-${t.w}x${t.h}.png` });
  }
});

test("fra-12 la tarjeta de fin cuenta las piezas perdidas y cabe a los tres tamaños", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, { vacio: true, genoma: "demo-fragil", pista: "cordillera" });
    await page.getByTestId("acceso-taller").click();
    await page.getByTestId("probar").click();
    await page.getByTestId("ritmo-final").click();
    await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("fin-piezas")).toContainText(/Perdió \d+ piezas? \(la primera a los/);
    const caja = await page.getByTestId("tarjeta-fin").boundingBox();
    expect(caja!.y + caja!.height).toBeLessThanOrEqual(t.h);
    expect(caja!.width).toBeLessThanOrEqual(t.w);
    await page.screenshot({ path: `${DIR}/${ID}-tarjeta-${t.w}x${t.h}.png` });
  }
});

test("fra-11 la tarjeta de un coche destrozado lo explica a los tres tamaños", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, { vacio: true, genoma: "demo-fragil", pista: "cordillera" });
    await page.getByTestId("acceso-taller").click();
    await page.getByTestId("probar").click();
    await page.getByTestId("ritmo-final").click();
    await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
    // Sin hallar un genoma que se destroce de verdad en pista, se repinta la tarjeta con ese final (no toca lo guardado).
    await page.evaluate(() => window.__debug!.forzarTarjetaFin({ reason: "destrozado" }));
    await expect(page.getByTestId("fin-causa")).toContainText("Se rompió en pedazos");
    const caja = await page.getByTestId("tarjeta-fin").boundingBox();
    expect(caja!.y + caja!.height).toBeLessThanOrEqual(t.h);
    await page.screenshot({ path: `${DIR}/${ID}-destrozado-${t.w}x${t.h}.png` });
  }
});

test("fra-9 con 32 coches a ×8 y el dispositivo lento, un toque responde en ≤ 200 ms", async ({ page }) => {
  await tamanoBase(page);
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true, evolucion: "demo-gen-8" }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-continuar").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await page.getByTestId("evo-ritmo-x8").click();
  await page.evaluate(() => window.__debug!.limitarRitmo(5));
  await expect(page.getByTestId("ritmo-real")).toHaveText("real ×1,7", { timeout: 10_000 });
  const ids = ["evo-ritmo-x4", "evo-ritmo-x8", "evo-ritmo-x2", "evo-ritmo-x8", "evo-ritmo-x4"];
  for (const id of ids) await page.getByTestId(id).click();
  await page.screenshot({ path: `${DIR}/${ID}-32-coches-x8-360x640.png` });
  const lat = await page.evaluate(() => window.__debug!.latencias().filter((l) => l.evento === "ritmo").map((l) => l.ms));
  expect(lat.length).toBeGreaterThanOrEqual(5);
  expect(Math.max(...lat)).toBeLessThanOrEqual(200);
});
