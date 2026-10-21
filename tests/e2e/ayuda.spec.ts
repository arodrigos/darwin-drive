import { test, expect, type Page } from "@playwright/test";
import { simulateCar } from "../../src/sim/race";
import { STOCK_CAR } from "../../src/sim/genome";
import { AYUDA, PANTALLAS_AYUDA, type PantallaAyuda } from "../../src/app/ayuda/textos";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "guia-ayuda-1";
const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Estado = {
  pantalla: string;
  tiempoSim: number | null;
  pausada: boolean;
  ritmo: string | null;
  ayudaAbierta: string | null;
  guia: { abierta: boolean; seccion: string | null; origen: string | null };
  ultimoResultado: { distance: number } | null;
};
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

async function abrir(page: Page, escenario: Record<string, unknown> = { vacio: true }) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

// Cómo se llega a cada pantalla desde la portada.
async function ir(page: Page, p: PantallaAyuda) {
  const click = (id: string) => page.getByTestId(id).click();
  switch (p) {
    case "portada":
      return;
    case "explorar":
      return click("acceso-explorar");
    case "pista":
      await click("acceso-serie");
      return expect.poll(async () => (await estado(page)).tiempoSim ?? 0).toBeGreaterThan(0.2);
    case "taller":
      return click("acceso-taller");
    case "garaje":
      return click("acceso-garaje");
    case "rankings":
      return click("tarjeta-cordillera");
    case "evolucion-inicio":
      return click("acceso-evolucion");
    case "evolucion":
      await click("acceso-taller");
      await click("evolucionar");
      return expect(page.getByTestId("evolucion")).toBeVisible();
    case "linaje":
      return click("acceso-linaje");
    case "especies":
      return click("acceso-especies");
  }
}

// La pausa viaja por mensaje al worker: se espera a que el tiempo simulado deje de cambiar antes de medir.
async function tiempoQuieto(page: Page): Promise<number | null> {
  let anterior: number | null = -1;
  await expect
    .poll(async () => {
      const t = (await estado(page)).tiempoSim;
      const quieto = t === anterior;
      anterior = t;
      return quieto;
    }, { intervals: [150] })
    .toBe(true);
  return anterior;
}

type Caja = { x: number; y: number; width: number; height: number };
const caja = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox()) as Caja;

test("gui-1 y gui-3: cada pantalla tiene su «?» con título y una línea por opción, y cabe", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 360, height: 640 });
  for (const p of PANTALLAS_AYUDA) {
    await abrir(page);
    await ir(page, p);
    const boton = await caja(page, "ayuda-boton");
    expect(boton.width, p).toBeGreaterThanOrEqual(44);
    expect(boton.height, p).toBeGreaterThanOrEqual(44);
    expect(boton.x + boton.width, p).toBeLessThanOrEqual(360);
    // El «?» no se cruza con «← Volver» (la portada no lo tiene).
    if (p !== "portada") {
      const volver = await page.getByTestId("volver").first().boundingBox();
      if (volver) expect(volver.x + volver.width, p).toBeLessThanOrEqual(boton.x);
    }
    await page.getByTestId("ayuda-boton").click();
    const panel = page.getByTestId("ayuda-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("role", "dialog");
    await expect(page.getByTestId("ayuda-titulo")).toHaveText(AYUDA[p].titulo);
    const texto = await page.getByTestId("ayuda-cuerpo").innerText();
    for (const c of AYUDA[p].controles) expect(texto, `${p}: ${c.nombre}`).toContain(c.nombre);
    expect((await estado(page)).ayudaAbierta).toBe(p);
    const cp = await caja(page, "ayuda-panel");
    expect(cp.y).toBeGreaterThanOrEqual(0);
    expect(cp.y + cp.height).toBeLessThanOrEqual(640);
    const px = await page.getByTestId("ayuda-cuerpo").evaluate((el) => parseFloat(getComputedStyle(el.querySelector("li")!).fontSize));
    expect(px).toBeGreaterThanOrEqual(16);
    const cerrar = await caja(page, "ayuda-cerrar");
    expect(cerrar.y + cerrar.height).toBeLessThanOrEqual(640);
    await page.screenshot({ path: `${DIR}/${ID}-panel-${p}-360x640.png` });
    await page.getByTestId("ayuda-cerrar").click();
    await expect(panel).toBeHidden();
    await expect(page.getByTestId("ayuda-boton")).toBeFocused();
  }
});

