import { test, expect, type Page } from "@playwright/test";
import { getTrack } from "../../src/sim/tracks";

// Capturas para el juicio visual: CAPTURAS_DIR, o test-results/capturas (el CI las sube como artefacto).
const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "andamiaje-terreno-2";

async function estado(page: Page) {
  return page.evaluate(() => window.__debug!.estado());
}

async function abrir(page: Page, extra = "") {
  await page.goto(`/?pruebas=1${extra}`);
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

async function arrastrar(page: Page, veces: number) {
  const caja = (await page.getByTestId("lienzo").boundingBox())!;
  const y = caja.y + caja.height * 0.5;
  for (let i = 0; i < veces; i++) {
    await page.mouse.move(caja.x + caja.width - 20, y);
    await page.mouse.down();
    await page.mouse.move(caja.x + caja.width / 2, y, { steps: 6 });
    await page.mouse.move(caja.x + 20, y, { steps: 6 });
    await page.mouse.up();
  }
}

// Filas inferiores del lienzo: ninguna columna puede tener color de cielo.
async function filasInferioresSinCielo(page: Page, filas: number): Promise<boolean> {
  return page.evaluate((n) => {
    const c = document.querySelector("canvas") as HTMLCanvasElement;
    const copia = document.createElement("canvas");
    copia.width = c.width;
    copia.height = n;
    const ctx = copia.getContext("2d")!;
    ctx.drawImage(c, 0, c.height - n, c.width, n, 0, 0, c.width, n);
    const d = ctx.getImageData(0, 0, c.width, n).data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const b = d[i + 2];
      // Cielo de Cordillera: azul claro (b muy por encima de r). El texto blanco de la regla
      // tiene b ≈ r y la tierra tiene b bajo, así que ninguno cuenta como cielo.
      if (b > 140 && b - r >= 20) return false;
    }
    return true;
  }, filas);
}

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

test("at-9 portada: sin scroll horizontal, botones ≥44 px, siete pistas con estado", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page);
    await expect(page.getByRole("heading", { name: "Darwin Drive" })).toBeVisible();
    for (const nombre of ["La Cordillera", "La Rampa", "Las Dunas", "El Pedregal", "El Glaciar", "Los Trampolines", "La Escalera", "El Mosaico"]) {
      await expect(page.getByTestId("portada").getByText(nombre, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("sin marcas todavía")).toHaveCount(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const lados = await page.$$eval("button", (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }));
    for (const [w, h] of lados) {
      expect(w).toBeGreaterThanOrEqual(44);
      expect(h).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByTestId("paisaje")).toBeVisible();
    await page.screenshot({ path: `${DIR}/${ID}-portada-${t.w}x${t.h}.png` });
  }
});

test("at-3 explorar: arrastrar recorre la pista con tramos nuevos y sin huecos de cielo", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await page.getByTestId("acceso-explorar").click();
  await expect(page.getByTestId("nombre-pista")).toHaveText("La Cordillera");
  await page.waitForFunction(() => window.__debug!.estado().tramosGenerados > 0);
  const antes = await estado(page);
  expect(antes.pistaSeleccionada).toBe("cordillera");
  expect(antes.pantalla).toBe("pista");
  expect(await filasInferioresSinCielo(page, 40)).toBe(true);
  await expect(page.getByTestId("regla-metros")).toContainText("0,0 m");
  await page.screenshot({ path: `${DIR}/${ID}-explorar-antes-360x640.png` });

  // Hacia la derecha en la salida no baja de x = 0.
  const caja = (await page.getByTestId("lienzo").boundingBox())!;
  await page.mouse.move(caja.x + 40, caja.y + 300);
  await page.mouse.down();
  await page.mouse.move(caja.x + 300, caja.y + 300, { steps: 5 });
  await page.mouse.up();
  expect((await estado(page)).camaraX).toBe(0);

  await arrastrar(page, 6);
  await page.waitForFunction(() => window.__debug!.estado().camaraX >= 60);
  const despues = await estado(page);
  expect(despues.camaraX).toBeGreaterThanOrEqual(60);
  expect(despues.tramosGenerados).toBeGreaterThanOrEqual(4);
  expect(await filasInferioresSinCielo(page, 40)).toBe(true);
  const regla = (await page.getByTestId("regla-metros").textContent())!;
  expect(Number(regla.replace(" m", "").replace(",", "."))).toBeGreaterThanOrEqual(60);
  await expect(page.getByTestId("nombre-pista")).toHaveText("La Cordillera");
  await page.screenshot({ path: `${DIR}/${ID}-explorar-despues-360x640.png` });

  const lat = await page.evaluate(() => window.__debug!.latencias());
  expect(lat.some((m) => m.evento === "abrir-pista")).toBe(true);
  expect(lat.some((m) => m.evento === "arrastrar-pista")).toBe(true);
});

