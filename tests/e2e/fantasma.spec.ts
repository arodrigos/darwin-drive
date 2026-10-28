import { test, expect, type Page } from "@playwright/test";
import { PHYSICS_VERSION } from "../../src/sim/constants";
import { STOCK_CAR, genomeHash, normalizeGenome } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";
import { getTrack } from "../../src/sim/tracks";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "fantasma-8";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Fantasma = { visible: boolean; alpha: number; fiel: boolean | null; adelantado: boolean; resultado: { distance: number } | null };
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as { fantasma: Fantasma | null; ultimoResultado: { distance: number } | null; rankings: Record<string, unknown[]> });
const adelantar = (page: Page, s: number) => page.evaluate((x) => window.__debug!.adelantarSimulacion(x), s);

const track = getTrack("cordillera")!;

// Un coche más flojo que el de serie: el de serie lo pasa en plena carrera y salta el aviso.
const DEBIL = normalizeGenome({ ...STOCK_CAR, bodyDensity: 200, wheels: STOCK_CAR.wheels.map((w, i) => (i === 0 ? { ...w, radius: 0.9 } : w)) });

function marca(genome = STOCK_CAR, over: Record<string, unknown> = {}) {
  const r = simulateCar(genome, "cordillera");
  return {
    carId: genomeHash(genome),
    genome,
    genomeHash: genomeHash(genome),
    distance: r.distance,
    bestStep: r.bestStep,
    piezasPerdidas: r.piezasPerdidas,
    causaParada: r.causaParada,
    origin: "diseño",
    date: new Date().toISOString(),
    trackId: "cordillera",
    trackVersion: track.version,
    physicsVersion: PHYSICS_VERSION,
    ...over,
  };
}

async function abrir(page: Page, entrada: unknown) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario({ rankings: { cordillera: [e] } }), entrada);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

test("fa-2/fa-4/fa-5/fa-8/fa-9 el fantasma del n.º 1 corre a la par, no cuenta y avisa al adelantarlo", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, marca(DEBIL));
    await page.getByTestId("acceso-serie").click();
    await expect(page.getByTestId("pista")).toBeVisible();
    await expect.poll(async () => (await estado(page)).fantasma?.visible).toBe(true);
    const f = (await estado(page)).fantasma!;
    expect(f.alpha).toBeLessThan(1);
    await page.screenshot({ path: `${DIR}/${ID}-fantasma-visible-${t.w}x${t.h}.png` });
    // El coche de serie pasa al flojo antes de que éste acabe: el aviso sale una sola vez.
    await expect
      .poll(async () => {
        await adelantar(page, 2);
        return page.getByTestId("aviso-adelanta").count();
      })
      .toBe(1);
    await page.screenshot({ path: `${DIR}/${ID}-adelanta-${t.w}x${t.h}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await adelantar(page, 400);
    await expect(page.getByTestId("tarjeta-fin")).toBeVisible();
    // El resultado del coche de serie es el de siempre: el fantasma no lo toca.
    expect((await estado(page)).ultimoResultado!.distance).toBe(simulateCar(STOCK_CAR, "cordillera").distance);
    await page.screenshot({ path: `${DIR}/${ID}-fin-${t.w}x${t.h}.png` });
  }
});

test("fa-1/fa-6/fa-7 Ver repetición reproduce la marca con su fantasma y comprueba que es fiel", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, marca());
    await page.getByTestId("tarjeta-cordillera").click();
    await page.getByTestId("fila-ranking").first().click();
    await page.screenshot({ path: `${DIR}/${ID}-boton-repeticion-${t.w}x${t.h}.png` });
    await page.getByTestId("ver-repeticion").click();
    await expect(page.getByTestId("pista")).toBeVisible();
    // En la repetición el coche de la pista ES el récord: no hay un segundo coche fantasma.
    expect((await estado(page)).fantasma?.visible ?? false).toBe(false);
    const antes = (await estado(page)).rankings;
    await adelantar(page, 400);
    await expect(page.getByTestId("fin-fiel")).toBeVisible();
    await page.screenshot({ path: `${DIR}/${ID}-repeticion-fiel-${t.w}x${t.h}.png` });
    // Una repetición no inscribe nada en el ranking.
    expect((await estado(page)).rankings).toEqual(antes);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("fa-6 una marca de otra versión de la pista no se puede repetir y lo dice", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, marca(STOCK_CAR, { trackVersion: track.version + 1 }));
  await page.getByTestId("tarjeta-cordillera").click();
  await page.getByTestId("fila-ranking").first().click();
  await expect(page.getByTestId("ver-repeticion")).toBeDisabled();
  await expect(page.getByTestId("ayuda-repeticion")).toBeVisible();
  await page.screenshot({ path: `${DIR}/${ID}-repeticion-no-disponible-360x640.png` });
});

test("fa-7 la hoja del Garaje ofrece Ver repetición de su mejor marca y la reproduce", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    const r = simulateCar(STOCK_CAR, "cordillera");
    const coche = {
      id: genomeHash(STOCK_CAR),
      name: "Serie",
      genome: STOCK_CAR,
      marks: { cordillera: r.distance },
      markVersions: { cordillera: { trackVersion: track.version, physicsVersion: PHYSICS_VERSION } },
      markDetails: { cordillera: { bestStep: r.bestStep, piezasPerdidas: r.piezasPerdidas, causaParada: r.causaParada } },
      origin: "diseño",
      savedAt: new Date().toISOString(),
    };
    await page.goto("/?pruebas=1");
    await page.waitForFunction(() => Boolean(window.__debug));
    await page.evaluate((c) => window.__debug!.cargarEscenario({ vacio: true, garaje: [c] }), coche);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__debug));
    await page.getByTestId("acceso-garaje").click();
    await expect(page.getByTestId("garaje-repeticion").first()).toBeVisible();
    await page.screenshot({ path: `${DIR}/${ID}-garaje-repeticion-${t.w}x${t.h}.png` });
    await page.getByTestId("garaje-repeticion").first().click();
    await expect(page.getByTestId("pista")).toBeVisible();
    await adelantar(page, 400);
    await expect(page.getByTestId("fin-fiel")).toBeVisible();
  }
});

test("fa-4 en Evolución el coche del récord corre entre la población", async ({ page }) => {
  test.setTimeout(120_000);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, marca());
    await page.getByTestId("acceso-taller").click();
    await page.getByTestId("evolucionar").click();
    await expect(page.getByTestId("evolucion")).toBeVisible();
    await expect.poll(async () => (await estado(page)).fantasma?.visible, { timeout: 30_000 }).toBe(true);
    expect((await estado(page)).fantasma!.alpha).toBeLessThan(1);
    await page.screenshot({ path: `${DIR}/${ID}-evolucion-fantasma-${t.w}x${t.h}.png` });
  }
});
