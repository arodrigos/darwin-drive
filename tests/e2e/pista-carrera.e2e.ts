import { test, expect, type Page } from "@playwright/test";
import { PHYSICS_VERSION } from "../../src/sim/constants";
import { STOCK_CAR, genomeHash } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";
import { getTrack } from "../../src/sim/tracks";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "pista-carrera-9";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Estado = {
  distanciaLider: number | null;
  cochesVivos: number;
  pistaEnCarrera: string | null;
  tiempoSim: number | null;
  ejecutor: string | null;
  fantasma: { visible: boolean; alpha: number } | null;
  ultimoResultado: { distance: number; steps: number; trackId: string; reason: string } | null;
};

const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);
const adelantar = (page: Page, s: number) => page.evaluate((x) => window.__debug!.adelantarSimulacion(x), s);
const coma = (m: number) => `${m.toFixed(1).replace(".", ",")} m`;

async function abrir(page: Page, extra = "") {
  await page.goto(`/?pruebas=1${extra}`);
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

async function verCocheDeSerie(page: Page) {
  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  // El coche ya está corriendo cuando la distancia del líder sale de 0.
  await expect.poll(async () => (await estado(page)).cochesVivos).toBe(1);
}

async function cpu(page: Page, rate: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

test("pc-1 coche de serie: carrera real en la pista elegida y tarjeta con el mismo resultado", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await cpu(page, 4);
  await abrir(page);
  await verCocheDeSerie(page);
  await expect(page.getByTestId("nombre-pista")).toHaveText("La Cordillera");
  await page.waitForTimeout(2000);
  const vivo = await estado(page);
  expect(vivo.pistaEnCarrera).toBe("cordillera");
  expect(vivo.distanciaLider).toBeGreaterThan(0);
  expect(vivo.distanciaLider).toBeLessThan(40);
  await expect(page.getByTestId("hud-distancia")).not.toHaveText("0,0 m");
  await page.screenshot({ path: `${DIR}/${ID}-corriendo-360x640.png` });

  await adelantar(page, 200);
  const fin = await estado(page);
  expect(fin.ultimoResultado?.trackId).toBe("cordillera");
  expect(fin.ultimoResultado!.distance).toBeGreaterThanOrEqual(40);
  const tarjeta = page.getByTestId("tarjeta-fin");
  await expect(tarjeta).toContainText("Fin de la carrera · La Cordillera");
  await expect(page.getByTestId("fin-distancia")).toHaveText(coma(fin.ultimoResultado!.distance));
  await expect(page.getByTestId("fin-motivo")).toHaveText(/Motivo: (se atascó|se acabó el tiempo|descalificado)|¡Meta!/);
  await page.screenshot({ path: `${DIR}/${ID}-fin-360x640.png` });

  // Repetir da exactamente la misma cifra.
  await page.getByTestId("repetir").click();
  await expect(tarjeta).toBeHidden();
  await adelantar(page, 200);
  expect((await estado(page)).ultimoResultado!.distance).toBe(fin.ultimoResultado!.distance);

  // Otra pista seleccionada: otra carrera, con su id.
  await page.evaluate(() => window.__debug!.cargarEscenario({ pista: "rampa" }));
  await verCocheDeSerie(page);
  await expect(page.getByTestId("nombre-pista")).toHaveText("La Rampa");
  await adelantar(page, 300);
  const rampa = (await estado(page)).ultimoResultado!;
  expect(rampa.trackId).toBe("rampa");
  expect(rampa.distance).not.toBe(fin.ultimoResultado!.distance);
  await expect(tarjeta).toContainText("La Rampa");
  await expect(page.getByTestId("fin-distancia")).toHaveText(coma(rampa.distance));
});

test("pc-1 capturas: la pista corriendo y la tarjeta de fin a los tres tamaños", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page);
    await verCocheDeSerie(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/${ID}-pista-${t.w}x${t.h}.png` });
    await adelantar(page, 200);
    await expect(page.getByTestId("tarjeta-fin")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${DIR}/${ID}-tarjeta-${t.w}x${t.h}.png` });
  }
});

test("pc-2 sin Worker la misma carrera da exactamente la misma distancia y pasos", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const correr = async (extra: string) => {
    await abrir(page, extra);
    await verCocheDeSerie(page);
    const antes = await estado(page);
    await adelantar(page, 200);
    const despues = await estado(page);
    return { ejecutor: antes.ejecutor, r: despues.ultimoResultado! };
  };
  const conWorker = await correr("");
  const enLinea = await correr("&worker=0");
  expect(conWorker.ejecutor).toBe("worker");
  expect(enLinea.ejecutor).toBe("en-linea");
  expect(enLinea.r.distance).toBe(conWorker.r.distance);
  expect(enLinea.r.steps).toBe(conWorker.r.steps);
});

test("pc-3 el pintado no cambia el resultado: CPU ×6 frente a ×1", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const correr = async (rate: number) => {
    await abrir(page);
    await cpu(page, rate);
    await verCocheDeSerie(page);
    await page.waitForTimeout(3000);
    await adelantar(page, 200);
    return (await estado(page)).ultimoResultado!;
  };
  const lento = await correr(6);
  const normal = await correr(1);
  expect(lento.distance).toBe(normal.distance);
  expect(lento.steps).toBe(normal.steps);
});