test("at-3 explorar en tableta: tamaños 820x1180 y 1180x820", async ({ page }) => {
  // El WebGL por software pinta cada fotograma en ~0,3 s en tableta: cada arrastre es lento sin que haya fallo.
  test.setTimeout(120_000);
  for (const t of TAMANOS.slice(1)) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page);
    await page.getByTestId("acceso-explorar").click();
    await page.waitForFunction(() => window.__debug!.estado().tramosGenerados > 0);
    await arrastrar(page, 3);
    await page.waitForFunction(() => window.__debug!.estado().camaraX > 5);
    expect(await filasInferioresSinCielo(page, 40)).toBe(true);
    await page.screenshot({ path: `${DIR}/${ID}-explorar-${t.w}x${t.h}.png` });
  }
});

test("at-10 selector: siete tarjetas, elegir La Rampa cambia la pista y se recuerda", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await page.getByTestId("acceso-explorar").click();
  await page.getByTestId("selector-pista").click();
  const hoja = page.getByTestId("hoja-pistas");
  await expect(hoja.locator("button.tarjeta-pista")).toHaveCount(8);
  await expect(hoja.getByText("sin marcas todavía")).toHaveCount(8);
  await expect(hoja.getByText("Una recta que se empina sin parar.")).toBeVisible();
  await page.screenshot({ path: `${DIR}/${ID}-selector-hoja-360x640.png` });

  await page.getByTestId("pista-rampa").click();
  await expect(hoja).toHaveCount(0);
  await expect(page.getByTestId("selector-pista")).toHaveText("Pista: La Rampa ▾");
  await expect(page.getByTestId("nombre-pista")).toHaveText("La Rampa");
  expect((await estado(page)).pistaSeleccionada).toBe("rampa");
  await page.waitForFunction(() => window.__debug!.estado().tramosGenerados > 0);
  await page.screenshot({ path: `${DIR}/${ID}-rampa-360x640.png` });

  await arrastrar(page, 6);
  await page.waitForFunction(() => window.__debug!.estado().camaraX >= 60);
  const { camaraX } = await estado(page);
  const rampa = getTrack("rampa")!;
  expect(rampa.heightAt(camaraX)).toBeGreaterThan(rampa.heightAt(0) + 5);
  expect(await filasInferioresSinCielo(page, 40)).toBe(true);
  await page.screenshot({ path: `${DIR}/${ID}-rampa-lejos-360x640.png` });

  const lat = await page.evaluate(() => window.__debug!.latencias());
  const elegir = lat.filter((m) => m.evento === "elegir-pista");
  expect(elegir.length).toBeGreaterThan(0);
  expect(elegir[elegir.length - 1].ms).toBeLessThanOrEqual(200);

  await page.reload();
  await page.waitForFunction(() => window.__debug && window.__debug.estado().pistaSeleccionada === "rampa");
  await expect(page.getByTestId("tarjeta-rampa")).toBeVisible();
});

test("at-6 ninguna petición sale del propio origen en una sesión", async ({ page, baseURL }) => {
  const ajenas: string[] = [];
  const origen = new URL(baseURL!).origin;
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol === "data:" || u.protocol === "blob:") return;
    if (u.origin !== origen) ajenas.push(r.url());
  });
  await abrir(page);
  await page.getByTestId("acceso-explorar").click();
  await page.waitForFunction(() => window.__debug!.estado().tramosGenerados > 0);
  await page.getByTestId("selector-pista").click();
  await page.getByTestId("pista-dunas").click();
  await arrastrar(page, 2);
  expect(ajenas).toEqual([]);
});

test("at-7 sin WebGL ni Canvas la página lo explica, sin errores sin capturar", async ({ page }) => {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, tipo: string, ...resto: unknown[]) {
      if (tipo === "2d" || tipo.startsWith("webgl") || tipo === "experimental-webgl") return null;
      return (original as (...a: unknown[]) => unknown).call(this, tipo, ...resto);
    } as typeof original;
  });
  await abrir(page);
  await page.getByTestId("acceso-explorar").click();
  await expect(page.getByTestId("sin-lienzo")).toContainText("Tu navegador no puede dibujar el juego");
  expect(errores).toEqual([]);
});
