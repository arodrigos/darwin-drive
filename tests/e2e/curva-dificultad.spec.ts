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
  // Las seis simulaciones de Node, la espera de la migración (hasta 120 s) y la comprobación final caben con holgura.
  test.setTimeout(360_000);
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
  // Se espera con un bucle propio y no con expect.poll: si se agota, el error dice qué marcas había, que es lo único
  // que distingue una migración lenta de una que mide otra cosa. La comparación admite 0,5 m por si el navegador y
  // Node redondean distinto la curva.
  const faltan = async () => {
    const r = (await estado(page)).rankings;
    const mal: string[] = [];
    for (const id of ["cordillera", "rampa"] as const)
      for (const [c, d] of esperadas[id]) {
        const e = r[id].find((x) => x.carId === c);
        if (!e || Math.abs(e.distance - (d as number)) > 0.5) mal.push(`${id}/${String(c).slice(0, 6)}:${e ? e.distance.toFixed(1) : "-"}≠${(d as number).toFixed(1)}`);
      }
    return mal;
  };
  const limite = Date.now() + 120_000;
  let mal = await faltan();
  while (mal.length > 0 && Date.now() < limite) {
    await page.waitForTimeout(1000);
    mal = await faltan();
  }
  if (mal.length > 0) throw new Error(`la migración no dejó las marcas medidas con las pistas nuevas: ${mal.slice(0, 4).join(" ")} (${mal.length} de 6) ${JSON.stringify((await estado(page)).migracion)}`);
  await expect.poll(async () => (await estado(page)).migracion.enCurso, { timeout: 30_000 }).toBe(false);

  // El aviso de fin de migración tapa el selector hasta que se cierra.
  const aviso = page.getByTestId("aviso-migracion");
  if (await aviso.isVisible()) await page.getByTestId("aviso-migracion-cerrar").click();
  await page.getByTestId("tarjeta-cordillera").click();
  await expect(page.getByTestId("rankings")).toBeVisible();
  // Rankings ya no lleva el selector de pista (tiene pestañas): las miniaturas se miran en Explorar.
  await page.getByRole("button", { name: "← Volver" }).click();
  await page.getByTestId("acceso-explorar").click();
  await page.getByTestId("selector-pista").click();
  await expect(page.getByTestId("hoja-pistas")).toBeVisible();
  for (const id of ["cordillera", "rampa", "dunas", "pedregal"]) await expect(page.getByTestId(`miniatura-${id}`)).toBeVisible();
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(t.w);
    await page.screenshot({ path: `${DIR}/${ID}-explorar-${t.w}x${t.h}.png` });
  }
});
