import { test, expect, type Page } from "@playwright/test";
import type { Genome } from "../../src/sim/genome";

/** Transform del lienzo del Taller (lo publica la escena con ?pruebas=1): el coche se encuadra a su caja, no a una escala fija. */
async function encuadre(page: Page) {
  return page.evaluate(() => (window.__debug!.estado() as unknown as { tallerEncuadre: { escalaPxM: number; origenPx: { x: number; y: number } } }).tallerEncuadre);
}

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "taller-fuerzas-11";
const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];
test.setTimeout(150_000);

type Estado = {
  genomaEnTaller: Genome | null;
  inclinaciones: number[];
  fuerzasTaller: { visible: boolean; centroMasas: { x: number; y: number }; pares: number[] } | null;
};
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);
const latencia = (page: Page, evento: string) =>
  page.evaluate((e) => window.__debug!.latencias().filter((l) => l.evento === e).map((l) => l.ms), evento);

async function abrirTaller(page: Page) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
  await expect.poll(async () => (await estado(page)).genomaEnTaller !== null).toBe(true);
}

/** Espera a que el lienzo deje de cambiar de tamaño (el panel aparece y la escena se recoloca). */
async function lienzoQuieto(page: Page) {
  let previa = "";
  await expect
    .poll(async () => {
      const b = await page.locator("canvas").boundingBox();
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      const actual = JSON.stringify(b);
      const quieto = actual === previa;
      previa = actual;
      return quieto;
    })
    .toBe(true);
}

/** Píxeles de la página de un punto del coche (metros, y hacia arriba, desde el centro del lienzo). */
async function pantalla(page: Page, xm: number, ym: number) {
  const caja = (await page.locator("canvas").boundingBox())!;
  const enc = (await encuadre(page))!;
  const s = enc.escalaPxM;
  return { x: caja.x + enc.origenPx.x + xm * s, y: caja.y + enc.origenPx.y - ym * s, s };
}

async function centroRueda(page: Page, slot: number) {
  const g = (await estado(page)).genomaEnTaller!;
  const v = g.body[g.wheels[slot].vertex];
  return pantalla(page, Math.cos(v.angle) * v.length, Math.sin(v.angle) * v.length);
}