test("pc-4 ?rendimiento=1: panel con fps, p95, coches/s y latencias que coinciden con __debug.latencias()", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, "&rendimiento=1");
    await verCocheDeSerie(page);
    const panel = page.getByTestId("panel-rendimiento");
    await expect(panel).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("rend-fps")).toHaveText(/^\d+$/);
    await expect(page.getByTestId("rend-p95")).toHaveText(/^\d+,\d ms$/);
    await expect(page.getByTestId("rend-coches")).toHaveText(/^\d+,\d$/);
    await expect
      .poll(async () => {
        const esperado = await page.evaluate(() =>
          window.__debug!.latencias().slice(-10).reverse().map((l) => `${l.evento} · ${Math.round(l.ms)} ms · trabajo ${Math.round(l.trabajoMs)} ms ${l.ms <= 200 ? "✓" : "✗"}`),
        );
        const visto = await page.$$eval("[data-testid=rend-latencias] li", (l) => l.map((x) => x.textContent!.replace(".", ",")));
        return esperado.length > 0 && JSON.stringify(esperado).replace(/\./g, ",") === JSON.stringify(visto);
      })
      .toBe(true);
    const cajas = await panel.boundingBox();
    // En móvil el panel va a la derecha para no tapar al coche; basta con que quepa entero en la pantalla.
    expect(cajas!.x).toBeGreaterThanOrEqual(0);
    expect(cajas!.x + cajas!.width).toBeLessThanOrEqual(t.w);
    expect(cajas!.y + cajas!.height).toBeLessThanOrEqual(t.h);
    await page.screenshot({ path: `${DIR}/${ID}-rendimiento-${t.w}x${t.h}.png` });
  }
});

test("pc-5 eventos: fantasma del n.º 1 y etiqueta de fin sobre el coche", async ({ page }) => {
  const track = getTrack("cordillera")!;
  const marca = simulateCar(STOCK_CAR, "cordillera");
  const entrada = {
    carId: genomeHash(STOCK_CAR),
    genome: STOCK_CAR,
    genomeHash: genomeHash(STOCK_CAR),
    // Medida de verdad: sin su tiempo la marca está pendiente y no puede correr de fantasma.
    distance: marca.distance,
    bestStep: marca.bestStep,
    piezasPerdidas: marca.piezasPerdidas,
    causaParada: marca.causaParada,
    origin: "diseño",
    date: new Date().toISOString(),
    trackId: "cordillera",
    trackVersion: track.version,
    physicsVersion: PHYSICS_VERSION,
  };
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page);
    await page.evaluate((e) => window.__debug!.cargarEscenario({ rankings: { cordillera: [e] } }), entrada);
    await expect(page.getByTestId("tarjeta-cordillera")).toContainText(`n.º 1: ${coma(marca.distance)}`);
    await verCocheDeSerie(page);
    // Se acerca al n.º 1 sin pasarlo: el fantasma está a la vista.
    await expect
      .poll(async () => {
        await adelantar(page, 0.5);
        return (await estado(page)).distanciaLider ?? 0;
      })
      .toBeGreaterThan(18);
    await page.screenshot({ path: `${DIR}/${ID}-fantasma-${t.w}x${t.h}.png` });
    // La bandera la sustituyó el fantasma del récord (bloque fantasma): el n.º 1 se ve como un coche translúcido.
    const f = (await estado(page)).fantasma;
    expect(f?.visible).toBe(true);
    expect(f?.alpha).toBeLessThan(1);
    await adelantar(page, 200);
    await page.screenshot({ path: `${DIR}/${ID}-etiqueta-fin-${t.w}x${t.h}.png` });
  }
});

test("pc-6 al ocultar la pestaña la carrera se pausa y al volver sigue", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await verCocheDeSerie(page);
  await expect.poll(async () => (await estado(page)).tiempoSim).toBeGreaterThan(0.3);
  const cambiar = (v: "hidden" | "visible") =>
    page.evaluate((valor) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => valor });
      document.dispatchEvent(new Event("visibilitychange"));
    }, v);
  await cambiar("hidden");
  // Un mensaje en vuelo puede llegar tras la pausa: se toma la medida cuando ya ha pasado.
  await page.waitForTimeout(300);
  const quieto = (await estado(page)).tiempoSim!;
  await page.waitForTimeout(1200);
  expect((await estado(page)).tiempoSim).toBe(quieto);
  await cambiar("visible");
  await expect.poll(async () => (await estado(page)).tiempoSim!).toBeGreaterThan(quieto);
});

test("pc-7 si el ejecutor falla, lo dice y Reintentar vuelve a lanzar la carrera", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, "&fallo=worker");
    await page.getByTestId("acceso-serie").click();
    const aviso = page.getByTestId("error-simulacion");
    await expect(aviso).toContainText(
      "La simulación se ha detenido por un error. Toca Reintentar para volver a empezar esta carrera.",
    );
    await page.screenshot({ path: `${DIR}/${ID}-error-${t.w}x${t.h}.png` });
    await page.getByTestId("reintentar").click();
    await expect(aviso).toBeHidden();
    await expect.poll(async () => (await estado(page)).cochesVivos).toBe(1);
    await adelantar(page, 200);
    expect((await estado(page)).ultimoResultado?.trackId).toBe("cordillera");
  }
});

test("pc-1 el nombre de la pista no queda tapado por la pastilla de distancia", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page);
    await verCocheDeSerie(page);
    await expect(page.getByTestId("hud-distancia")).not.toHaveText("0,0 m");
    await page.screenshot({ path: `${DIR}/${ID}-nombre-${t.w}x${t.h}.png` });
    const nombre = (await page.getByTestId("nombre-pista").boundingBox())!;
    const hud = (await page.getByTestId("hud-distancia").boundingBox())!;
    const solapa =
      nombre.x < hud.x + hud.width && hud.x < nombre.x + nombre.width && nombre.y < hud.y + hud.height && hud.y < nombre.y + nombre.height;
    expect(solapa).toBe(false);
  }
});
