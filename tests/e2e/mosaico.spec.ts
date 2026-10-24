import { test, expect, type Page } from "@playwright/test";
import { tamanoBase } from "./tamano";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "mosaico-1";
const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Estado = { rankings: Record<string, { distance: number; trackVersion?: number }[]>; pistaSeleccionada: string };
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

async function abrir(page: Page, escenario: Record<string, unknown> = { vacio: true, pista: "mosaico" }) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

test("mos-1 El Mosaico se elige, se prueba hasta el final y su marca sigue tras recargar", async ({ page }) => {
  test.setTimeout(240_000);
  await tamanoBase(page);
  await abrir(page);
  await page.getByTestId("acceso-taller").click();
  await expect(page.getByTestId("selector-pista")).toContainText("El Mosaico");
  await page.getByTestId("probar").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("tarjeta-fin")).toContainText("Fin de la carrera · El Mosaico");
  await expect.poll(async () => (await estado(page)).rankings.mosaico.length).toBe(1);
  const marca = (await estado(page)).rankings.mosaico[0].distance;

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await expect.poll(async () => (await estado(page)).rankings.mosaico.length).toBe(1);
  expect((await estado(page)).rankings.mosaico[0].distance).toBe(marca);
});

test("mos-3 el rótulo del tramo cambia al cruzar, mide ≥ 14 px y contrasta ≥ 4,5:1, en los tres tamaños", async ({ page }) => {
  test.setTimeout(400_000);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page);
    await page.getByTestId("acceso-taller").click();
    await page.getByTestId("probar").click();
    await expect(page.getByTestId("pista")).toBeVisible();
    const rotulo = page.getByTestId("rotulo-tramo");
    await expect(rotulo).toBeVisible();
    const inicial = await rotulo.textContent();
    await page.evaluate(() => window.__debug!.adelantarSimulacion(12));
    await expect.poll(async () => rotulo.textContent()).not.toBe(inicial);

    const estilo = await rotulo.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { px: parseFloat(cs.fontSize), color: cs.color, fondo: cs.backgroundColor };
    });
    expect(estilo.px).toBeGreaterThanOrEqual(14);
    // Peor caso: el fondo semitransparente sobre cielo blanco.
    const canal = (s: string) => s.match(/[\d.]+/g)!.map(Number);
    const [fr, fg, fb, fa = 1] = canal(estilo.fondo);
    const [r, g, b] = canal(estilo.color);
    const mezcla = [fr, fg, fb].map((c) => c * fa + 255 * (1 - fa));
    const lum = (v: number[]) => {
      const l = v.map((c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
    };
    const [hi, lo] = [lum([r, g, b]), lum(mezcla)].sort((p, q) => q - p);
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);

    // No se cruza con la cabecera ni con el contador.
    const caja = (await rotulo.boundingBox())!;
    const hud = (await page.getByTestId("hud-distancia").boundingBox())!;
    expect(caja.y).toBeGreaterThanOrEqual(hud.y + hud.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${DIR}/${ID}-rotulo-${t.w}x${t.h}.png` });
  }
});
