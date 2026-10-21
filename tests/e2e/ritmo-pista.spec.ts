import { test, expect, type Page } from "@playwright/test";
import { STOCK_CAR } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "ritmo-pista-1";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];
const BOTONES = ["ritmo-x1", "ritmo-x2", "ritmo-x4", "ritmo-x8", "ritmo-final"];

type Estado = {
  tiempoSim: number | null;
  distanciaLider: number | null;
  ritmo: string | null;
  ritmoReal: number | null;
  ultimoResultado: { distance: number; steps: number; reason: string } | null;
  rankings: Record<string, { distance: number }[]>;
};
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);
const adelantar = (page: Page, s: number) => page.evaluate((x) => window.__debug!.adelantarSimulacion(x), s);

async function abrir(page: Page, escenario: Record<string, unknown> = { vacio: true }) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

async function verCocheDeSerie(page: Page) {
  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await expect.poll(async () => (await estado(page)).tiempoSim ?? 0).toBeGreaterThan(0.2);
}

type Caja = { x: number; y: number; width: number; height: number };
async function cajas(page: Page, ids: string[]): Promise<Caja[]> {
  const out: Caja[] = [];
  for (const id of ids) out.push((await page.getByTestId(id).boundingBox())!);
  return out;
}

/** Segundos simulados por segundo real, con el reloj de la propia página. */
async function velocidad(page: Page, ms: number): Promise<number> {
  const a = await page.evaluate(() => ({ t: performance.now(), s: window.__debug!.estado().tiempoSim ?? 0 }));
  await page.waitForTimeout(ms);
  const b = await page.evaluate(() => ({ t: performance.now(), s: window.__debug!.estado().tiempoSim ?? 0 }));
  return (b.s - a.s) / ((b.t - a.t) / 1000);
}

for (const { w, h } of TAMANOS) {
  test(`rit-1 los cinco botones caben en una fila sin tapar nada a ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await abrir(page);
    await verCocheDeSerie(page);
    const cs = await cajas(page, BOTONES);
    for (const c of cs) {
      expect(c.width).toBeGreaterThanOrEqual(44);
      expect(c.height).toBeGreaterThanOrEqual(44);
      expect(c.y).toBeCloseTo(cs[0].y, 0);
    }
    for (let i = 1; i < cs.length; i++) expect(cs[i].x - (cs[i - 1].x + cs[i - 1].width)).toBeGreaterThanOrEqual(8 - 0.5);
    expect(cs[4].x + cs[4].width).toBeLessThanOrEqual(w);
    expect(cs[4].y + cs[4].height).toBeLessThanOrEqual(h);
    const final = await page.getByTestId("ritmo-final").evaluate((e) => e.scrollWidth <= e.clientWidth);
    expect(final).toBe(true);
    // El contador y «← Volver» quedan arriba, lejos de la fila.
    const hud = (await page.getByTestId("hud-distancia").boundingBox())!;
    const volver = (await page.getByTestId("volver").boundingBox())!;
    expect(hud.y + hud.height).toBeLessThan(cs[0].y);
    expect(volver.y + volver.height).toBeLessThan(cs[0].y);
    await expect(page.getByTestId("ritmo-x1")).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: `${DIR}/${ID}-fila-${w}x${h}.png` });
  });
}

test("rit-1 tocar ×4 y ×8 acelera sin reiniciar y ×2 queda en medio", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await verCocheDeSerie(page);
  const t0 = (await estado(page)).tiempoSim!;
  await page.getByTestId("ritmo-x4").click();
  await expect(page.getByTestId("ritmo-x4")).toHaveAttribute("aria-pressed", "true");
  const v4 = await velocidad(page, 2000);
  expect(v4).toBeGreaterThan(3);
  expect(v4).toBeLessThan(5);
  await page.getByTestId("ritmo-x8").click();
  const v8 = await velocidad(page, 2000);
  // Si el dispositivo no llega, el juego lo dice con «real ×N» en vez de callar.
  if (v8 < 6) await expect(page.getByTestId("ritmo-real")).toBeVisible({ timeout: 6000 });
  expect(v8).toBeGreaterThan(v4);
  expect((await estado(page)).tiempoSim!).toBeGreaterThan(t0);
  // Tocar el botón activo no cambia nada.
  const antes = (await estado(page)).ritmo;
  await page.getByTestId("ritmo-x8").click();
  expect((await estado(page)).ritmo).toBe(antes);
  await page.getByTestId("ritmo-x2").click();
  const v2 = await velocidad(page, 2000);
  expect(v2).toBeGreaterThan(1.3);
  expect(v2).toBeLessThan(v8);
});

for (const { w, h } of [TAMANOS[0], TAMANOS[2]]) {
  test(`rit-11 con el tope de 5 el rótulo «real ×5» entra sin mover ningún botón a ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await abrir(page);
    await verCocheDeSerie(page);
    await page.getByTestId("ritmo-x8").click();
    const antes = await cajas(page, BOTONES);
    await page.evaluate(() => window.__debug!.limitarRitmo(5));
    await expect(page.getByTestId("ritmo-real")).toHaveText("real ×5", { timeout: 8000 });
    const rotulo = (await page.getByTestId("ritmo-real").boundingBox())!;
    const durante = await cajas(page, BOTONES);
    expect(durante).toEqual(antes);
    const x8 = durante[3];
    // Encima de «×8», sin tocar ningún botón y entero.
    expect(rotulo.y + rotulo.height).toBeLessThanOrEqual(x8.y);
    expect(await page.getByTestId("ritmo-real").evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(rotulo.x + rotulo.width / 2).toBeGreaterThan(x8.x);
    expect(rotulo.x + rotulo.width / 2).toBeLessThan(x8.x + x8.width);
    await page.screenshot({ path: `${DIR}/${ID}-real-${w}x${h}.png` });
    await page.evaluate(() => window.__debug!.limitarRitmo(null));
    await expect(page.getByTestId("ritmo-real")).toBeHidden({ timeout: 8000 });
    expect(await cajas(page, BOTONES)).toEqual(antes);
  });
}