for (const t of TAMANOS) {
  test(`fu-1 la guía con muelle gira con el deslizador y con el tirador @tamanos ${t.w}x${t.h}`, async ({ page }) => {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrirTaller(page);
    await page.getByTestId("rueda-0").click();
    await lienzoQuieto(page);
    await expect(page.getByTestId("lectura-suspension")).toContainText("vertical");
    expect((await estado(page)).inclinaciones[0]).toBeCloseTo(0, 5);
    await page.screenshot({ path: `${DIR}/${ID}-guia-vertical-${t.w}x${t.h}.png` });

    const antes = (await estado(page)).genomaEnTaller!;
    await page.getByTestId("deslizador-suspension").fill("30");
    await expect(page.getByTestId("lectura-suspension")).toContainText("inclinada 30° hacia delante");
    const tras = await estado(page);
    expect(tras.inclinaciones[0]).toBeCloseTo(30, 3);
    expect(tras.genomaEnTaller!.wheels[0].axisAngle).toBeCloseTo(antes.wheels[0].axisAngle - Math.PI / 6, 5);
    await lienzoQuieto(page);
    await page.screenshot({ path: `${DIR}/${ID}-guia-inclinada-30-${t.w}x${t.h}.png` });

    // Tirador: se arrastra hasta 20° hacia atrás y luego hasta dejar la guía horizontal.
    await page.getByTestId("deslizador-suspension").fill("0");
    const c = await centroRueda(page, 0);
    const punta = { x: c.x, y: c.y - 0.6 * c.s };
    await page.mouse.move(punta.x, punta.y);
    await page.mouse.down();
    const rad = (110 * Math.PI) / 180; // 20° hacia atrás: el extremo de arriba apunta a la izquierda de la vertical
    await page.mouse.move(c.x + Math.cos(rad) * 120, c.y - Math.sin(rad) * 120, { steps: 5 });
    await expect.poll(async () => (await estado(page)).inclinaciones[0]).toBeCloseTo(-20, 0);
    await expect(page.getByTestId("lectura-suspension")).toContainText("inclinada 20° hacia atrás");
    // La lectura en palabras se ve a la vez que la guía que gira, aunque el panel esté desplazado.
    await expect(page.getByTestId("lectura-suspension")).toBeInViewport({ ratio: 1 });
    await page.mouse.move(c.x + 120, c.y, { steps: 5 });
    // ±90° son la misma guía tumbada; según de qué lado quede el dedo por un píxel, sale una u otra.
    await expect.poll(async () => Math.abs((await estado(page)).inclinaciones[0])).toBeCloseTo(90, 0);
    await page.screenshot({ path: `${DIR}/${ID}-tirador-horizontal-${t.w}x${t.h}.png` });
    await page.mouse.up();
    await expect(page.getByTestId("lectura-suspension")).toContainText("tumbada");
    expect((await estado(page)).genomaEnTaller!.wheels[0].axisAngle).toBeGreaterThanOrEqual(0);

    await expect.poll(async () => (await latencia(page, "inclinar-suspension")).length).toBeGreaterThan(0);
    expect(Math.max(...(await latencia(page, "inclinar-suspension")))).toBeLessThanOrEqual(200);
  });

  test(`fu-3 «Ver fuerzas» enseña centro de masas, peso y par, y se apaga @tamanos ${t.w}x${t.h}`, async ({ page }) => {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrirTaller(page);
    await lienzoQuieto(page);
    expect((await estado(page)).fuerzasTaller!.visible).toBe(false);
    await expect(page.getByTestId("ver-fuerzas")).toHaveAttribute("aria-pressed", "false");
    await page.screenshot({ path: `${DIR}/${ID}-fuerzas-apagado-${t.w}x${t.h}.png` });

    await page.getByTestId("ver-fuerzas").click();
    await expect(page.getByTestId("ver-fuerzas")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("leyenda-fuerzas")).toBeVisible();
    // El chip y la leyenda van en su franja, bajo el lienzo: no tapan ni la ayuda ni el coche.
    await lienzoQuieto(page);
    const lienzoCaja = (await page.getByTestId("lienzo").boundingBox())!;
    for (const id of ["ver-fuerzas", "leyenda-fuerzas"]) {
      const c = (await page.getByTestId(id).boundingBox())!;
      expect(c.y, id).toBeGreaterThanOrEqual(lienzoCaja.y + lienzoCaja.height - 0.5);
      expect(c.y + c.height, id).toBeLessThanOrEqual(t.h);
      expect(c.x + c.width, id).toBeLessThanOrEqual(t.w);
    }
    const a = (await estado(page)).fuerzasTaller!;
    expect(a.visible).toBe(true);
    expect(a.pares).toHaveLength(2);
    await lienzoQuieto(page);
    await page.screenshot({ path: `${DIR}/${ID}-fuerzas-encendido-${t.w}x${t.h}.png` });

    // Arrastrar el punto 1 hacia fuera mueve el centro de masas.
    const g = a && (await estado(page)).genomaEnTaller!;
    const v = g.body[1];
    const p = await pantalla(page, Math.cos(v.angle) * v.length, Math.sin(v.angle) * v.length);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + Math.cos(v.angle) * 50, p.y - Math.sin(v.angle) * 50, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const b = (await estado(page)).fuerzasTaller!.centroMasas;
        return Math.hypot(b.x - a.centroMasas.x, b.y - a.centroMasas.y);
      })
      .toBeGreaterThan(0.005);

    const antes = (await estado(page)).fuerzasTaller!.pares;
    await page.getByTestId("tamano-mas").click();
    await expect.poll(async () => (await estado(page)).fuerzasTaller!.pares[0]).toBeGreaterThan(antes[0]);
    expect((await estado(page)).fuerzasTaller!.pares[1]).toBeGreaterThan(antes[1]);
    await lienzoQuieto(page);
    await page.screenshot({ path: `${DIR}/${ID}-fuerzas-tras-tamano-${t.w}x${t.h}.png` });

    await page.getByTestId("ver-fuerzas").click();
    expect((await estado(page)).fuerzasTaller!.visible).toBe(false);
    await expect(page.getByTestId("leyenda-fuerzas")).toBeHidden();
    await expect.poll(async () => (await latencia(page, "ver-fuerzas")).length).toBeGreaterThan(0);
    expect(Math.max(...(await latencia(page, "ver-fuerzas")))).toBeLessThanOrEqual(200);
  });
}

test("fu-3 sin ruedas «Ver fuerzas» enseña centro de masas y peso, sin arcos de par, y sigue el aviso", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrirTaller(page);
  for (const slot of [0, 1]) {
    await page.getByTestId("rueda-" + slot).click();
    await page.getByTestId("quitar-rueda").click();
  }
  await page.getByTestId("ver-fuerzas").click();
  await expect(page.getByTestId("aviso-sin-ruedas")).toBeVisible();
  const f = (await estado(page)).fuerzasTaller!;
  expect(f.visible).toBe(true);
  expect(f.pares).toEqual([]);
  await lienzoQuieto(page);
  await page.screenshot({ path: `${DIR}/${ID}-fuerzas-sin-ruedas-360x640.png` });
});

test("fu-5 el «?» del Taller explica guía de suspensión, centro de masas, peso y par", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrirTaller(page);
  // La ayuda de la primera vez y el chip «Ver fuerzas» no se montan uno sobre otro.
  const ayuda = (await page.getByTestId("ayuda-taller").boundingBox())!;
  const chip = (await page.getByTestId("ver-fuerzas").boundingBox())!;
  expect(ayuda.y + ayuda.height).toBeLessThanOrEqual(chip.y + 0.5);
  await page.getByTestId("ayuda-boton").click();
  const texto = await page.getByTestId("ayuda-cuerpo").innerText();
  for (const entrada of ["Guía de suspensión", "Centro de masas", "Peso", "Par"]) expect(texto).toContain(entrada);
  expect(texto).toContain("cuanto más larga");
  await page.screenshot({ path: `${DIR}/${ID}-ayuda-taller-360x640.png` });
});
