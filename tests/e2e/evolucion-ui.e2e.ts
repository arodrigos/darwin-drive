import { test, expect, type Page } from "@playwright/test";
import { simulateCar } from "../../src/sim/race";
import type { Genome } from "../../src/sim/genome";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "evolucion-ui-12";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Estado = {
  pantalla: string;
  pistaEnCarrera: string | null;
  generacion: number | null;
  cochesVivos: number;
  poblacion: { carId: string; genome: Genome }[] | null;
  distanciasGeneracion: Record<string, number> | null;
  favoritos: string[] | null;
  ultimaInscripcion: { trackId: string; isRecord: boolean } | null;
  rankings: Record<string, { carId: string; distance: number; origin: string }[]>;
};
type Evol = { generation: number; trackId: string; favorites: string[]; population: { id: string; parents: string[] }[]; history: unknown[] };

const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);
const adelantar = (page: Page, s: number) => page.evaluate((x) => window.__debug!.adelantarSimulacion(x), s);
const coma = (m: number) => `${m.toFixed(1).replace(".", ",")} m`;

async function abrir(page: Page, escenario: Record<string, unknown> = { vacio: true }, query = "") {
  await page.goto(`/?pruebas=1${query}`);
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

/** Lo que el juego ha guardado de la evolución, leído del mismo almacén que usa la aplicación. */
async function evolucionGuardada(page: Page): Promise<Evol | null> {
  return page.evaluate(
    () =>
      new Promise<Evol | null>((resolve, reject) => {
        const req = indexedDB.open("keyval-store");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const get = req.result.transaction("keyval", "readonly").objectStore("keyval").get("dd:v1:evolution");
          get.onsuccess = () => resolve((get.result as Evol | undefined) ?? null);
          get.onerror = () => reject(get.error);
        };
      }),
  );
}

async function desdeTaller(page: Page) {
  await page.getByTestId("acceso-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
  await page.getByTestId("evolucionar").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await expect.poll(async () => (await estado(page)).poblacion?.length ?? 0).toBe(16);
}

async function desdePanel(page: Page, pista: string) {
  await page.getByTestId("acceso-evolucion").click();
  await expect(page.getByTestId("inicio-evolucion")).toBeVisible();
  await page.getByTestId("selector-pista").click();
  await page.getByTestId(`pista-${pista}`).click();
  await page.getByTestId("empezar-evolucion").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await expect.poll(async () => (await estado(page)).poblacion?.length ?? 0).toBe(16);
}

async function latencia(page: Page, evento: string) {
  return page.evaluate((e) => window.__debug!.latencias().filter((l) => l.evento === e), evento);
}

// Node y Chromium no comparten las mismas funciones matemáticas al último bit: dentro del mismo motor la igualdad es exacta.
function expectMismaMarca(navegador: number, nucleo: number) {
  expect(Math.abs(navegador - nucleo)).toBeLessThanOrEqual(Math.max(1, nucleo * 0.005));
}

/** Toca una rejilla de puntos alrededor del centro de la pista con la carrera en pausa, hasta que un coche responda. */
async function marcarFavorito(page: Page) {
  const caja = (await page.getByTestId("lienzo").boundingBox())!;
  const cx = caja.x + caja.width / 2;
  const cy = caja.y + caja.height / 2;
  for (let r = 0; r <= 6; r++) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      await page.mouse.click(cx + dx * r * 30, cy + dy * r * 30);
      if (await page.getByTestId("aviso-favorito").isVisible()) return;
    }
  }
  throw new Error("ningún coche respondió al toque");
}

