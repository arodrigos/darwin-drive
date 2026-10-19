import { test, expect, type Page } from "@playwright/test";
import { STOCK_CAR, type Genome } from "../../src/sim/genome";
import demoJson from "../../src/debug/escenarios/rankings-demo.json";
import { simulateCar } from "../../src/sim/race";
import { TRACKS, type TrackId } from "../../src/sim/tracks";

const demo = demoJson as unknown as Record<TrackId, { carId: string; genome: Genome }[]>;
const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "rankings-11";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Estado = {
  pantalla: string;
  pistaSeleccionada: TrackId;
  genomaEnTaller: Genome | null;
  genomaEnPista: Genome | null;
  ultimoResultado: { distance: number; trackId: string } | null;
  rankings: Record<TrackId, { carId: string; distance: number; origin: string }[]>;
};

const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);
const adelantar = (page: Page, s: number) => page.evaluate((x) => window.__debug!.adelantarSimulacion(x), s);
const coma = (m: number) => `${m.toFixed(1).replace(".", ",")} m`;

async function abrir(page: Page, escenario: Record<string, unknown>) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

// Node y Chromium no comparten las mismas funciones matemáticas al último bit: tras ~1 km de física la cifra puede
// diferir unos decímetros. Dentro del mismo motor (Worker contra Worker) la igualdad sí es exacta.
function expectMismaMarca(navegador: number, nucleo: number) {
  expect(Math.abs(navegador - nucleo)).toBeLessThanOrEqual(Math.max(1, nucleo * 0.005));
}

test("rk-1 el ranking de cada pista se lee de punta a punta y abre el coche en el taller", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { rankings: "demo" });
  await page.getByTestId("tarjeta-rampa").click();
  await expect(page.getByTestId("rankings")).toBeVisible();
  await expect(page.getByTestId("pestana-rampa")).toHaveAttribute("aria-selected", "true");
  const filas = page.getByTestId("fila-ranking");
  await expect(filas).toHaveCount(10);
  const r = await estado(page);
  expect(r.pantalla).toBe("rankings");
  const cifras = await page.getByTestId("fila-distancia").allTextContents();
  expect(cifras).toEqual(r.rankings.rampa.map((e) => coma(e.distance)));
  expect(await page.getByTestId("fila-puesto").allTextContents()).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)));
  const sorted = r.rankings.rampa.map((e) => e.distance);
  expect(sorted).toEqual([...sorted].sort((a, b) => b - a));
  await page.screenshot({ path: `${DIR}/${ID}-rampa-360x640.png` });

  await page.getByTestId("pestana-dunas").click();
  await expect(page.getByTestId("pestana-dunas")).toHaveAttribute("aria-selected", "true");
  expect(await page.getByTestId("fila-distancia").allTextContents()).toEqual(r.rankings.dunas.map((e) => coma(e.distance)));
  const ordenDunas = await filas.evaluateAll((els) => els.map((e) => e.getAttribute("data-carid")));
  expect(ordenDunas).toEqual(r.rankings.dunas.map((e) => e.carId));
  expect(ordenDunas).not.toEqual(r.rankings.rampa.map((e) => e.carId));
  await page.screenshot({ path: `${DIR}/${ID}-dunas-360x640.png` });

  await page.getByTestId("pestana-rampa").click();
  await filas.nth(2).click();
  await expect(page.getByTestId("hoja-titulo")).toHaveText("Puesto 3 · La Rampa");
  await expect(page.getByTestId("hoja-distancia")).toHaveText(coma(r.rankings.rampa[2].distance));
  await expect(page.getByTestId("hoja-origen")).toHaveText(r.rankings.rampa[2].origin);
  await page.screenshot({ path: `${DIR}/${ID}-hoja-fila-360x640.png` });
  await page.getByTestId("abrir-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
  await expect(page.getByTestId("selector-pista")).toContainText("Pista: La Rampa");
  const t = await estado(page);
  expect(t.pistaSeleccionada).toBe("rampa");
  // El estado solo resume las marcas: el genoma esperado sale del propio escenario.
  const guardado = demo.rampa.find((e) => e.carId === r.rankings.rampa[2].carId)!;
  // Chromium y Node no normalizan al último bit, así que el hash cambia; los genes, no más allá de 1e-9.
  const genes = (g: unknown): number[] => JSON.stringify(g).match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
  const enTaller = genes(t.genomaEnTaller);
  const esperado = genes(guardado.genome);
  expect(enTaller).toHaveLength(esperado.length);
  enTaller.forEach((v, i) => expect(Math.abs(v - esperado[i])).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(v))));

  const lat = await page.evaluate(() => window.__debug!.latencias());
  const abrirRanking = lat.filter((m) => m.evento === "abrir-ranking");
  expect(abrirRanking.length).toBeGreaterThan(0);
  expect(abrirRanking[0].ms).toBeLessThanOrEqual(200);
});

