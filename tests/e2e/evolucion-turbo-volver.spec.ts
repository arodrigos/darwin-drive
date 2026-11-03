import { test, expect } from "@playwright/test";

// #156: en Turbo el panel de progreso (inset 0) quedaba por encima de la cabecera y «← Volver» no se podía tocar.
const TAMANOS = [
  { width: 360, height: 640 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
];

for (const t of TAMANOS) {
  test(`#156 en Evolución con Turbo «← Volver» se ve y se puede tocar a ${t.width}x${t.height}`, async ({ page }) => {
    await page.setViewportSize(t);
    await page.goto("/?pruebas=1");
    await page.waitForFunction(() => Boolean(window.__debug));
    await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true, evolucion: "demo-gen-8" }));
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__debug));
    await page.getByTestId("acceso-continuar").click();
    await expect(page.getByTestId("evolucion")).toBeVisible();
    await page.getByTestId("evo-ritmo-turbo").click();
    await expect(page.getByTestId("turbo-panel")).toBeVisible();
    const volver = page.getByTestId("volver");
    await expect(volver).toBeInViewport({ ratio: 1 });
    // El punto central del botón es el propio botón, no el panel de Turbo que lo tapaba.
    const encima = await volver.evaluate((b) => {
      const r = b.getBoundingClientRect();
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return e !== null && b.contains(e);
    });
    expect(encima).toBe(true);
    await volver.click({ timeout: 5_000 });
    await expect(page.getByTestId("evolucion")).toHaveCount(0);
  });
}