test("ev-1 evolucionar este coche, dos generaciones y continuar tras recargar", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await desdeTaller(page);
  await expect(page.getByTestId("contador")).toHaveText("Gen 1 · 16 vivos · La Cordillera");
  expect((await estado(page)).pistaEnCarrera).toBe("cordillera");
  await page.screenshot({ path: `${DIR}/${ID}-gen1-360x640.png` });

  await adelantar(page, 200);
  await adelantar(page, 200);
  const e = await estado(page);
  expect(e.generacion).toBe(3);
  expect(e.pistaEnCarrera).toBe("cordillera");
  await expect(page.getByTestId("grafica").locator("svg")).toHaveAttribute("data-puntos", "2");
  const guardada = (await evolucionGuardada(page))!;
  expect(guardada.generation).toBe(3);
  const ids = guardada.population.map((p) => p.id);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await expect(page.getByTestId("acceso-continuar")).toHaveText("Continuar evolución (gen 3 · La Cordillera)");
  await page.getByTestId("acceso-continuar").click();
  await expect.poll(async () => (await estado(page)).poblacion?.length ?? 0).toBe(16);
  expect((await estado(page)).poblacion!.map((p) => p.carId)).toEqual(ids);
  await expect(page.getByTestId("contador")).toHaveText("Gen 3 · 16 vivos · La Cordillera");
});

test("ev-9 el panel de evolución corre en la pista elegida y la gen 2 sigue en ella", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true }, "&semilla=11");
  await page.getByTestId("acceso-evolucion").click();
  await expect(page.getByTestId("selector-pista")).toBeVisible();
  await page.screenshot({ path: `${DIR}/${ID}-panel-360x640.png` });
  await page.getByTestId("selector-pista").click();
  await page.getByTestId("pista-rampa").click();
  await page.getByTestId("empezar-evolucion").click();
  await expect.poll(async () => (await estado(page)).poblacion?.length ?? 0).toBe(16);
  const gen1 = (await estado(page)).poblacion!;
  expect((await estado(page)).pistaEnCarrera).toBe("rampa");
  await adelantar(page, 200);
  const e = await estado(page);
  for (const c of gen1) expectMismaMarca(e.distanciasGeneracion![c.carId], simulateCar(c.genome, "rampa").distance);
  expect(e.pistaEnCarrera).toBe("rampa");
  await expect(page.getByTestId("contador")).toHaveText("Gen 2 · 16 vivos · La Rampa");
});

test("ev-2 turbo: barra de progreso, generaciones nuevas y pausa inmediata", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await desdeTaller(page);
  await page.getByTestId("ritmo-turbo").click();
  await expect(page.getByTestId("barra-progreso-texto")).toHaveText(/^Gen \d+ · \d+\/16 coches$/);
  await expect.poll(async () => (await estado(page)).generacion ?? 0, { timeout: 90_000, intervals: [1000] }).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: `${DIR}/${ID}-turbo-360x640.png` });
  await page.getByTestId("pausar").click();
  await expect(page.getByTestId("pausar")).toHaveText("Seguir");
  const p = await latencia(page, "pausar");
  expect(p.length).toBeGreaterThan(0);
  expect(p[p.length - 1].ms).toBeLessThanOrEqual(200);
});

test("ev-3 el campeón entra en el ranking de su pista y se guarda en el garaje", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await desdeTaller(page);
  await adelantar(page, 200);
  const e = await estado(page);
  expect(e.ultimaInscripcion).toMatchObject({ trackId: "cordillera", isRecord: true });
  expect(["diseño", "mixto"]).toContain(e.rankings.cordillera[0].origin);
  const distancia = e.rankings.cordillera[0].distance;
  await page.getByTestId("guardar-campeon").click();
  await expect(page.getByTestId("aviso-guardado")).toBeVisible();
  await page.getByTestId("volver").click();
  await page.getByTestId("acceso-garaje").click();
  await expect(page.getByTestId("tarjeta-coche")).toHaveCount(1);
  await expect(page.getByTestId("marcas")).toHaveText(`La Cordillera ${coma(distancia)}`);
  await expect(page.getByTestId("origen")).toHaveText(/dise|mixt/i);
});

test("ev-4 un favorito se ve marcado, avisa y tiene hijos seguro", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await desdeTaller(page);
  await page.getByTestId("pausar").click();
  await marcarFavorito(page);
  await expect(page.getByTestId("aviso-favorito")).toHaveText("Favorito: tendrá hijos seguro");
  const l = await latencia(page, "favorito");
  expect(l.length).toBeGreaterThan(0);
  expect(l[l.length - 1].ms).toBeLessThanOrEqual(200);
  await page.screenshot({ path: `${DIR}/${ID}-favorito-360x640.png` });
  await expect(page.getByTestId("aviso-favorito")).toBeHidden({ timeout: 4000 });
  const favoritos = (await estado(page)).favoritos!;
  expect(favoritos).toHaveLength(1);
  await page.getByTestId("pausar").click();
  await adelantar(page, 200);
  const guardada = (await evolucionGuardada(page))!;
  const hijos = guardada.population.filter((p) => p.parents.includes(favoritos[0]));
  expect(hijos.length).toBeGreaterThanOrEqual(2);
});

