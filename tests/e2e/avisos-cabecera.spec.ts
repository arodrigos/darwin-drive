import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "avisos-cabecera";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Caja = { x: number; y: number; w: number; h: number };

/** Caja de un elemento o null si no está: una sola lectura en la página, porque boundingBox() espera a que aparezca y estos avisos se van solos. */
const cajas = (page: Page, ids: string[], selectores: string[] = []) =>
  page.evaluate(
    ({ ids, selectores }) => {
      const leer = (el: Element | null) => {
        const r = el?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
      };
      return {
        ...Object.fromEntries(ids.map((id) => [id, leer(document.querySelector(`[data-testid="${id}"]`))])),
        ...Object.fromEntries(selectores.map((s) => [s, leer(document.querySelector(s))])),
      } as Record<string, Caja | null>;
    },
    { ids, selectores },
  );

const cruzan = (a: Caja, b: Caja) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const adelantar = (page: Page, s: number) => page.evaluate((x) => window.__debug!.adelantarSimulacion(x), s);

/** El aviso de récord dura 2,5 s: se avanza a saltos cortos y se sale en cuanto aparece, sin fijar cuánto tarda el render del runner. */
async function esperarAvisoRanking(page: Page) {
  await expect
    .poll(async () => {
      await adelantar(page, 20);
      return page.getByTestId("aviso-ranking").count();
    }, { timeout: 90_000, intervals: [100] })
    .toBeGreaterThan(0);
}

async function abrir(page: Page, t: { w: number; h: number }) {
  await page.setViewportSize({ width: t.w, height: t.h });
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
}

for (const t of TAMANOS) {
  test(`av-1 el aviso de Especies sale bajo la cabecera y no se cruza con ella @tamanos ${t.w}x${t.h}`, async ({ page }) => {
    await abrir(page, t);
    await page.getByTestId("acceso-especies").click();
    await page.getByTestId("explorar-especies").click();
    await adelantar(page, 900);
    await expect(page.getByTestId("aviso-especies")).toBeVisible();
    const c = await cajas(page, ["aviso-especies", "volver"], [".garaje-cabecera", ".garaje-cabecera h2"]);
    const aviso = c["aviso-especies"]!;
    const cab = c[".garaje-cabecera"]!;
    expect(aviso.y).toBeGreaterThanOrEqual(cab.y + cab.h - 1);
    for (const otra of [c.volver, c[".garaje-cabecera h2"]]) expect(cruzan(aviso, otra!)).toBe(false);
    await page.screenshot({ path: `${DIR}/${ID}-especies-${t.w}x${t.h}.png` });
  });

  test(`av-2 el aviso de récord de Evolución sale bajo la cabecera @tamanos ${t.w}x${t.h}`, async ({ page }) => {
    test.setTimeout(120_000);
    await abrir(page, t);
    await page.getByTestId("acceso-taller").click();
    await page.getByTestId("evolucionar").click();
    await expect(page.getByTestId("evolucion")).toBeVisible();
    await esperarAvisoRanking(page);
    const c = await cajas(page, ["aviso-ranking", "volver", "nombre-pista", "contador"], [".cabecera", ".avisos-bajo-cabecera"]);
    const aviso = c["aviso-ranking"]!;
    expect(aviso.y).toBeGreaterThanOrEqual(c[".cabecera"]!.y + c[".cabecera"]!.h - 1);
    for (const id of ["volver", "nombre-pista", "contador"]) expect(cruzan(aviso, c[id]!), id).toBe(false);
    expect(c[".avisos-bajo-cabecera"]).not.toBeNull();
    await page.screenshot({ path: `${DIR}/${ID}-evolucion-${t.w}x${t.h}.png` });
  });
}

test("av-3 el contenedor de avisos y sus avisos no recogen toques (pointer-events: none)", async ({ page }) => {
  test.setTimeout(120_000);
  await abrir(page, TAMANOS[1]);
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("evolucionar").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await esperarAvisoRanking(page);
  // Con el aviso ya en pantalla; el contenedor vacío mide 0 y Playwright lo daría por oculto, así que no se pide visible.
  const contenedor = page.locator(".avisos-bajo-cabecera");
  await expect(contenedor).toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("aviso-ranking")).toHaveCSS("pointer-events", "none");
});
