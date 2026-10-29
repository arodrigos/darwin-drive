import { test, expect, type Page } from "@playwright/test";
import { simulateCar } from "../../src/sim/race";
import type { Genome } from "../../src/sim/genome";
import type { TrackId } from "../../src/sim/tracks";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "ritmo-pista-1";
const BOTONES = ["evo-ritmo-x1", "evo-ritmo-x2", "evo-ritmo-x4", "evo-ritmo-x8", "evo-ritmo-turbo"];

type Estado = {
  tiempoSim: number | null;
  generacion: number | null;
  pistaEnCarrera: TrackId | null;
  poblacion: { carId: string; genome: Genome }[] | null;
  distanciasGeneracion: Record<string, number> | null;
};
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

async function evolucion(page: Page) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("evolucionar").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await expect.poll(async () => (await estado(page)).poblacion?.length ?? 0).toBe(16);
}

test("rit-10 Evolución tiene ×1 ×2 ×4 ×8 y Turbo, y cambiar de ritmo da las mismas distancias que Node", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await evolucion(page);
  const poblacion = (await estado(page)).poblacion!;
  const pista = (await estado(page)).pistaEnCarrera!;
  const cs: { x: number; y: number; width: number; height: number }[] = [];
  for (const id of BOTONES) cs.push((await page.getByTestId(id).boundingBox())!);
  for (const c of cs) {
    expect(c.width).toBeGreaterThanOrEqual(44);
    expect(c.height).toBeGreaterThanOrEqual(44);
    expect(c.x + c.width).toBeLessThanOrEqual(360);
  }
  await page.screenshot({ path: `${DIR}/${ID}-evolucion-fila-360x640.png` });
  await page.getByTestId("evo-ritmo-x2").click();
  await page.getByTestId("evo-ritmo-x8").click();
  await expect(page.getByTestId("evo-ritmo-x8")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("evo-ritmo-turbo").click();
  await expect.poll(async () => (await estado(page)).generacion, { timeout: 90_000 }).toBe(2);
  const distancias = (await estado(page)).distanciasGeneracion!;
  for (const p of poblacion) expect(distancias[p.carId], p.carId).toBe(simulateCar(p.genome, pista).distance);
});

test("rit-11 con 32 coches a ×8 y el tope de 5, «real ×1,7» no corta Turbo ni mueve la fila", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true, evolucion: "demo-gen-8" }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-continuar").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await page.getByTestId("evo-ritmo-x8").click();
  const antes: unknown[] = [];
  for (const id of BOTONES) antes.push(await page.getByTestId(id).boundingBox());
  await page.evaluate(() => window.__debug!.limitarRitmo(5));
  await expect(page.getByTestId("ritmo-real")).toHaveText("real ×1,7", { timeout: 10_000 });
  const durante: unknown[] = [];
  for (const id of BOTONES) durante.push(await page.getByTestId(id).boundingBox());
  expect(durante).toEqual(antes);
  expect(await page.getByTestId("evo-ritmo-turbo").evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ path: `${DIR}/${ID}-evolucion-real-360x640.png` });
  // El toque responde aunque el dispositivo no llegue.
  await page.getByTestId("evo-ritmo-x4").click();
  const lat = await page.evaluate(() => window.__debug!.latencias().filter((l) => l.evento === "ritmo").map((l) => l.ms));
  expect(Math.min(...lat)).toBeLessThanOrEqual(200);
});
