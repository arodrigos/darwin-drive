import { test, expect, type Page } from "@playwright/test";
import { STOCK_CAR, type Genome } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";
import { TRACKS, type TrackId } from "../../src/sim/tracks";
import { CAMPEONES_5K } from "../fixtures/campeones-5k";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "camara-fps";
test.setTimeout(240_000);

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

interface Camara {
  dentro: boolean;
  fpsDibujo: number;
  margenMinPx: number;
  recortes: number;
  zonaUtilPx: { top: number; bottom: number };
  cajaLiderPx: { top: number; bottom: number; left: number; right: number } | null;
}
type Estado = {
  camara: Camara | null;
  tiempoSim: number | null;
  distanciaLider: number | null;
  ultimoResultado: { distance: number; steps: number } | null;
  marcador: unknown;
};
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);
const limitar = (page: Page, fps: number | null) => page.evaluate((f) => window.__debug!.limitarFps(f), fps);

async function abrir(page: Page, escenario: Record<string, unknown>, extra = "") {
  await page.goto(`/?pruebas=1${extra}`);
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e as never), escenario);
}

/** El coche del Taller en esa pista: el campeón del fixture, o el de serie si la pista no tiene (La Recta). */
function escenarioPista(pista: TrackId): Record<string, unknown> {
  const genoma: Genome | undefined = CAMPEONES_5K[pista]?.[0];
  return genoma ? { genoma, pista } : { vacio: true, pista };
}

async function probar(page: Page) {
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("probar").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await expect.poll(async () => (await estado(page)).tiempoSim ?? 0).toBeGreaterThan(0.2);
}

const caja = (page: Page, id: string) =>
  page.evaluate((i) => {
    const r = document.querySelector(`[data-testid="${i}"]`)?.getBoundingClientRect();
    return r ? { top: r.top, bottom: r.bottom } : null;
  }, id);

/** Lee estado().camara cada 250 ms dentro de la página, durante `ms`, sin esperar a Playwright entre lecturas. */
function leer(page: Page, ms: number, capturar?: (s: number) => Promise<void>) {
  return (async () => {
    const lecturas: Camara[] = [];
    const inicio = Date.now();
    const hechas = new Set<number>();
    while (Date.now() - inicio < ms) {
      const c = (await estado(page)).camara;
      if (c) lecturas.push(c);
      const s = Math.floor((Date.now() - inicio) / 1000);
      if (capturar && !hechas.has(s)) {
        hechas.add(s);
        await capturar(s);
      }
      await page.waitForTimeout(250);
    }
    return lecturas;
  })();
}

