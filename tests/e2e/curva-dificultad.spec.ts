import { test, expect, type Page } from "@playwright/test";
import demoJson from "../../src/debug/escenarios/rankings-demo.json";
import type { Genome } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";
import type { TrackId } from "../../src/sim/tracks";

const demo = demoJson as unknown as Record<TrackId, { carId: string; genome: Genome }[]>;
const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "curva-dificultad-1";
const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];
const ESCENARIO = { rankings: "demo-version-anterior" };

type Estado = {
  rankings: Record<TrackId, { carId: string; distance: number }[]>;
  migracion: { enCurso: boolean };
};
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

test("dif-3 / dif-4 una partida de la versión anterior se pone al día sola y las miniaturas se ven con relieve", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario({ vacio: true, ...e }), ESCENARIO);
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));

  // Los mismos coches, con la marca que da el núcleo con las pistas nuevas. Se espera a ver esas marcas y no a que
  // «enCurso» sea falso, que también lo es antes de que la migración arranque.
  const esperadas = Object.fromEntries(
    (["cordillera", "rampa"] as const).map((id) => [
      id,
      demo[id].slice(0, 3).map((e) => [e.carId, simulateCar(e.genome, id).distance]),
    ]),
  );
  await expect
    .poll(
      async () => {
        const r = (await estado(page)).rankings;
        return Object.fromEntries(
          (["cordillera", "rampa"] as const).map((id) => [id, r[id].filter((e) => esperadas[id].some(([c, d]) => c === e.carId && d === e.distance)).length]),
        );
      },
      { timeout: 120_000, message: "la migración no dejó las marcas medidas con las pistas nuevas" },
    )
    .toEqual({ cordillera: 3, rampa: 3 });
  await expect.poll(async () => (await estado(page)).migracion.enCurso, { timeout: 30_000 }).toBe(false);

  // El aviso de fin de migración tapa el selector hasta que se cierra.
  const aviso = page.getByTestId("aviso-migracion");
  if (await aviso.isVisible()) await page.getByTestId("aviso-migracion-cerrar").click();
  await page.getByTestId("tarjeta-cordillera").click();
  await expect(page.getByTestId("rankings")).toBeVisible();
  await page.getByTestId("selector-pista").click();
  await expect(page.getByTestId("hoja-pistas")).toBeVisible();
  for (const id of ["cordillera", "rampa", "dunas", "pedregal"]) await expect(page.getByTestId(`miniatura-${id}`)).toBeVisible();
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(t.w);
    await page.screenshot({ path: `${DIR}/${ID}-explorar-${t.w}x${t.h}.png` });
  }
});