test("gui-3: el panel de Pista y de Taller en tableta, vertical y horizontal", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    for (const p of ["pista", "taller"] as const) {
      await abrir(page);
      await ir(page, p);
      await page.getByTestId("ayuda-boton").click();
      const cp = await caja(page, "ayuda-panel");
      expect(cp.y + cp.height).toBeLessThanOrEqual(t.h);
      expect(cp.x + cp.width).toBeLessThanOrEqual(t.w);
      expect(cp.x).toBeGreaterThanOrEqual(0);
      await page.screenshot({ path: `${DIR}/${ID}-panel-${p}-${t.w}x${t.h}.png` });
    }
  }
});

test("gui-1-b: el panel más largo se desplaza por dentro con ✕ y enlace a la vista", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true, evolucion: "demo-gen-8" });
  await page.getByTestId("acceso-continuar").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await page.getByTestId("ayuda-boton").click();
  const cuerpo = page.getByTestId("ayuda-cuerpo");
  await expect(cuerpo).toBeVisible();
  await cuerpo.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  for (const id of ["ayuda-cerrar", "ayuda-guia"]) {
    const c = await caja(page, id);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.y + c.height).toBeLessThanOrEqual(640);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: `${DIR}/${ID}-evolucion-desplazado-360x640.png` });
});

test("gui-4: se cierra con ✕, Esc, tocando fuera y con «atrás»; lo de debajo no recibe el toque", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await ir(page, "taller");
  const panel = page.getByTestId("ayuda-panel");
  const abrirPanel = async () => {
    await page.getByTestId("ayuda-boton").click();
    await expect(panel).toBeVisible();
  };

  await abrirPanel();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  await abrirPanel();
  // El toque cae sobre donde está «← Volver» por debajo: no puede llegarle.
  await page.mouse.click(30, 30);
  await expect(panel).toBeHidden();
  expect((await estado(page)).pantalla).toBe("taller");

  await abrirPanel();
  await page.goBack();
  await expect(panel).toBeHidden();
  expect((await estado(page)).pantalla).toBe("taller");

  await abrirPanel();
  await expect(panel).toHaveAttribute("aria-labelledby", "ayuda-titulo");
  await page.getByTestId("ayuda-cerrar").click();
  await expect(panel).toBeHidden();
  await expect(page.getByTestId("taller")).toBeVisible();
});

test("gui-5: abrir el «?» en Pista a ×8 pausa la carrera y cerrarlo la reanuda con la misma marca final", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await ir(page, "pista");
  await page.getByTestId("ritmo-x8").click();
  await expect.poll(async () => (await estado(page)).tiempoSim ?? 0).toBeGreaterThan(1);
  await page.getByTestId("ayuda-boton").click();
  await expect(page.getByTestId("ayuda-panel")).toBeVisible();
  await expect.poll(async () => (await estado(page)).pausada).toBe(true);
  const t0 = await tiempoQuieto(page);
  await page.waitForTimeout(1000);
  const e1 = await estado(page);
  expect(e1.tiempoSim).toBe(t0);
  expect(e1.ritmo).toBe("x8");
  await page.screenshot({ path: `${DIR}/${ID}-pausa-360x640.png` });
  await page.getByTestId("ayuda-cerrar").click();
  await expect.poll(async () => (await estado(page)).tiempoSim ?? 0).toBeGreaterThan(t0 ?? 0);
  expect((await estado(page)).pausada).toBe(false);
  await page.evaluate(() => window.__debug!.adelantarSimulacion(900));
  await expect.poll(async () => (await estado(page)).ultimoResultado?.distance ?? null).not.toBeNull();
  const final = (await estado(page)).ultimoResultado!.distance;
  expect(final).toBe(simulateCar(STOCK_CAR, "cordillera").distance);
});

test("gui-7: sin dependencias nuevas ni peticiones a otros orígenes al abrir ayuda y guía", async ({ page }) => {
  const externas: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith("http") && u.origin !== new URL(page.url() || "http://127.0.0.1:3000").origin && u.hostname !== "127.0.0.1") externas.push(r.url());
  });
  await abrir(page);
  await page.getByTestId("ayuda-boton").click();
  await page.getByTestId("ayuda-guia").click();
  await expect(page.getByTestId("guia")).toBeVisible();
  expect(externas).toEqual([]);
});
