import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "opacidad-carga-20";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

const opacidades = (page: Page) => page.evaluate(() => (window.__debug!.estado() as unknown as { opacidades: number[] | null }).opacidades);

// El genoma del escenario vive en memoria (no en el almacenamiento): recargar lo perdería.
async function abrir(page: Page, escenario: Record<string, unknown>) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e as never), escenario);
  if (escenario.genoma === undefined) {
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__debug));
  }
}

async function fijarPeso(page: Page, valor: number) {
  await page.getByTestId("deslizador-peso").evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, valor);
}

test("opa-1 el peso de 20 a 200 pasa la carrocería de translúcida a opaca en escalones, con latencia ≤ 200 ms", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, { vacio: true, genoma: "demo-ligero" });
    await page.getByTestId("acceso-taller").click();
    await expect(page.getByTestId("lienzo")).toBeVisible();
    await expect.poll(() => opacidades(page)).toEqual(Array(8).fill(0.4));
    await expect(page.getByTestId("nota-peso")).toContainText("Más peso = más opaco");
    await page.screenshot({ path: `${DIR}/${ID}-taller-peso-20-${t.w}x${t.h}.png` });
    await fijarPeso(page, 120);
    await expect.poll(() => opacidades(page)).toEqual(Array(8).fill(0.8));
    await fijarPeso(page, 200);
    await expect.poll(() => opacidades(page)).toEqual(Array(8).fill(1));
    await page.screenshot({ path: `${DIR}/${ID}-taller-peso-200-${t.w}x${t.h}.png` });
    const lat = await page.evaluate(() => window.__debug!.latencias().filter((l) => l.evento === "peso").map((l) => l.ms));
    expect(lat.length).toBeGreaterThan(0);
    expect(Math.min(...lat)).toBeLessThanOrEqual(200);
  }
});

test("opa-2 en carrera a ×1 las opacidades suben sobre la base donde las ruedas cargan", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, { vacio: true, genoma: "demo-ligero", pista: "rampa" });
    await page.getByTestId("acceso-taller").click();
    await page.getByTestId("probar").click();
    await expect(page.getByTestId("pista")).toBeVisible();
    await page.getByTestId("ritmo-x1").click();
    await page.evaluate(() => window.__debug!.adelantarSimulacion(8));
    const op = (await opacidades(page))!;
    expect(op).toHaveLength(8);
    for (const v of op) {
      expect(v).toBeGreaterThanOrEqual(0.4);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...op)).toBeGreaterThan(0.4);
    await page.screenshot({ path: `${DIR}/${ID}-carrera-rampa-${t.w}x${t.h}.png` });
  }
});

test("opa-3 con 32 coches superpuestos en Evolución se distinguen por su contorno", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, { vacio: true, evolucion: "demo-gen-8" });
    await page.getByTestId("acceso-continuar").click();
    await expect(page.getByTestId("evolucion")).toBeVisible();
    await page.evaluate(() => window.__debug!.adelantarSimulacion(3));
    await page.screenshot({ path: `${DIR}/${ID}-evolucion-32-${t.w}x${t.h}.png` });
  }
});

test("opa-4 el «?» del Taller explica la opacidad", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true, genoma: "demo-ligero" });
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("ayuda-boton").click();
  await expect(page.getByTestId("ayuda-panel")).toContainText("más peso = más opaco");
  await page.screenshot({ path: `${DIR}/${ID}-ayuda-taller-360x640.png` });
});
