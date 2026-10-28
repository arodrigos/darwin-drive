import { test, expect, type Page } from "@playwright/test";
import { esperarLatencia } from "./ayudas/latencia";
import { MOVIL } from "./tamano";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "medida-latencias-1";

async function abrir(page: Page, query: string) {
  await page.setViewportSize(MOVIL);
  await page.goto(`/?pruebas=1${query}`);
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
}

test("ml-1 abrir-pista trae trabajoMs > 0 y ≤ ms", async ({ page }) => {
  await abrir(page, "");
  const m = await esperarLatencia(page, "abrir-pista");
  expect(m.trabajoMs).toBeGreaterThan(0);
  expect(m.trabajoMs).toBeLessThanOrEqual(m.ms);
});

test("ml-2 el panel enseña las dos cifras y el veredicto de la última medida", async ({ page }) => {
  await abrir(page, "&rendimiento=1");
  await esperarLatencia(page, "abrir-pista");
  await page.getByTestId("ritmo-x4").click();
  const linea = page.locator("[data-testid=rend-latencias] li[data-evento=abrir-pista]").first();
  await expect(linea).toBeVisible();
  // El panel se refresca por eventos y por temporizador: se espera a que coincida con la última medida.
  await expect
    .poll(async () => {
      const ultima = await page.evaluate(() => window.__debug!.latencias().filter((l) => l.evento === "abrir-pista").at(-1)!);
      const texto = ((await linea.textContent()) ?? "").replace(/\s+/g, " ");
      const veredicto = ultima.ms <= 200 ? "✓" : "✗";
      const esperado = `abrir-pista · ${Math.round(ultima.ms)} ms · trabajo ${Math.round(ultima.trabajoMs)} ms ${veredicto}`;
      return texto.replace(/\./g, ",") === esperado.replace(/\./g, ",");
    })
    .toBe(true);
  const panel = await page.getByTestId("panel-rendimiento").boundingBox();
  for (const id of ["ritmo-x1", "ritmo-x4", "ritmo-final", "hud-distancia"]) {
    const c = (await page.getByTestId(id).boundingBox())!;
    const cruza = panel!.x < c.x + c.width && c.x < panel!.x + panel!.width && panel!.y < c.y + c.height && c.y < panel!.y + panel!.height;
    expect(cruza, `el panel no tapa ${id}`).toBe(false);
  }
  await page.screenshot({ path: `${DIR}/${ID}-panel-360x640.png` });
});

test("ml-2 sin ?rendimiento=1 el panel no existe", async ({ page }) => {
  await abrir(page, "");
  await expect(page.getByTestId("panel-rendimiento")).toHaveCount(0);
});
