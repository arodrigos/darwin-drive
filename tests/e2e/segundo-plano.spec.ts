import { test, expect, type Page } from "@playwright/test";
import { STOCK_CAR } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "ritmo-pista-1";

type Estado = { tiempoSim: number | null; ritmo: string | null; generacion: number | null; ultimoResultado: { distance: number } | null };
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

test.setTimeout(120_000);

async function abrir(page: Page, escenario: Record<string, unknown>) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

async function visibilidad(page: Page, estadoVis: "hidden" | "visible") {
  await page.evaluate((v) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => v === "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, estadoVis);
}

/** Oculta la página, la congela `ms` (el navegador la suspende de verdad) y la devuelve a visible. */
async function irseYVolver(page: Page, ms: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  await visibilidad(page, "hidden");
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise((r) => setTimeout(r, ms));
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await visibilidad(page, "visible");
}

test("rit-13 Pista a ×1: tras 30 s oculta y congelada sigue en los mismos metros, sin error, y acaba con la marca de Node", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true });
  await page.getByTestId("acceso-serie").click();
  await expect.poll(async () => (await estado(page)).tiempoSim ?? 0).toBeGreaterThan(2);
  await page.screenshot({ path: `${DIR}/${ID}-antes-ocultar-360x640.png` });
  const antes = (await estado(page)).tiempoSim!;
  await irseYVolver(page, 30_000);
  const despues = await estado(page);
  expect(despues.tiempoSim!).toBeLessThan(antes + 0.5);
  expect(despues.ritmo).toBe("x1");
  await expect(page.getByTestId("ritmo-x1")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("error-simulacion")).toBeHidden();
  await expect.poll(async () => (await estado(page)).tiempoSim!, { timeout: 5000 }).toBeGreaterThan(despues.tiempoSim! + 0.3);
  await page.screenshot({ path: `${DIR}/${ID}-despues-volver-360x640.png` });
  await page.evaluate(() => window.__debug!.adelantarSimulacion(900));
  expect((await estado(page)).ultimoResultado!.distance).toBe(simulateCar(STOCK_CAR, "cordillera").distance);
});

test("rit-13 «Hasta el final»: al volver sigue la banda y termina con la misma marca", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true });
  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await expect.poll(async () => (await estado(page)).tiempoSim ?? 0).toBeGreaterThan(0.2);
  await page.getByTestId("ritmo-final").click();
  await irseYVolver(page, 3000);
  await expect(page.getByTestId("error-simulacion")).toBeHidden();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 60_000 });
  expect((await estado(page)).ultimoResultado!.distance).toBe(simulateCar(STOCK_CAR, "cordillera").distance);
});

test("rit-13 Evolución: la generación no retrocede y el ritmo sigue resaltado", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true, evolucion: "demo-gen-8" });
  await page.getByTestId("acceso-continuar").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await page.getByTestId("evo-ritmo-x2").click();
  await expect.poll(async () => (await estado(page)).tiempoSim ?? 0).toBeGreaterThan(1);
  const gen = (await estado(page)).generacion!;
  await irseYVolver(page, 3000);
  expect((await estado(page)).generacion!).toBeGreaterThanOrEqual(gen);
  await expect(page.getByTestId("evo-ritmo-x2")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("error-simulacion")).toBeHidden();
});

test("rit-13 si la carrera ya había terminado, al volver se ve su tarjeta", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true });
  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await expect.poll(async () => (await estado(page)).tiempoSim ?? 0).toBeGreaterThan(0.2);
  await page.evaluate(() => window.__debug!.adelantarSimulacion(900));
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible();
  await irseYVolver(page, 1000);
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible();
});