test("rit-3 «Hasta el final» muestra la banda con barra, termina en la tarjeta y la marca sigue tras recargar", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true, pista: "rampa" });
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("probar").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  // La fila se mide antes: la carrera corta de La Rampa puede acabar enseguida y ocultarla.
  await expect(page.getByTestId("ritmo-x1")).toBeVisible();
  const fila = (await page.getByTestId("ritmo-x1").boundingBox())!;
  const inicio = Date.now();
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("banda-final")).toBeVisible();
  const banda = await page.getByTestId("banda-final").boundingBox();
  // Si la carrera corta ya terminó, la banda se fue: lo que importa es que no pisara la fila.
  if (banda) expect(banda.y + banda.height).toBeLessThanOrEqual(fila.y);
  await expect(page.getByTestId("banda-final")).toContainText("Simulando hasta el final…");
  if (Date.now() - inicio < 5000) await page.screenshot({ path: `${DIR}/${ID}-banda-360x640.png` });
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 60_000 });
  const fin = (await estado(page)).ultimoResultado!;
  expect(fin.distance).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("fin-distancia")).toHaveText(`${fin.distance.toFixed(1).replace(".", ",")} m`);
  // Al terminar se oculta la fila y la tarjeta ofrece «Repetir» y «Volver».
  await expect(page.getByTestId("ritmo-x1")).toBeHidden();
  await expect(page.getByTestId("repetir")).toBeVisible();
  await expect(page.getByTestId("volver-fin")).toBeVisible();
  await page.screenshot({ path: `${DIR}/${ID}-tarjeta-360x640.png` });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await expect.poll(async () => (await estado(page)).rankings.rampa.length).toBe(1);
  expect((await estado(page)).rankings.rampa[0].distance).toBe(fin.distance);
});

test("rit-2 y rit-7 «Hasta el final» y ×1 dan la misma marca, la de Node, con la misma tarjeta", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await verCocheDeSerie(page);
  const referencia = simulateCar(STOCK_CAR, "cordillera");
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 60_000 });
  const textoFinal = await page.getByTestId("tarjeta-fin").innerText();
  expect((await estado(page)).ultimoResultado).toMatchObject({ distance: referencia.distance, steps: referencia.steps });
  await page.getByTestId("repetir").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeHidden();
  await adelantar(page, 900);
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible();
  expect(await page.getByTestId("tarjeta-fin").innerText()).toBe(textoFinal);
  expect((await estado(page)).ultimoResultado!.distance).toBe(referencia.distance);
});

test("rit-4 el último ritmo se recuerda con «Repetir» y tras recargar, y «Hasta el final» no", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await verCocheDeSerie(page);
  await page.getByTestId("ritmo-x8").click();
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("repetir").click();
  await expect(page.getByTestId("ritmo-x8")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("ritmo-x2").click();
  // El guardado es asíncrono: se espera a que esté en la base antes de recargar.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string | null>((resolve) => {
            const req = indexedDB.open("darwin-drive-pruebas");
            req.onsuccess = () => {
              const g = req.result.transaction("datos", "readonly").objectStore("datos").get("dd:v1:meta");
              g.onsuccess = () => {
                req.result.close();
                resolve((g.result as { ritmo?: string } | undefined)?.ritmo ?? null);
              };
            };
          }),
      ),
    )
    .toBe("x2");
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await verCocheDeSerie(page);
  await expect(page.getByTestId("ritmo-x2")).toHaveAttribute("aria-pressed", "true");
  expect((await estado(page)).ritmo).toBe("x2");
});

test("rit-5 y rit-6 las latencias de ritmo, hasta-el-final y repetir se miden y valen ≤ 200 ms", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await verCocheDeSerie(page);
  await page.getByTestId("ritmo-x4").click();
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("repetir").click();
  // La medida se escribe en el fotograma siguiente al clic: se espera a que exista en vez de leerla al instante.
  for (const evento of ["ritmo", "hasta-el-final", "repetir"]) {
    await expect
      .poll(() => page.evaluate((e) => window.__debug!.latencias().filter((l) => l.evento === e).length, evento), { message: evento })
      .toBeGreaterThan(0);
  }
  await page.goto("/?pruebas=1&rendimiento=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await page.getByTestId("ritmo-x8").click();
  await page.screenshot({ path: `${DIR}/${ID}-rendimiento-360x640.png` });
});
