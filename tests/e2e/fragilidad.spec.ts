import { test, expect, type Page } from "@playwright/test";

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
