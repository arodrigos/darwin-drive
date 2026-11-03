import { test, expect } from "@playwright/test";

// #161: el aviso fijo del Garaje tapaba los botones de debajo (360x640: los del tercer coche; tabletas: la copia de
// seguridad) y no decía que se cierra al tocarlo.
const TAMANOS = [
  { width: 360, height: 640 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
];

test.setTimeout(120_000);

for (const t of TAMANOS) {
  test(`#161 con el aviso del Garaje a la vista todos los botones se pueden subir por encima de él a ${t.width}x${t.height}`, async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: t });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:3000" }).catch(() => {});
    const page = await ctx.newPage();
    await page.goto("/?pruebas=1");
    await page.waitForFunction(() => Boolean(window.__debug));
    await page.evaluate(() => window.__debug!.cargarEscenario({ garaje: 3 }));
    await page.getByTestId("acceso-garaje").click();
    await expect(page.getByTestId("garaje")).toBeVisible();
    await page.getByTestId("garaje-compartir").nth(2).click();
    await expect(page.getByTestId("aviso-garaje")).toContainText("Código copiado");
    await expect(page.getByTestId("aviso-garaje-cerrar")).toHaveText("Toca para cerrar");
    await expect(page.getByTestId("aviso-garaje-caja")).toBeInViewport();

    // Cada botón del garaje, desplazado lo justo para quedar encima del aviso, no se cruza con él.
    const tapados = await page.evaluate(() => {
      const garaje = document.querySelector<HTMLElement>("[data-testid=garaje]")!;
      const aviso = document.querySelector<HTMLElement>("[data-testid=aviso-garaje-caja]")!;
      const fuera: string[] = [];
      for (const b of garaje.querySelectorAll<HTMLElement>("button")) {
        if (aviso.contains(b) || b.closest("[role=dialog],[role=alertdialog]")) continue;
        const limite = aviso.getBoundingClientRect().top - 4;
        const sobra = b.getBoundingClientRect().bottom - limite;
        if (sobra > 0) garaje.scrollTop += sobra;
        if (b.getBoundingClientRect().bottom > aviso.getBoundingClientRect().top) fuera.push(b.dataset.testid ?? b.textContent ?? "?");
      }
      return fuera;
    });
    expect(tapados).toEqual([]);
    for (const id of ["copia-exportar", "copia-importar"]) {
      await page.getByTestId(id).evaluate((b) => b.scrollIntoView({ block: "end" }));
      await page.evaluate(() => {
        const g = document.querySelector<HTMLElement>("[data-testid=garaje]")!;
        g.scrollTop = g.scrollHeight;
      });
      const [boton, aviso] = await Promise.all([page.getByTestId(id).boundingBox(), page.getByTestId("aviso-garaje-caja").boundingBox()]);
      expect(boton!.y + boton!.height).toBeLessThanOrEqual(aviso!.y);
    }

    // Tocarlo lo cierra y se va el hueco.
    await page.getByTestId("aviso-garaje-caja").click();
    await expect(page.getByTestId("aviso-garaje")).toHaveCount(0);
    await expect(page.getByTestId("hueco-aviso-garaje")).toHaveCount(0);
    await ctx.close();
  });
}
