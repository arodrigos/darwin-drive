import { test, expect, type Page } from "@playwright/test";
import type { EstadoBatalla } from "../../src/batalla/estado";
import type { Genome } from "../../src/sim/genome";
import { tamanoBase } from "./tamano";

/** Transform del lienzo del Taller (lo publica la escena con ?pruebas=1): el coche se encuadra a su caja, no a una escala fija. */
async function encuadre(page: Page) {
  return page.evaluate(() => (window.__debug!.estado() as unknown as { tallerEncuadre: { escalaPxM: number; origenPx: { x: number; y: number } } }).tallerEncuadre);
}

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "batalla-turnos-14";
test.setTimeout(180_000);

type Estado = { batalla: EstadoBatalla | null; genomaEnTaller: Genome | null };
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

async function abrir(page: Page) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

/** Espera a que el lienzo deje de cambiar de tamaño antes de calcular coordenadas sobre él. */
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

async function puntoVertice(page: Page, i: number) {
  await lienzoQuieto(page);
  const caja = (await page.locator("canvas").boundingBox())!;
  const v = (await estado(page)).genomaEnTaller!.body[i];
  const enc = (await encuadre(page))!;
  const s = enc.escalaPxM;
  return { x: caja.x + enc.origenPx.x + Math.cos(v.angle) * v.length * s, y: caja.y + enc.origenPx.y - Math.sin(v.angle) * v.length * s, v };
}

/** Alarga el punto i con el botón de longitud: el coche de ese jugador deja de ser el de serie. */
async function modificarCoche(page: Page, i: number, veces: number) {
  const antes = JSON.stringify((await estado(page)).genomaEnTaller);
  const p = await puntoVertice(page, i);
  await page.mouse.click(p.x, p.y);
  for (let k = 0; k < veces; k++) await page.getByTestId("longitud-mas").click();
  await expect.poll(async () => JSON.stringify((await estado(page)).genomaEnTaller) !== antes).toBe(true);
}

async function configurar(page: Page, nombres: string[], colores: string[]) {
  await page.getByTestId("acceso-batalla").click();
  await expect(page.getByTestId("batalla-configurar")).toBeVisible();
  await page.getByTestId(`jugadores-${nombres.length}`).click();
  for (let i = 0; i < nombres.length; i++) {
    await page.getByTestId(`jugador-nombre-${i}`).fill(nombres[i]);
    await page.getByTestId(`color-jugador-${i}-${colores[i]}`).click();
  }
}

async function terminar(page: Page) {
  await page.getByTestId("terminar-coche").click();
  await expect(page.getByTestId("confirmar-batalla-texto")).toHaveText("¿Has terminado? Los demás no verán tu coche hasta la carrera.");
  await page.getByTestId("confirmar-batalla-si").click();
}

test("bt-1 bt-4 bt-6 tres jugadores diseñan por turnos sin ver el coche anterior y llegan a «Elegir pista» sin red externa", async ({ page, context, baseURL }) => {
  const origen = new URL(baseURL!).origin;
  const externas: string[] = [];
  context.on("request", (r) => {
    if (/^https?:/i.test(r.url()) && new URL(r.url()).origin !== origen) externas.push(r.url());
  });
  const t = await tamanoBase(page);
  const tam = `${t.width}x${t.height}`;
  await abrir(page);
  await configurar(page, ["Ana", "Bea", "Carlos"], ["naranja", "azul", "verde"]);
  await page.screenshot({ path: `${DIR}/${ID}-configurar-${tam}.png` });
  await page.getByTestId("empezar-batalla").click();

  // Turno de Ana
  await expect(page.getByTestId("relevo-titulo")).toHaveText("Turno de Ana");
  await page.screenshot({ path: `${DIR}/${ID}-relevo-ana-${tam}.png` });
  await page.getByTestId("soy-jugador").click();
  await expect(page.getByTestId("cabecera-batalla")).toHaveText("Batalla · Ana (1 de 3)");
  await modificarCoche(page, 3, 3);
  await page.screenshot({ path: `${DIR}/${ID}-taller-ana-${tam}.png` });
  await terminar(page);

  // Turno de Bea: el relevo no dibuja nada y su Taller parte del coche de serie, no del de Ana.
  await expect(page.getByTestId("relevo-titulo")).toHaveText("Turno de Bea");
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.screenshot({ path: `${DIR}/${ID}-relevo-bea-sin-coche-${tam}.png` });
  const anaGenoma = (await estado(page)).batalla!.jugadores[0].coche!.genome;
  await page.getByTestId("soy-jugador").click();
  await expect(page.getByTestId("cabecera-batalla")).toHaveText("Batalla · Bea (2 de 3)");
  await expect.poll(async () => (await estado(page)).genomaEnTaller !== null).toBe(true);
  expect((await estado(page)).genomaEnTaller).not.toEqual(anaGenoma);
  await lienzoQuieto(page);
  await page.screenshot({ path: `${DIR}/${ID}-taller-bea-inicio-${tam}.png` });
  await modificarCoche(page, 1, 2);
  await terminar(page);

  // Turno de Carlos
  await expect(page.getByTestId("relevo-titulo")).toHaveText("Turno de Carlos");
  await page.getByTestId("soy-jugador").click();
  await modificarCoche(page, 2, 4);
  await terminar(page);

  await expect(page.getByTestId("batalla-elegir-pista")).toBeVisible();
  await page.screenshot({ path: `${DIR}/${ID}-elegir-pista-${tam}.png` });
  const b = (await estado(page)).batalla!;
  expect(b.fase).toBe("elegir-pista");
  expect(b.jugadores.map((j) => j.nombre)).toEqual(["Ana", "Bea", "Carlos"]);
  expect(b.jugadores.every((j) => j.coche !== null)).toBe(true);
  expect(new Set(b.jugadores.map((j) => JSON.stringify(j.coche!.genome))).size).toBe(3);
  expect(b.jugadores.map((j) => j.color)).toEqual(["naranja", "azul", "verde"]);
  await page.getByTestId("batalla-pista-rampa").click();
  await expect(page.getByTestId("batalla-pista-rampa")).toHaveAttribute("aria-pressed", "true");
  expect((await estado(page)).batalla!.pista).toBe("rampa");
  expect(externas).toEqual([]);
});