test("ev-5 ayudas y valores por defecto, gráfica vacía y aviso de estancada", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await page.getByTestId("acceso-evolucion").click();
  await expect(page.getByTestId("ayuda-pista")).toHaveText("Pista: la evolución buscará los coches que más lejos lleguen en ella.");
  await expect(page.getByTestId("valor-poblacion")).toHaveText("16");
  await expect(page.getByTestId("valor-elite")).toHaveText("2");
  await expect(page.getByTestId("valor-probabilidad")).toHaveText("5 %");
  await page.getByTestId("empezar-evolucion").click();
  await expect(page.getByTestId("grafica-vacia")).toHaveText("Aún no ha terminado ninguna generación");

  await abrir(page, { vacio: true, evolucion: { generacion: 9, stagnantFor: 6 } });
  await page.getByTestId("acceso-continuar").click();
  await expect(page.getByTestId("aviso-estancada")).toHaveText("Estancada: subo la mutación para buscar ideas nuevas");
  await page.screenshot({ path: `${DIR}/${ID}-estancada-360x640.png` });
});

test("ev-6 el aviso de generación da la mejor distancia y su cambio", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true, evolucion: "demo-gen-8" });
  await page.getByTestId("acceso-continuar").click();
  await expect.poll(async () => (await estado(page)).poblacion?.length ?? 0).toBe(16);
  await adelantar(page, 200);
  await expect(page.getByTestId("aviso-generacion")).toHaveText(/^Gen 8: mejor \d+,\d m \([+−]\d+,\d m\)$/);
  await page.screenshot({ path: `${DIR}/${ID}-aviso-gen-360x640.png` });
});

test("ev-7 cambiar de ritmo no cambia las distancias", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true }, "&semilla=11");
  await desdePanel(page, "rampa");
  await adelantar(page, 200);
  const rapido = (await estado(page)).distanciasGeneracion!;

  await abrir(page, { vacio: true }, "&semilla=11");
  await page.getByTestId("acceso-evolucion").click();
  await page.getByTestId("selector-pista").click();
  await page.getByTestId("pista-rampa").click();
  await page.getByTestId("empezar-evolucion").click();
  await expect.poll(async () => (await estado(page)).poblacion?.length ?? 0).toBe(16);
  await page.getByTestId("ritmo-x4").click();
  await page.getByTestId("ritmo-turbo").click();
  await expect.poll(async () => (await estado(page)).generacion ?? 0, { timeout: 90_000, intervals: [500] }).toBeGreaterThanOrEqual(2);
  await page.getByTestId("pausar").click();
  const turbo = (await estado(page)).distanciasGeneracion!;
  expect(turbo).toEqual(rapido);
});

for (const t of TAMANOS) {
  test(`ev-8 capturas de la evolución a ${t.w}x${t.h}`, async ({ page }) => {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page, { vacio: true, evolucion: "demo-gen-8" });
    await page.getByTestId("acceso-evolucion").click();
    await expect(page.getByTestId("empezar-evolucion")).toBeVisible();
    await page.screenshot({ path: `${DIR}/${ID}-panel-${t.w}x${t.h}.png` });
    await page.getByTestId("volver").click();
    await page.getByTestId("acceso-continuar").click();
    await expect.poll(async () => (await estado(page)).poblacion?.length ?? 0).toBe(16);
    await expect(page.getByTestId("grafica")).toBeVisible();
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(ancho).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${DIR}/${ID}-carrera-${t.w}x${t.h}.png` });
    await page.getByTestId("ritmo-turbo").click();
    await expect(page.getByTestId("turbo-panel")).toBeVisible();
    await page.screenshot({ path: `${DIR}/${ID}-turbo-${t.w}x${t.h}.png` });
    await page.getByTestId("pausar").click();
  });
}
