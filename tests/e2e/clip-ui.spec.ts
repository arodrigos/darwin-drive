import { test, expect, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { PHYSICS_VERSION } from "../../src/sim/constants";
import { genomeHash, type Genome } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";
import { getTrack } from "../../src/sim/tracks";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "clip-ui";
mkdirSync(DIR, { recursive: true });

const campeon: Genome = (JSON.parse(readFileSync("tests/fixtures/medallas-calibracion.json", "utf8")) as { trackId: string; campeon: Genome }[]).find((f) => f.trackId === "cordillera")!.campeon;
const r = simulateCar(campeon, "cordillera");
const marca = (extra: Record<string, unknown> = {}) => ({
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
  trackVersion: getTrack("cordillera")!.version,
  physicsVersion: PHYSICS_VERSION,
  name: "Tenaz Zorro",
  color: "verde",
  ...extra,
});

/** Cuenta los Workers del clip creados y terminados para comprobar que ninguno queda vivo. */
const CONTAR_WORKERS = () => {
  const w = window as unknown as { __clipW: { creados: number; terminados: number } };
  w.__clipW = { creados: 0, terminados: 0 };
  const Original = window.Worker;
  window.Worker = class extends Original {
    constructor(url: string | URL, o?: WorkerOptions) {
      super(url, o);
      if (String(url).includes("clip")) {
        w.__clipW.creados++;
        const t = this.terminate.bind(this);
        this.terminate = () => {
          w.__clipW.terminados++;
          t();
        };
      }
    }
  };
};

async function abrirHoja(page: Page, extra: Record<string, unknown> = {}) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario({ rankings: { cordillera: [e] } }), marca(extra));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("tarjeta-cordillera").click();
  await expect(page.getByTestId("rankings")).toBeVisible();
  await page.getByTestId("rankings").getByTestId("fila-ranking").first().click();
  await expect(page.getByTestId("hoja-fila")).toBeVisible();
}

test("clipui-1: «Guardar clip» enseña el progreso al momento, acaba y «Descargar» baja el MP4; cancelar no deja Worker", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(CONTAR_WORKERS);
  await page.setViewportSize({ width: 360, height: 640 });
  await abrirHoja(page);
  await page.getByTestId("guardar-clip").click();
  await expect(page.getByTestId("clip-progreso")).toContainText("Generando clip…");
  await expect(page.getByTestId("cancelar-clip")).toBeVisible();
  await page.screenshot({ path: `${DIR}/${ID}-progreso-360x640.png` });
  const l = await page.evaluate(() => window.__debug!.latencias().filter((x) => x.evento === "guardar-clip"));
  expect(l.length).toBeGreaterThan(0);
  expect(l[l.length - 1].trabajoMs).toBeLessThanOrEqual(200);

  // Cancelar a mitad: vuelve el botón y el Worker del clip se termina.
  await page.getByTestId("cancelar-clip").click();
  await expect(page.getByTestId("guardar-clip")).toBeVisible();
  const w = await page.evaluate(() => (window as unknown as { __clipW: { creados: number; terminados: number } }).__clipW);
  expect(w.terminados).toBe(w.creados);

  await page.getByTestId("guardar-clip").click();
  await expect(page.getByTestId("descargar-clip")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("clip-progreso")).toHaveCount(0);
  await page.screenshot({ path: `${DIR}/${ID}-listo-360x640.png` });
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId("descargar-clip").click()]);
  expect(d.suggestedFilename()).toBe(`darwin-cordillera-${Math.floor(r.distance)}m.mp4`);
  const buf = readFileSync((await d.path())!);
  expect(buf.length).toBeGreaterThan(10_000);
  expect(buf.subarray(4, 8).toString("latin1")).toBe("ftyp");
  const w2 = await page.evaluate(() => (window as unknown as { __clipW: { creados: number; terminados: number } }).__clipW);
  expect(w2.terminados).toBe(w2.creados);
  for (const [ancho, alto] of [[820, 1180], [1180, 820]]) {
    await page.setViewportSize({ width: ancho, height: alto });
    await page.screenshot({ path: `${DIR}/${ID}-listo-${ancho}x${alto}.png` });
  }
});

test("clipui-2: «Compartir clip» llama a share solo con {files}; sin canShare solo hay «Descargar»; AbortError no avisa", async ({ browser }) => {
  test.setTimeout(240_000);
  for (const modo of ["ok", "abort", "sin-canshare"] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript((m) => {
      const w = window as unknown as { __share: string[][] };
      w.__share = [];
      Object.defineProperty(navigator, "canShare", { configurable: true, value: m === "sin-canshare" ? () => false : () => true });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: (d: object) => {
          w.__share.push(Object.keys(d));
          return m === "abort" ? Promise.reject(new DOMException("x", "AbortError")) : Promise.resolve();
        },
      });
    }, modo);
    await abrirHoja(page);
    await page.getByTestId("guardar-clip").click();
    await expect(page.getByTestId("descargar-clip")).toBeVisible({ timeout: 180_000 });
    if (modo === "sin-canshare") {
      await expect(page.getByTestId("compartir-clip")).toHaveCount(0);
    } else {
      await page.getByTestId("compartir-clip").click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __share: string[][] }).__share.length)).toBe(1);
      expect(await page.evaluate(() => (window as unknown as { __share: string[][] }).__share[0])).toEqual(["files"]);
      await expect(page.getByTestId("clip-error")).toHaveCount(0);
    }
    await ctx.close();
  }
});

test("clipui-3: sin VideoEncoder no aparece «Guardar clip» y la ayuda lo explica", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "VideoEncoder", { configurable: true, value: undefined });
  });
  await page.setViewportSize({ width: 360, height: 640 });
  await abrirHoja(page);
  await expect(page.getByTestId("ver-repeticion")).toBeVisible();
  await expect(page.getByTestId("guardar-clip")).toHaveCount(0);
  await page.getByTestId("ayuda-boton").click();
  await expect(page.getByText("Tu navegador no puede generar vídeo; «Ver repetición» sigue disponible", { exact: false })).toBeVisible();
  await page.screenshot({ path: `${DIR}/${ID}-sin-soporte-360x640.png` });
});

test("clipui-4: si la generación falla, explica el motivo y termina el Worker", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(CONTAR_WORKERS);
  await page.setViewportSize({ width: 360, height: 640 });
  // Una marca que no coincide con lo que re-simula el Worker: el clip se aborta en vez de enseñar otra carrera.
  await abrirHoja(page, { distance: r.distance + 5 });
  await page.getByTestId("guardar-clip").click();
  await expect(page.getByTestId("clip-error")).toContainText("No se pudo generar el clip:", { timeout: 180_000 });
  await expect(page.getByTestId("clip-error")).toContainText("Prueba otra vez o usa «Ver repetición».");
  await page.screenshot({ path: `${DIR}/${ID}-error-360x640.png` });
  const w = await page.evaluate(() => (window as unknown as { __clipW: { creados: number; terminados: number } }).__clipW);
  expect(w.terminados).toBe(w.creados);
  await expect(page.getByTestId("guardar-clip")).toBeVisible();
});
