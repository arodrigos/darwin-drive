import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "fuerzas-en-vivo";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Estado = {
  ritmoReal: number | null;
  fuerzasEnVivo: { activa: boolean; muestras: number; flechasPx: number[] };
};
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

async function probar(page: Page, pista: "pedregal" | "recta") {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((id) => window.__debug!.cargarEscenario({ vacio: true, pista: id }), pista);
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("probar").click();
  await expect(page.getByTestId("pista")).toBeVisible();
}

/** Contraste WCAG entre el texto y el fondo propios del botón, encendido o apagado (el fondo es casi opaco). */
async function contrasteBoton(page: Page, testid: string): Promise<number> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`)!;
    const cs = getComputedStyle(el);
    const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [a, b] = [lum(rgb(cs.color)), lum(rgb(cs.backgroundColor))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  }, testid);
}

const mayor = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);

test("fv-1 «Fuerzas» pinta una flecha por rueda que cambia con el terreno y al apagarlo desaparece", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await probar(page, "pedregal");
    const boton = page.getByTestId("ritmo-fuerzas");
    await expect(boton).toHaveAttribute("aria-pressed", "false");
    expect((await estado(page)).fuerzasEnVivo.muestras).toBe(0);
    const caja = (await boton.boundingBox())!;
    expect(caja.height).toBeGreaterThanOrEqual(44);
    expect(caja.x + caja.width).toBeLessThanOrEqual(t.w);

    await boton.click();
    await expect(boton).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ritmo-leyenda-fuerzas")).toBeVisible();
    expect(await contrasteBoton(page, "ritmo-fuerzas"), "interruptor encendido").toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `${DIR}/${ID}-interruptor-encendido-${t.w}x${t.h}.png` });
    await expect.poll(async () => (await estado(page)).fuerzasEnVivo.muestras).toBeGreaterThan(0);
    await expect.poll(async () => mayor((await estado(page)).fuerzasEnVivo.flechasPx)).toBeGreaterThan(3);

    // Varios momentos del recorrido: el terreno cambia la fuerza, así que el largo de la flecha no es siempre el mismo.
    const largos: number[] = [];
    // El coche de serie se atasca hacia los 25 s simulados: 5 trozos de 4 s se quedan dentro de la carrera.
    for (let k = 0; k < 5; k++) {
      await page.evaluate(() => window.__debug!.adelantarSimulacion(4));
      await page.waitForTimeout(700);
      largos.push(mayor((await estado(page)).fuerzasEnVivo.flechasPx));
      if (k === 0) await page.screenshot({ path: `${DIR}/${ID}-llano-${t.w}x${t.h}.png` });
      if (k === 3) await page.screenshot({ path: `${DIR}/${ID}-piedra-${t.w}x${t.h}.png` });
    }
    expect(Math.max(...largos) - Math.min(...largos), `largos ${largos.join(", ")}`).toBeGreaterThan(5);

    // La medida cierra tras el primer fotograma pintado; con el WebGL por software de Actions ese primer fotograma
    // puede pasarse unos ms. Si la primera muestra rebasa, se enciende y apaga otra vez y se queda la mejor:
    // una regresión real sube todas, un tirón puntual no.
    const leerLat = () => page.evaluate(() => window.__debug!.latencias().filter((l) => l.evento === "fuerzas-carrera").map((l) => l.ms));
    let lat = await leerLat();
    expect(lat.length).toBeGreaterThan(0);
    for (let r = 0; r < 2 && Math.min(...lat) > 200; r++) {
      const antes = lat.length;
      await boton.click();
      await boton.click();
      await expect.poll(async () => (await leerLat()).length).toBeGreaterThan(antes);
      lat = await leerLat();
    }
    expect(Math.min(...lat)).toBeLessThanOrEqual(200);
    await expect(boton).toHaveAttribute("aria-pressed", "true");

    await boton.click();
    await expect(boton).toHaveAttribute("aria-pressed", "false");
    expect(await contrasteBoton(page, "ritmo-fuerzas"), "interruptor apagado").toBeGreaterThanOrEqual(4.5);
    await expect.poll(async () => (await estado(page)).fuerzasEnVivo.flechasPx.length).toBe(0);
    const tras = (await estado(page)).fuerzasEnVivo.muestras;
    await page.waitForTimeout(600);
    expect((await estado(page)).fuerzasEnVivo.muestras).toBe(tras);
    await page.screenshot({ path: `${DIR}/${ID}-apagado-${t.w}x${t.h}.png` });
  }
});

test("fv-2 la capa a ×8 no baja ritmoReal más de un 10 % y apagada no llega ninguna muestra", async ({ page }) => {
  // La recta dura 360 s simulados: a ×8, 20 s de medida caben de sobra.
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await probar(page, "recta");
  await page.getByTestId("ritmo-x8").click();
  const medir = async () => {
    const xs: number[] = [];
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      const r = (await estado(page)).ritmoReal;
      if (r !== null) xs.push(r);
    }
    return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  };
  const apagada = await medir();
  expect((await estado(page)).fuerzasEnVivo.muestras).toBe(0);
  await page.getByTestId("ritmo-fuerzas").click();
  const encendida = await medir();
  expect((await estado(page)).fuerzasEnVivo.muestras).toBeGreaterThan(0);
  expect(encendida, `apagada ${apagada}, encendida ${encendida}`).toBeGreaterThanOrEqual(apagada * 0.9);
});
