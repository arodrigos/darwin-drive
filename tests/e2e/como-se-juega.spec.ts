import { test, expect, type Page } from "@playwright/test";
import { TRACKS } from "../../src/sim/tracks";
import { SECCIONES_GUIA } from "../../src/app/ayuda/textos";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "guia-ayuda-1";

type Estado = {
  pantalla: string;
  tiempoSim: number | null;
  pausada: boolean;
  ritmo: string | null;
  genomaEnTaller: unknown;
  ayudaAbierta: string | null;
  guia: { abierta: boolean; seccion: string | null; origen: string | null };
};
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

// La pausa viaja por mensaje al worker: se espera a que el tiempo simulado deje de cambiar antes de medir.
async function tiempoQuieto(page: Page): Promise<number | null> {
  let anterior: number | null = -1;
  await expect
    .poll(async () => {
      const t = (await estado(page)).tiempoSim;
      const quieto = t === anterior;
      anterior = t;
      return quieto;
    }, { intervals: [150] })
    .toBe(true);
  return anterior;
}

async function abrir(page: Page) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

test("gui-2: «Cómo se juega» desde la portada, con índice y una ficha por pista", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await page.getByTestId("acceso-guia").click();
  await expect(page.getByTestId("guia")).toBeVisible();
  await expect(page.getByTestId("guia-titulo")).toHaveText("Cómo se juega");
  for (const s of SECCIONES_GUIA) await expect(page.getByTestId(`guia-ir-${s.id}`)).toBeVisible();
  for (const t of TRACKS) await expect(page.getByTestId(`ficha-${t.id}`)).toHaveCount(1);
  const cab = (await page.getByTestId("guia-volver").boundingBox())!;
  expect(cab.y).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: `${DIR}/${ID}-guia-indice-360x640.png` });
  // La cabecera es fija: tras desplazar sigue en su sitio.
  await page.getByTestId("guia-ir-guardado").click();
  const cab2 = (await page.getByTestId("guia-volver").boundingBox())!;
  expect(cab2.y).toBe(cab.y);
  await page.getByTestId("guia-volver").click();
  await expect(page.getByTestId("guia")).toBeHidden();
  expect((await estado(page)).pantalla).toBe("portada");
});

test("gui-2-a: desde el Garaje, «Ver la guía completa» abre garaje-nombres y «← Volver» regresa", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await page.getByTestId("acceso-garaje").click();
  await page.getByTestId("ayuda-boton").click();
  await page.getByTestId("ayuda-guia").click();
  await expect(page.getByTestId("guia")).toBeVisible();
  expect(await estado(page)).toMatchObject({ guia: { abierta: true, seccion: "garaje-nombres", origen: "garaje" } });
  await expect(page.getByTestId("guia-seccion-garaje-nombres").locator("h3")).toBeInViewport();
  await page.screenshot({ path: `${DIR}/${ID}-guia-garaje-360x640.png` });
  await page.getByTestId("guia-volver").click();
  await expect(page.getByTestId("guia")).toBeHidden();
  const e = await estado(page);
  expect(e.guia.abierta).toBe(false);
  expect(e.pantalla).toBe("garaje");
});

test("gui-8-a: pedir ayuda no cambia el coche del Taller, ni con «volver» ni con «atrás»", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await page.getByTestId("acceso-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
  const antes = JSON.stringify((await estado(page)).genomaEnTaller);
  await page.getByTestId("ayuda-boton").click();
  await page.getByTestId("ayuda-guia").click();
  await page.getByTestId("guia-volver").click();
  await expect(page.getByTestId("ayuda-panel")).toBeVisible();
  expect(JSON.stringify((await estado(page)).genomaEnTaller)).toBe(antes);
  await page.screenshot({ path: `${DIR}/${ID}-taller-tras-guia-360x640.png` });
  await page.goBack();
  await expect(page.getByTestId("ayuda-panel")).toBeHidden();
  expect((await estado(page)).pantalla).toBe("taller");
  expect(JSON.stringify((await estado(page)).genomaEnTaller)).toBe(antes);
});

test("gui-8-b: la carrera a ×8 sigue pausada con el mismo ritmo tras ir a la guía y volver", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await page.getByTestId("acceso-serie").click();
  await page.getByTestId("ritmo-x8").click();
  await expect.poll(async () => (await estado(page)).tiempoSim ?? 0).toBeGreaterThan(1);
  await page.getByTestId("ayuda-boton").click();
  await expect.poll(async () => (await estado(page)).pausada).toBe(true);
  const t0 = await tiempoQuieto(page);
  await page.getByTestId("ayuda-guia").click();
  await page.waitForTimeout(1000);
  await page.getByTestId("guia-volver").click();
  const e = await estado(page);
  expect(e.tiempoSim).toBe(t0);
  expect(e.pausada).toBe(true);
  expect(e.ritmo).toBe("x8");
  await page.getByTestId("ayuda-cerrar").click();
  await expect.poll(async () => (await estado(page)).tiempoSim ?? 0).toBeGreaterThan(t0 ?? 0);
});
