import { test, expect, type Page } from "@playwright/test";

type Motor = { workersCreados: number; workersPool: number; workersPoolVivos: number };
type Evo = { generacion: number | null; poblacion: unknown; distanciasGeneracion: Record<string, number> | null };
type Mig = { rankings: unknown; migracion: { enCurso: boolean; hechos: number; total: number } };
const motor = (page: Page) => page.evaluate(() => window.__debug!.motor() as unknown as Motor);

async function cargar(page: Page, query: string, escenario: Record<string, unknown>) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario({ vacio: true, ...e }), escenario);
  await page.goto(`/?pruebas=1${query}`);
  await page.waitForFunction(() => Boolean(window.__debug));
}

async function evolucionHastaGen3(page: Page, workers: number) {
  await cargar(page, `&workers=${workers}`, { evolucion: "demo-gen-8" });
  await page.getByTestId("acceso-continuar").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await page.getByTestId("evo-ritmo-turbo").click();
  const base = (await page.evaluate(() => window.__debug!.estado() as unknown as Evo)).generacion!;
  await expect.poll(async () => (await page.evaluate(() => window.__debug!.estado() as unknown as Evo)).generacion, { timeout: 400_000 }).toBe(base + 1);
  const e = await page.evaluate(() => window.__debug!.estado() as unknown as Evo);
  return { poblacion: e.poblacion, distancias: e.distanciasGeneracion, m: await motor(page) };
}

// Dos tests en serie en vez de uno con dos generaciones: en el runner de CI cada generación real tarda varios minutos y juntas
// agotaban el timeout del test entero (431b3cb). El resultado con un Worker se guarda para compararlo en el segundo.
test.describe.configure({ mode: "serial" });
let referencia: Awaited<ReturnType<typeof evolucionHastaGen3>> | null = null;

test("poolint-1 Turbo con un Worker: generación de referencia sin pool", async ({ page }) => {
  test.setTimeout(420_000);
  referencia = await evolucionHastaGen3(page, 1);
  expect(referencia.m.workersPool).toBe(0);
});

test("poolint-1/3 Turbo con pool da la misma generación que con un Worker y los Workers se terminan al salir", async ({ page }) => {
  test.setTimeout(420_000);
  expect(referencia, "depende del test de referencia anterior").not.toBeNull();
  const cuatro = await evolucionHastaGen3(page, 4);
  expect(cuatro.poblacion).toEqual(referencia!.poblacion);
  expect(cuatro.distancias).toEqual(referencia!.distancias);
  expect(cuatro.m.workersPool).toBeGreaterThanOrEqual(2);
  expect(cuatro.m.workersPoolVivos).toBeGreaterThanOrEqual(2);
  expect(cuatro.m.workersCreados).toBe(1);
  await page.getByTestId("volver").click();
  await expect.poll(async () => (await motor(page)).workersPoolVivos).toBe(0);
  expect((await motor(page)).workersCreados).toBe(1);
});

test("poolint-2 la migración con pool deja los mismos rankings que con un Worker", async ({ browser }) => {
  test.setTimeout(240_000);
  const escenario = { rankings: "demo-version-anterior" };
  const resultados: Mig[] = [];
  let pool = 0;
  for (const w of [1, 4]) {
    const page = await (await browser.newContext()).newPage();
    await cargar(page, `&workers=${w}`, escenario);
    await expect.poll(async () => (await page.evaluate(() => window.__debug!.estado() as unknown as Mig)).migracion.hechos, { timeout: 180_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await page.evaluate(() => window.__debug!.estado() as unknown as Mig)).migracion.enCurso, { timeout: 180_000 }).toBe(false);
    resultados.push(await page.evaluate(() => window.__debug!.estado() as unknown as Mig));
    if (w === 4) {
      pool = (await motor(page)).workersPool;
      expect((await motor(page)).workersPoolVivos).toBe(0);
    }
  }
  expect(resultados[1].rankings).toEqual(resultados[0].rankings);
  expect(pool).toBeGreaterThanOrEqual(2);
});

test("poolint-2 un lote de Especies con pool termina y suelta sus Workers", async ({ page }) => {
  test.setTimeout(240_000);
  await cargar(page, "&workers=4", {});
  await page.getByTestId("acceso-especies").click();
  await page.getByTestId("explorar-especies").click();
  await expect.poll(async () => (await motor(page)).workersPool, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("aviso-especies")).toBeVisible({ timeout: 120_000 });
  expect((await motor(page)).workersPoolVivos).toBe(0);
});
