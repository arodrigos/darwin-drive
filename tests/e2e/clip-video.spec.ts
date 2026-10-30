import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { PHYSICS_VERSION } from "../../src/sim/constants";
import { genomeHash, type Genome } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";
import { getTrack } from "../../src/sim/tracks";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "clip-video";

const campeon: Genome = (JSON.parse(readFileSync("tests/fixtures/medallas-calibracion.json", "utf8")) as { trackId: string; campeon: Genome }[]).find((f) => f.trackId === "cordillera")!.campeon;
const track = getTrack("cordillera")!;
const r = simulateCar(campeon, "cordillera");
const marca = {
  carId: genomeHash(campeon),
  genome: campeon,
  genomeHash: genomeHash(campeon),
  distance: r.distance,
  bestStep: r.bestStep,
  piezasPerdidas: r.piezasPerdidas,
  causaParada: r.causaParada,
  origin: "diseño",
  date: new Date().toISOString(),
  trackId: "cordillera",
  trackVersion: track.version,
  physicsVersion: PHYSICS_VERSION,
  name: "Tenaz Zorro",
  color: "verde",
};

test("clip-1/2/3/6 el clip de un récord es un MP4 válido, reproduce la marca, se ve como la carrera y no congela la interfaz", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario({ rankings: { cordillera: [e] } }), marca);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("tarjeta-cordillera").click();
  await expect(page.getByTestId("rankings")).toBeVisible();

  await page.evaluate(() => {
    const w = window as unknown as { __largas: number[] };
    w.__largas = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__largas.push(e.duration))).observe({ entryTypes: ["longtask"] });
  });
  const c = await page.evaluate(() => window.__debug!.generarClip("cordillera"));

  expect(c.mime).toBe("video/mp4");
  expect(c.cabeceraFtyp).toBe(true);
  expect(c.duracionS).toBeGreaterThanOrEqual(1);
  expect(c.duracionS).toBeLessThanOrEqual(20);
  expect(c.fotogramas).toBe(Math.round(c.duracionS * 30));
  expect([c.ancho, c.alto]).toEqual([640, 360]);
  expect(c.bytes).toBeGreaterThan(10_000);
  expect(c.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(["avc", "vp9"]).toContain(c.codec);
  expect(c.distanciaFinal).toBe(marca.distance);

  // clip-6: ninguna tarea larga de más de 50 ms viene del clip (el dataURL del fotograma es lo único que pasa por el hilo principal).
  const largas = await page.evaluate(() => (window as unknown as { __largas: number[] }).__largas);
  expect(largas.filter((d) => d > 50 + 1)).toEqual([]);

  // clip-3: el fotograma central se abre aparte, a tamaño real, y no es una pantalla negra.
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/${ID}-fotograma-640x360.png`, Buffer.from(c.fotogramaMuestra.split(",")[1], "base64"));
  const fraccionNegra = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const cv = new OffscreenCanvas(img.width, img.height);
    const ctx = cv.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let negros = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 25 && d[i + 1] < 25 && d[i + 2] < 25) negros++;
    return negros / (d.length / 4);
  }, c.fotogramaMuestra);
  expect(fraccionNegra).toBeLessThan(0.6);
});
