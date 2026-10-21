import { test, expect, type Page } from "@playwright/test";
import demoJson from "../../src/debug/escenarios/rankings-demo.json";
import type { Genome } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";
import type { TrackId } from "../../src/sim/tracks";

const demo = demoJson as unknown as Record<TrackId, { carId: string; genome: Genome }[]>;
const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "versionado-migracion-4";
const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];
const ESCENARIO = { rankings: "demo-version-anterior", especies: "demo-version-anterior", garaje: "demo-version-anterior" };

type Estado = {
  rankings: Record<TrackId, { carId: string; distance: number }[]>;
  migracion: { enCurso: boolean; hechos: number; total: number; enVuelo: string | null; intentos: Record<string, number> };
};
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

// La franja reserva su sitio: ningún control visible se solapa con ella (el «?» fijo queda en el margen que se le deja).
async function sinCruzarNada(page: Page, testid: string) {
  const franja = (await page.getByTestId(testid).boundingBox())!;
  const solapados = await page.evaluate((f) => {
    const cajas = [...document.querySelectorAll<HTMLElement>(".contenido button, .contenido [role=tab], .contenido a")]
      .filter((e) => e.getClientRects().length > 0)
      .map((e) => ({ id: e.getAttribute("data-testid") ?? e.textContent ?? "", r: e.getBoundingClientRect() }));
    const cruza = cajas.filter(({ r }) => r.left < f.x + f.width && r.right > f.x && r.top < f.y + f.height && r.bottom > f.y);
    return { total: cajas.length, cruzan: cruza.map((c) => c.id) };
  }, franja);
  expect(solapados.total).toBeGreaterThan(0);
  expect(solapados.cruzan).toEqual([]);
}

async function abrirConMigracionFrenada(page: Page) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario({ vacio: true, ...e }), ESCENARIO);
  await page.goto("/?pruebas=1&migracion=frenada");
  await page.waitForFunction(() => Boolean(window.__debug));
}

test("mig-1/2/3 la banda y los rótulos se ven mientras migra y al acabar cada marca es la que da el núcleo", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrirConMigracionFrenada(page);
  await expect(page.getByTestId("banda-migracion")).toBeVisible();
  await expect(page.getByTestId("banda-migracion")).toContainText("Actualizando marcas a la nueva versión");
  expect((await estado(page)).migracion.enCurso).toBe(true);

  await page.getByTestId("tarjeta-cordillera").click();
  await expect(page.getByTestId("rankings")).toBeVisible();
  await expect(page.getByTestId("fila-migracion")).toHaveCount(3);
  await expect(page.getByTestId("fila-migracion").first()).toHaveText("actualizando…");
  await expect(page.getByTestId("nota-migracion")).toBeVisible();
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(t.w);
    const banda = (await page.getByTestId("banda-migracion").boundingBox())!;
    expect(banda.height).toBeLessThanOrEqual(72);
    await sinCruzarNada(page, "banda-migracion");
    await page.screenshot({ path: `${DIR}/${ID}-banda-${t.w}x${t.h}.png` });
  }

  await page.evaluate(() => window.__debug!.frenarMigracion(false));
  await expect.poll(async () => (await estado(page)).migracion.enCurso, { timeout: 180_000 }).toBe(false);
  await expect(page.getByTestId("aviso-migracion")).toBeVisible();
  await expect(page.getByTestId("fila-migracion")).toHaveCount(0);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await sinCruzarNada(page, "aviso-migracion");
    await page.screenshot({ path: `${DIR}/${ID}-aviso-${t.w}x${t.h}.png` });
  }
  const aviso = (await page.getByTestId("aviso-migracion").boundingBox())!;
  expect(aviso.height).toBeLessThanOrEqual(72);

  const final = await estado(page);
  for (const id of ["cordillera", "rampa"] as const) {
    const genomas = new Map(demo[id].map((e) => [e.carId, e.genome]));
    for (const e of final.rankings[id]) expect(e.distance, `${id}/${e.carId}`).toBe(simulateCar(genomas.get(e.carId)!, id).distance);
  }
  await page.getByTestId("aviso-migracion-cerrar").click();
  await expect(page.getByTestId("aviso-migracion")).toHaveCount(0);
});

test("mig-1-b sin marcas de versión anterior no hay banda ni aviso", async ({ page }) => {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true, rankings: "demo" }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await expect(page.getByTestId("banda-migracion")).toHaveCount(0);
  await expect(page.getByTestId("aviso-migracion")).toHaveCount(0);
  expect((await estado(page)).migracion.enCurso).toBe(false);
});

test("mig-6 el nodo del linaje medido en una versión anterior lo dice", async ({ page }) => {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true, linaje: "demo-5-generaciones" }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-linaje").click();
  await expect(page.getByTestId("linaje")).toBeVisible();
  await page.locator('[data-testid="nodo-linaje"]').nth(1).dispatchEvent("click");
  await expect(page.getByTestId("hoja-version-anterior")).toBeVisible();
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await page.screenshot({ path: `${DIR}/${ID}-linaje-${t.w}x${t.h}.png` });
  }
});

test("mig-9 con otra pestaña antigua abierta la migración espera y ofrece recargarla", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario({ vacio: true, ...e }), ESCENARIO);
  await page.goto("/?pruebas=1&pestanas=antiguas");
  await page.waitForFunction(() => Boolean(window.__debug));
  await expect(page.getByTestId("espera-pestanas")).toBeVisible();
  await expect(page.getByTestId("recargar-pestanas")).toBeVisible();
  expect((await estado(page)).migracion.hechos).toBe(0);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await page.screenshot({ path: `${DIR}/${ID}-espera-pestanas-${t.w}x${t.h}.png` });
  }
});