for (const { w, h } of TAMANOS) {
  test(`ce-1 La Rampa a 3 fps y ×8 mantiene el coche entero entre el contador y los ritmos a ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await abrir(page, escenarioPista("rampa"));
    await probar(page);
    await page.getByTestId("ritmo-x8").click();
    await limitar(page, 3);
    const hud = (await caja(page, "hud-distancia"))!;
    const ritmos = (await caja(page, "ritmo-x1"))!;
    const antes = (await estado(page)).distanciaLider ?? 0;
    const tops: number[] = [];
    const lecturas = await leer(page, 12_000, async (s) => {
      if (s === 0 || s === 6 || s === 12) await page.screenshot({ path: `${DIR}/${ID}-rampa-${s}s-${w}x${h}.png` });
    });
    expect(lecturas.length).toBeGreaterThan(30);
    for (const c of lecturas) {
      expect(c.dentro).toBe(true);
      expect(c.cajaLiderPx!.top).toBeGreaterThanOrEqual(hud.bottom);
      expect(c.cajaLiderPx!.bottom).toBeLessThanOrEqual(ritmos.top);
      tops.push(c.cajaLiderPx!.top);
    }
    // Las primeras lecturas todavía cuentan los fotogramas del segundo anterior al tope.
    const estables = lecturas.slice(8).map((c) => c.fpsDibujo);
    expect(Math.max(...estables)).toBeLessThanOrEqual(4);
    expect(Math.max(...estables)).toBeGreaterThanOrEqual(2);
    expect(((await estado(page)).distanciaLider ?? 0) - antes).toBeGreaterThan(50);
    // La caja del líder no se pasea por la pantalla: varía menos que la banda.
    const banda = lecturas[0].zonaUtilPx.bottom - lecturas[0].zonaUtilPx.top;
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(banda);
  });
}

test("ce-1 sin tope de fps y con limitarFps(1) el coche también queda dentro", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, escenarioPista("rampa"));
  await probar(page);
  await page.getByTestId("ritmo-x8").click();
  for (const fps of [null, 1]) {
    await limitar(page, fps);
    const lecturas = await leer(page, 4_000);
    expect(lecturas.length).toBeGreaterThan(8);
    expect(lecturas.every((c) => c.dentro)).toBe(true);
  }
});

for (const { id: pista } of TRACKS) {
  test(`ce-2 ${pista} a 3 fps y ×8 no saca al coche de la zona útil (360x640)`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await abrir(page, escenarioPista(pista));
    await probar(page);
    await page.getByTestId("ritmo-x8").click();
    await limitar(page, 3);
    const ritmos = (await caja(page, "ritmo-x1"))!;
    const lecturas = await leer(page, 6_000, async (s) => {
      if (s === 6) await page.screenshot({ path: `${DIR}/${ID}-${pista}-6s.png` });
    });
    expect(lecturas.length).toBeGreaterThan(12);
    for (const c of lecturas) {
      expect(c.dentro).toBe(true);
      expect(c.cajaLiderPx!.bottom).toBeLessThanOrEqual(ritmos.top + 0.5);
    }
  });
}

test("ce-4 con limitarFps(3) «Hasta el final» da la marca de Node", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true });
  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await limitar(page, 3);
  const referencia = simulateCar(STOCK_CAR, "cordillera");
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
  expect((await estado(page)).ultimoResultado).toMatchObject({ distance: referencia.distance, steps: referencia.steps });
});

test("ce-5 el gancho no existe sin ?pruebas=1, limitarFps(null) lo quita y la escena nueva lo conserva", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  await page.getByRole("heading", { name: "Darwin Drive" }).waitFor();
  expect(await page.evaluate(() => typeof (window as unknown as { __debug?: unknown }).__debug)).toBe("undefined");

  await abrir(page, { vacio: true });
  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await page.getByTestId("ritmo-x4").click();
  await limitar(page, 3);
  await page.waitForTimeout(1500);
  await expect.poll(async () => (await estado(page)).camara?.fpsDibujo ?? 99, { timeout: 5_000 }).toBeLessThanOrEqual(4);
  // Con el tope el ritmo simulado no cambia: ×4 sigue entre 3 y 5 segundos simulados por segundo real.
  const a = await page.evaluate(() => ({ t: performance.now(), s: window.__debug!.estado().tiempoSim ?? 0 }));
  await page.waitForTimeout(3000);
  const b = await page.evaluate(() => ({ t: performance.now(), s: window.__debug!.estado().tiempoSim ?? 0 }));
  const v = (b.s - a.s) / ((b.t - a.t) / 1000);
  expect(v).toBeGreaterThan(3);
  expect(v).toBeLessThan(5);

  await page.evaluate(() => window.__debug!.perderLienzo());
  await expect.poll(async () => (await page.evaluate(() => window.__debug!.estado().lienzo)) as string, { timeout: 15_000 }).toBe("ok");
  await page.waitForTimeout(2000);
  expect((await estado(page)).camara?.fpsDibujo ?? 0).toBeLessThanOrEqual(4);

  await limitar(page, null);
  await expect.poll(async () => (await estado(page)).camara?.fpsDibujo ?? 0, { timeout: 2_000 }).toBeGreaterThan(4);
});

test("ce-6 el panel de ?rendimiento=1 enseña la línea de la cámara", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/?pruebas=1&rendimiento=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await limitar(page, 3);
  const linea = page.getByTestId("rend-camara");
  await expect(linea).toHaveText(/^cámara · [2-4] fps · margen \d+ px$/, { timeout: 10_000 });
  const c = (await estado(page)).camara!;
  expect(c.margenMinPx).toBeGreaterThanOrEqual(0);
  // El panel se repinta cada cierto tiempo y los fps a 3 cuadros bailan: se compara con polling, no con dos lecturas sueltas.
  await expect
    .poll(async () => {
      const m = /(\d+) fps/.exec(await linea.innerText());
      return m ? Math.abs(Number(m[1]) - ((await estado(page)).camara?.fpsDibujo ?? 99)) : 99;
    }, { timeout: 10_000 })
    .toBeLessThanOrEqual(1);
  // El panel se apoya sobre el pie: ni la línea ni el panel pueden montarse sobre la fila de ritmos.
  await expect
    .poll(async () => {
      const p = await page.getByTestId("panel-rendimiento").boundingBox();
      const r = await page.getByTestId("ritmo-x1").boundingBox();
      return p && r ? p.y + p.height <= r.y : false;
    })
    .toBe(true);
  // Con las latencias llenas el panel crece: aun así no puede cruzarse con el coche en ninguna lectura.
  for (const r of ["ritmo-x2", "ritmo-x4", "ritmo-x8"]) await page.getByTestId(r).click();
  await limitar(page, 3);
  for (let i = 0; i < 24; i++) {
    const p = await page.getByTestId("panel-rendimiento").boundingBox();
    const coche = (await estado(page)).camara?.cajaLiderPx;
    expect(p).not.toBeNull();
    if (p && coche) {
      const separados = p.x >= coche.right || p.x + p.width <= coche.left || p.y >= coche.bottom || p.y + p.height <= coche.top;
      expect(separados, `panel ${JSON.stringify(p)} cruza coche ${JSON.stringify(coche)}`).toBe(true);
    }
    await page.waitForTimeout(250);
  }
  const panel = (await page.getByTestId("panel-rendimiento").boundingBox())!;
  await page.screenshot({ path: `${DIR}/${ID}-panel-360x640.png` });
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(360);
  expect(panel.y).toBeGreaterThanOrEqual(0);
});

test("ce-7 Evolución y Batalla usan la misma cámara a 3 fps en La Rampa", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, escenarioPista("rampa"), "&rendimiento=1");
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("evolucionar").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await page.getByTestId("evo-ritmo-x8").click();
  await limitar(page, 3);
  let lecturas = await leer(page, 8_000);
  expect(lecturas.length).toBeGreaterThan(16);
  expect(lecturas.every((c) => c.dentro)).toBe(true);
  // El panel de Evolución usa el mismo CSS: tampoco puede cubrir al coche.
  const pe = await page.getByTestId("panel-rendimiento").boundingBox();
  const ce = (await estado(page)).camara?.cajaLiderPx;
  expect(pe).not.toBeNull();
  if (pe && ce) expect(pe.x >= ce.right || pe.x + pe.width <= ce.left || pe.y >= ce.bottom || pe.y + pe.height <= ce.top).toBe(true);
  await page.screenshot({ path: `${DIR}/${ID}-evolucion-360x640.png` });

  await abrir(page, { batalla: { jugadores: 2, fase: "carrera", pista: "rampa" } });
  await expect(page.getByTestId("batalla-carrera")).toBeVisible();
  await limitar(page, 3);
  lecturas = await leer(page, 8_000);
  expect(lecturas.length).toBeGreaterThan(16);
  expect(lecturas.every((c) => c.dentro)).toBe(true);
  await page.screenshot({ path: `${DIR}/${ID}-batalla-360x640.png` });
});

test("ce-8 con la carrera parada el coche y su marcador quedan sobre la tarjeta de fin a 3 fps", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { genoma: "demo-motor-rampa", pista: "rampa" });
  await probar(page);
  await limitar(page, 3);
  await page.getByTestId("ritmo-final").click();
  const tarjeta = page.getByTestId("tarjeta-fin");
  await expect(tarjeta).toBeVisible({ timeout: 90_000 });
  const yTarjeta = (await caja(page, "tarjeta-fin"))!.top;
  await expect
    .poll(
      async () => {
        const e = await estado(page);
        return e.camara?.dentro === true && e.camara.cajaLiderPx!.bottom <= yTarjeta && e.marcador !== null;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  await page.screenshot({ path: `${DIR}/${ID}-parado-360x640.png` });
});
