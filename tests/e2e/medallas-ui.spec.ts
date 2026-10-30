import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PHYSICS_VERSION } from "../../src/sim/constants";
import { medallaDe, NOMBRE_MEDALLA, UMBRALES } from "../../src/app/medallas";
import { TRACKS } from "../../src/sim/tracks";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "medallas-ui-17";
const TAMANOS = [
  { n: "360x640", width: 360, height: 640 },
  { n: "820x1180", width: 820, height: 1180 },
  { n: "1180x820", width: 1180, height: 820 },
];
test.setTimeout(180_000);

const demo = JSON.parse(readFileSync("src/debug/escenarios/rankings-demo.json", "utf8")) as Record<string, Record<string, unknown>[]>;
// El campeón de referencia de la calibración (el de campeones-5k es de una versión anterior de la pista).
const CAMPEON_CORDILLERA = (JSON.parse(readFileSync("tests/fixtures/medallas-calibracion.json", "utf8")) as { trackId: string; campeon: unknown }[]).find((f) => f.trackId === "cordillera")!.campeon;
const version = (id: string) => TRACKS.find((t) => t.id === id)!.version;

/** Una marca con el genoma de la demostración y la distancia o el tiempo que se pide. */
function marca(trackId: string, distance: number, bestStep = 3000) {
  return { ...demo.cordillera[0], distance, bestStep, piezasPerdidas: 0, trackId, trackVersion: version(trackId), physicsVersion: PHYSICS_VERSION };
}

async function abrir(page: Page, escenario: Record<string, unknown>) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e as never), escenario);
}

test("medui-2: la portada enseña la mejor medalla de cada pista y el recuento", async ({ page }) => {
  const oro = UMBRALES.cordillera[version("cordillera")].oro + 1;
  const bronce = UMBRALES.dunas[version("dunas")].bronce + 1;
  // La Recta: el tiempo de autor exige llegar a la meta (5000 m) con bestStep·DT <= autor.
  const pasoAutor = Math.floor(UMBRALES.recta[1].autor * 60) - 1;
  await abrir(page, { rankings: { cordillera: [marca("cordillera", oro)], dunas: [marca("dunas", bronce)], recta: [marca("recta", 5000, pasoAutor)] } });
  await expect(page.getByTestId("medalla-cordillera")).toHaveText("Oro");
  await expect(page.getByTestId("medalla-dunas")).toHaveText("Bronce");
  await expect(page.getByTestId("medalla-recta")).toHaveText("Autor");
  await expect(page.getByTestId("medalla-rampa")).toHaveText("—");
  await expect(page.getByTestId("recuento-medallas")).toHaveText("Medallas: 8 de 40");
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.width, height: t.height });
    await page.getByTestId("zona-records").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${DIR}/${ID}-portada-${t.n}.png` });
  }
});

test("medui-2: sin marcas, el estado vacío invita a ganar la primera", async ({ page }) => {
  await abrir(page, { vacio: true });
  await expect(page.getByTestId("recuento-medallas")).toHaveText("Aún no tienes medallas: termina una carrera para ganar la primera");
  await page.setViewportSize({ width: 360, height: 640 });
  await page.screenshot({ path: `${DIR}/${ID}-portada-vacia-360x640.png` });
});

test("medui-1: la tarjeta de fin da la medalla de la carrera", async ({ page }) => {
  await abrir(page, { vacio: true, genoma: CAMPEON_CORDILLERA, pista: "cordillera" });
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("probar").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await page.evaluate(() => window.__debug!.adelantarSimulacion(900));
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible();
  const r = await page.evaluate(() => window.__debug!.estado().ultimoResultado!);
  const esperada = medallaDe("cordillera", version("cordillera"), r);
  expect(esperada).toBe("autor");
  await expect(page.getByTestId("fin-medalla-nombre")).toHaveText(NOMBRE_MEDALLA[esperada!]);
  await expect(page.getByTestId("fin-medalla-falta")).toHaveText("¡Medalla de autor!");
  await expect(page.getByTestId("fin-medalla-mejor")).toHaveCount(0);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.width, height: t.height });
    await page.screenshot({ path: `${DIR}/${ID}-tarjeta-autor-${t.n}.png` });
  }
});

test("medui-1 límite: una parada a 10 m dice cuánto falta para Bronce", async ({ page }) => {
  await abrir(page, { vacio: true, genoma: CAMPEON_CORDILLERA, pista: "cordillera" });
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("probar").click();
  await page.evaluate(() => window.__debug!.adelantarSimulacion(900));
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible();
  await page.evaluate(() => window.__debug!.forzarTarjetaFin({ distance: 10, reason: "stall" }));
  const bronce = UMBRALES.cordillera[version("cordillera")].bronce;
  await expect(page.getByTestId("fin-medalla-nombre")).toHaveText("Sin medalla");
  await expect(page.getByTestId("fin-medalla-falta")).toHaveText(`Te faltan ${bronce - 10} m para Bronce`);
  // El récord de autor de la carrera anterior ya está en el ranking: «Tu mejor».
  await expect(page.getByTestId("fin-medalla-mejor")).toHaveText("Tu mejor: Autor");
  await page.setViewportSize({ width: 360, height: 640 });
  await page.screenshot({ path: `${DIR}/${ID}-tarjeta-sin-medalla-360x640.png` });
});

test("medui-3: la ayuda de la portada explica las medallas", async ({ page }) => {
  await abrir(page, { vacio: true });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.getByTestId("ayuda-boton").click();
  await expect(page.getByText("la marca del coche de referencia").first()).toBeVisible();
  await page.screenshot({ path: `${DIR}/${ID}-ayuda-360x640.png` });
});
