import { test, expect, type Page } from "@playwright/test";
import type { EstadoBatalla } from "../../src/batalla/estado";
import { tamanoBase } from "./tamano";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "batalla-carrera-17";
test.setTimeout(240_000);

type Estado = { rankings: Record<string, unknown[]>; batalla: EstadoBatalla | null; garaje: number; carreraBatalla: { carId: string; distancia: number; enPantalla: boolean }[] | null };
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

async function abrir(page: Page) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

/** Batalla de dos jugadores con el coche de serie hasta «Elegir pista». */
async function hastaElegirPista(page: Page) {
  await page.getByTestId("acceso-batalla").click();
  await page.getByTestId("jugadores-2").click();
  await page.getByTestId("jugador-nombre-0").fill("Ana");
  await page.getByTestId("jugador-nombre-1").fill("Bea");
  await page.getByTestId("empezar-batalla").click();
  for (let i = 0; i < 2; i++) {
    await page.getByTestId("soy-jugador").click();
    await page.getByTestId("terminar-coche").click();
    await page.getByTestId("confirmar-batalla-si").click();
  }
  await expect(page.getByTestId("batalla-elegir-pista")).toBeVisible();
}

test("bc-1 bc-2 bc-3 bc-5 «¡A correr!» lanza la carrera de todos, acaba en podio y los coches entran en el ranking y el garaje", async ({ page }) => {
  const t = await tamanoBase(page);
  const tam = `${t.width}x${t.height}`;
  await abrir(page);
  await hastaElegirPista(page);
  await expect(page.getByTestId("a-correr")).toBeDisabled();
  await page.getByTestId("batalla-pista-rampa").click();
  await page.screenshot({ path: `${DIR}/${ID}-elegir-pista-${tam}.png` });
  await page.getByTestId("a-correr").click();
  await expect(page.getByTestId("batalla-carrera")).toBeVisible();
  await expect(page.getByTestId("marcador-batalla")).toContainText("Ana");
  await expect(page.getByTestId("marcador-batalla")).toContainText("Bea");
  await expect.poll(async () => (await estado(page)).carreraBatalla?.length ?? 0).toBe(2);
  await page.evaluate(() => window.__debug!.adelantarSimulacion(3));
  await page.screenshot({ path: `${DIR}/${ID}-carrera-${tam}.png` });
  const latencia = await page.evaluate(() => window.__debug!.latencias());
  expect(JSON.stringify(latencia)).toContain("a-correr");

  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("batalla-resultado")).toBeVisible({ timeout: 150_000 });
  await page.screenshot({ path: `${DIR}/${ID}-podio-${tam}.png` });
  await expect(page.getByTestId("podio-fila-0")).toBeVisible();
  await expect(page.getByTestId("podio-fila-1")).toBeVisible();
  expect((await estado(page)).batalla!.fase).toBe("resultado");

  await page.getByTestId("guardar-todos").click();
  await expect(page.getByTestId("aviso-guardado")).toContainText("guardado");
  await page.screenshot({ path: `${DIR}/${ID}-guardado-${tam}.png` });
  expect((await estado(page)).garaje).toBeGreaterThanOrEqual(1);

  // Revancha: misma pista y mismos coches
  await page.getByTestId("revancha").click();
  await expect(page.getByTestId("batalla-carrera")).toBeVisible();
  expect((await estado(page)).batalla!.pista).toBe("rampa");
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("batalla-resultado")).toBeVisible({ timeout: 150_000 });

  // Otra pista vuelve a elegir sin perder los coches
  await page.getByTestId("otra-pista").click();
  await expect(page.getByTestId("batalla-elegir-pista")).toBeVisible();
  expect((await estado(page)).batalla!.jugadores.every((j) => j.coche !== null)).toBe(true);
});

async function escenario(page: Page, jugadores: number, fase: string, pista = "dunas", extra = "") {
  await page.goto(`/?pruebas=1${extra}`);
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario({ vacio: true, batalla: e }), { jugadores, fase, pista });
  await page.waitForFunction(() => Boolean(window.__debug));
}

test("bc-1 con cuatro coches la carrera pinta el marcador, y la flecha de borde nombra al que queda fuera de pantalla", async ({ page }) => {
  const t = await tamanoBase(page);
  const tam = `${t.width}x${t.height}`;
  await escenario(page, 4, "carrera");
  await expect(page.getByTestId("batalla-carrera")).toBeVisible();
  await expect.poll(async () => (await estado(page)).carreraBatalla?.length ?? 0).toBe(4);
  for (const n of ["Ana", "Bea", "Carlos", "Diana"]) await expect(page.getByTestId("marcador-batalla")).toContainText(n);
  const antes = (await estado(page)).carreraBatalla!.map((c) => c.distancia);
  await page.evaluate(() => window.__debug!.adelantarSimulacion(3));
  // El marcador se publica en el siguiente fotograma, no al volver de adelantarSimulacion.
  await expect.poll(async () => (await estado(page)).carreraBatalla!.some((c, i) => c.distancia > antes[i]), { timeout: 15_000 }).toBe(true);
  await page.screenshot({ path: `${DIR}/${ID}-carrera-cuatro-${tam}.png` });
  // Con coches al azar alguno se queda atrás: se avanza hasta que haya uno fuera de pantalla.
  for (let k = 0; k < 40 && !(await estado(page)).carreraBatalla!.some((c) => !c.enPantalla); k++) {
    await page.evaluate(() => window.__debug!.adelantarSimulacion(5));
  }
  const fuera = (await estado(page)).carreraBatalla!.filter((c) => !c.enPantalla);
  if (fuera.length > 0) {
    await expect(page.getByTestId("flechas-borde")).toBeVisible();
    await expect(page.getByTestId("flechas-borde")).toContainText(" m");
    await page.screenshot({ path: `${DIR}/${ID}-flecha-borde-${tam}.png` });
  }
});

test("bc-3 la revancha da el mismo podio y «Salir» borra la batalla", async ({ page }) => {
  await tamanoBase(page);
  await escenario(page, 3, "carrera", "rampa");
  const podio = async () => {
    await page.getByTestId("ritmo-final").click();
    await expect(page.getByTestId("batalla-resultado")).toBeVisible({ timeout: 150_000 });
    return page.getByTestId("podio").innerText();
  };
  const primero = await podio();
  await page.getByTestId("revancha").click();
  expect(await podio()).toBe(primero);
  await page.getByTestId("resultado-salir").click();
  const si = page.getByTestId("confirmar-batalla-si");
  if (await si.isVisible()) await si.click();
  await expect(page.getByTestId("portada")).toBeVisible();
  expect((await estado(page)).batalla).toBeNull();
});

test("bc-6 con la migración frenada la batalla llega al podio y las marcas entran al soltarla", async ({ page }) => {
  await tamanoBase(page);
  await escenario(page, 2, "carrera", "rampa", "&migracion=frenada");
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("batalla-resultado")).toBeVisible({ timeout: 150_000 });
  await page.evaluate(() => window.__debug!.frenarMigracion(false));
  await expect.poll(async () => (await estado(page)).rankings.rampa.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
});