test("bt-1 un color ya cogido no se puede tocar; con 2 jugadores hay dos relevos", async ({ page }) => {
  await tamanoBase(page);
  await abrir(page);
  await page.getByTestId("acceso-batalla").click();
  const naranjaDe1 = page.getByTestId("color-jugador-1-naranja");
  await expect(naranjaDe1).toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("jugadores-2").click();
  await expect(page.getByTestId("jugador-2")).toHaveCount(0);
  await page.getByTestId("empezar-batalla").click();
  await expect(page.getByTestId("relevo-titulo")).toHaveText("Turno de Jugador 1");
  await page.getByTestId("soy-jugador").click();
  await terminar(page);
  await expect(page.getByTestId("relevo-titulo")).toHaveText("Turno de Jugador 2");
  await page.getByTestId("soy-jugador").click();
  await terminar(page);
  await expect(page.getByTestId("batalla-elegir-pista")).toBeVisible();
});

test("bt-2 una recarga en el turno de Bea ofrece «Continuar batalla (turno de Bea)» y conserva el coche de Ana", async ({ page }) => {
  await tamanoBase(page);
  await abrir(page);
  await configurar(page, ["Ana", "Bea"], ["naranja", "azul"]);
  await page.getByTestId("empezar-batalla").click();
  await page.getByTestId("soy-jugador").click();
  await modificarCoche(page, 3, 2);
  await terminar(page);
  await page.getByTestId("soy-jugador").click();
  await expect(page.getByTestId("cabecera-batalla")).toHaveText("Batalla · Bea (2 de 2)");
  const antes = (await estado(page)).batalla!.jugadores[0].coche;
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await expect(page.getByTestId("acceso-continuar-batalla")).toContainText("Continuar batalla (turno de Bea)");
  await page.screenshot({ path: `${DIR}/${ID}-portada-continuar.png` });
  await page.getByTestId("acceso-continuar-batalla").click();
  await expect(page.getByTestId("relevo-titulo")).toHaveText("Turno de Bea");
  await expect(page.getByTestId("relevo-aviso")).toHaveText("Tu diseño se reinició al recargar", { timeout: 15_000 });
  const b = (await estado(page)).batalla!;
  expect(b.fase).toBe("relevo");
  expect(b.activo).toBe(1);
  expect(b.jugadores[0].coche).toEqual(antes);
});

test("bt-3 «Abandonar batalla» pide confirmación y al aceptar borra la batalla", async ({ page }) => {
  await tamanoBase(page);
  await abrir(page);
  await configurar(page, ["Ana", "Bea"], ["naranja", "azul"]);
  await page.getByTestId("empezar-batalla").click();
  await page.getByTestId("soy-jugador").click();
  await page.getByTestId("abandonar-batalla").click();
  await expect(page.getByTestId("confirmar-batalla")).toBeVisible();
  await page.getByTestId("confirmar-batalla-no").click();
  await expect(page.getByTestId("taller")).toBeVisible();
  expect((await estado(page)).batalla).not.toBeNull();
  await page.getByTestId("abandonar-batalla").click();
  await page.getByTestId("confirmar-batalla-si").click();
  await expect(page.getByTestId("portada")).toBeVisible();
  expect((await estado(page)).batalla).toBeNull();
  await expect(page.getByTestId("acceso-continuar-batalla")).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await expect(page.getByTestId("acceso-continuar-batalla")).toHaveCount(0);
});

test("bt-5 sin ruedas avisa antes de terminar y Configurar no deja empezar con un nombre vacío", async ({ page }) => {
  const t = await tamanoBase(page);
  const tam = `${t.width}x${t.height}`;
  await abrir(page);
  await page.getByTestId("acceso-batalla").click();
  await page.getByTestId("jugador-nombre-1").fill("   ");
  await page.getByTestId("empezar-batalla").click();
  await expect(page.getByTestId("jugador-error-1")).toHaveText("Cada jugador necesita un nombre");
  await expect(page.getByTestId("batalla-configurar")).toBeVisible();
  await page.screenshot({ path: `${DIR}/${ID}-nombre-vacio-${tam}.png` });
  await page.getByTestId("jugador-nombre-1").fill("Bea");
  await page.getByTestId("empezar-batalla").click();
  await page.getByTestId("soy-jugador").click();
  await expect.poll(async () => (await estado(page)).genomaEnTaller !== null).toBe(true);
  // Las ruedas quitadas dejan su hueco con vertex < 0: solo cuentan las puestas.
  const puestas = async () => (await estado(page)).genomaEnTaller!.wheels.filter((w) => w.vertex >= 0);
  for (let n = (await puestas()).length; n > 0; n--) {
    const p = await puntoVertice(page, (await puestas())[0].vertex);
    await page.mouse.click(p.x, p.y);
    await page.getByTestId("quitar-rueda").click();
  }
  await expect(page.getByTestId("contador-ruedas")).toHaveText("Ruedas: 0/4");
  await page.getByTestId("terminar-coche").click();
  await expect(page.getByTestId("confirmar-batalla-texto")).toHaveText("Sin ruedas tu coche no avanzará. ¿Terminar igualmente?");
  await page.screenshot({ path: `${DIR}/${ID}-sin-ruedas-${tam}.png` });
});