test("rk-2 una pista sin marcas lo dice y ofrece qué hacer", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true });
  await page.getByTestId("tarjeta-pedregal").click();
  await expect(page.getByTestId("ranking-vacio")).toContainText(
    "Nadie ha corrido aún en El Pedregal. Prueba un coche del Taller o evoluciona uno en esta pista.",
  );
  await expect(page.getByTestId("vacio-taller")).toBeVisible();
  await expect(page.getByTestId("vacio-evolucion")).toBeVisible();
  await page.screenshot({ path: `${DIR}/${ID}-vacio-360x640.png` });
  await page.getByTestId("vacio-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
});

test("rk-4 y rk-3 medir en todas las pistas, y ver correr repite la marca sin tocar el ranking", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true, garaje: [STOCK_CAR] });
  await page.getByTestId("acceso-garaje").click();
  const medir = page.getByTestId("garaje-medir");
  await medir.click();
  await expect(page.getByTestId("progreso-medicion")).toHaveText("Midiendo 1/4…");
  await expect(medir).toBeDisabled();
  await page.screenshot({ path: `${DIR}/${ID}-midiendo-360x640.png` });
  await adelantar(page, 800);
  await expect(page.getByTestId("resumen-medicion")).toContainText("Entra en 4 rankings:");
  await expect(page.getByTestId("progreso-medicion")).toHaveCount(0);
  await expect(medir).toBeEnabled();
  await page.screenshot({ path: `${DIR}/${ID}-medido-360x640.png` });

  const r = await estado(page);
  const texto = (await page.getByTestId("marcas").textContent())!;
  const vistas = new Set<number>();
  for (const t of TRACKS) {
    expect(r.rankings[t.id]).toHaveLength(1);
    const d = r.rankings[t.id][0].distance;
    expectMismaMarca(d, simulateCar(STOCK_CAR, t.id).distance);
    expect(texto).toContain(`${t.name} ${coma(d)}`);
    vistas.add(d);
  }
  expect(vistas.size).toBe(4);
  const lat = await page.evaluate(() => window.__debug!.latencias());
  const medirPistas = lat.filter((m) => m.evento === "medir-pistas");
  expect(medirPistas.length).toBeGreaterThan(0);
  expect(medirPistas[0].ms).toBeLessThanOrEqual(200);

  // rk-3: Ver correr, dentro del mismo motor, llega exactamente a la marca anotada.
  await page.getByTestId("volver").click();
  await page.getByTestId("tarjeta-dunas").click();
  await page.getByTestId("fila-ranking").first().click();
  await page.getByTestId("ver-correr").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await expect.poll(async () => (await estado(page)).genomaEnPista !== null).toBe(true);
  // El mejor de una pista puede tardar más de 200 s simulados en acabar: se adelanta hasta el fin real.
  for (let i = 0; i < 8 && (await estado(page)).ultimoResultado === null; i++) await adelantar(page, 200);
  const fin = await estado(page);
  expect(fin.ultimoResultado!.trackId).toBe("dunas");
  expect(fin.ultimoResultado!.distance).toBe(r.rankings.dunas[0].distance);
  await expect(page.getByTestId("tarjeta-ranking")).toHaveText("Ya está en el ranking de Las Dunas: puesto 1");
  expect(fin.rankings).toEqual(r.rankings);
});

test("rk-5 los rankings se ven bien en los tres tamaños", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, { rankings: "demo" });
    await page.getByTestId("tarjeta-rampa").click();
    await expect(page.getByTestId("fila-ranking")).toHaveCount(10);
    const medidas = await page.evaluate(() => {
      const raiz = document.scrollingElement!;
      const pestanas = document.querySelector<HTMLElement>(".pestanas")!;
      const letras = [...document.querySelectorAll<HTMLElement>(".fila-ranking, .fila-ranking *")].map((e) => parseFloat(getComputedStyle(e).fontSize));
      return { scrollW: raiz.scrollWidth, clientW: raiz.clientWidth, pestW: pestanas.scrollWidth, pestC: pestanas.clientWidth, minLetra: Math.min(...letras) };
    });
    expect(medidas.scrollW).toBeLessThanOrEqual(medidas.clientW);
    expect(medidas.pestW).toBeLessThanOrEqual(medidas.pestC);
    expect(medidas.minLetra).toBeGreaterThanOrEqual(12);
    await page.screenshot({ path: `${DIR}/${ID}-lista-${t.w}x${t.h}.png` });

    await page.getByTestId("fila-ranking").nth(2).click();
    const hoja = (await page.getByTestId("hoja-fila").boundingBox())!;
    const pestana = (await page.getByTestId("pestana-rampa").boundingBox())!;
    expect(hoja.y).toBeGreaterThanOrEqual(pestana.y + pestana.height);
    await page.screenshot({ path: `${DIR}/${ID}-hoja-${t.w}x${t.h}.png` });
  }
});
