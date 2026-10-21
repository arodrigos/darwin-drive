import { test, expect, type Page } from "@playwright/test";
import demoJson from "../../src/debug/escenarios/linaje-demo-5.json";
import { STOCK_CAR, type Genome } from "../../src/sim/genome";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "linaje-23";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Nodo = { id: string; parents: string[]; op: string; generation: number; distance: number | null; trackId: string | null; genome: Genome };
const demo = demoJson.nodos as unknown as Nodo[];
const porId = new Map(demo.map((n) => [n.id, n]));

type Estado = {
  pantalla: string;
  pistaSeleccionada: string;
  genomaEnTaller: Genome | null;
  genomaEnPista: Genome | null;
  ultimoResultado: { distance: number; trackId: string } | null;
};

const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);
const adelantar = (page: Page, s: number) => page.evaluate((x) => window.__debug!.adelantarSimulacion(x), s);
const coma = (m: number) => `${m.toFixed(1).replace(".", ",")} m`;

async function abrir(page: Page, escenario: Record<string, unknown>) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

async function abrirLinaje(page: Page) {
  await page.getByTestId("acceso-linaje").click();
  await expect(page.getByTestId("linaje")).toBeVisible();
}

/** Un nodo se puede estar pintando fuera del trozo visible: el toque se lanza sobre él igual que lo haría el dedo tras desplazar. */
const tocar = (page: Page, id: string) => page.locator(`[data-testid="nodo-linaje"][data-id="${id}"]`).dispatchEvent("click");

async function capturas(page: Page, nombre: string) {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${DIR}/${ID}-${nombre}-${t.w}x${t.h}.png` });
  }
}

/** El nodo de la generación 3 con dos padres entre los antepasados del campeón demo (el de la prueba del criterio). */
function nodoGen3(): Nodo {
  const dibujados = new Set<string>();
  const pila = [demoJson.campeon];
  while (pila.length > 0) {
    const id = pila.pop()!;
    if (dibujados.has(id)) continue;
    dibujados.add(id);
    pila.push(...porId.get(id)!.parents);
  }
  const n = demo.find((x) => dibujados.has(x.id) && x.generation === 3 && x.parents.length === 2 && x.distance !== null);
  if (!n) throw new Error("el linaje demo no tiene un cruce en la generación 3");
  return n;
}

test("ln-1 el árbol se lee por capas y «Abrir en el taller» carga ese coche exacto", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { linaje: "demo-5-generaciones" });
  await abrirLinaje(page);
  expect((await estado(page)).pantalla).toBe("linaje");
  await expect(page.getByTestId("linaje-selector").locator("option:checked")).toHaveText("n.º 1 de La Cordillera");
  const capas = Number(await page.getByTestId("linaje-lienzo").getAttribute("data-capas"));
  expect(capas).toBeGreaterThanOrEqual(5);
  // Las filas visibles: los nodos de las cinco primeras capas caben en el móvil.
  const visibles = await page.getByTestId("nodo-linaje").evaluateAll((els) => {
    const caja = document.querySelector('[data-testid="linaje-lienzo"]')!.getBoundingClientRect();
    return [...new Set(els.filter((e) => e.getBoundingClientRect().top + 54 <= caja.bottom && e.getBoundingClientRect().top >= caja.top).map((e) => e.getAttribute("data-capa")))].length;
  });
  expect(visibles).toBeGreaterThanOrEqual(5);
  const raiz = page.locator('[data-testid="nodo-linaje"][data-op="design"]');
  await expect(raiz).toHaveCount(1);
  await expect(raiz.getByTestId("nodo-mano")).toHaveText("✋ diseño");
  const distancias = await page.getByTestId("nodo-distancia").allTextContents();
  expect(distancias.every((d) => /^\d+,\d m$/.test(d) || d === "—")).toBe(true);
  await page.screenshot({ path: `${DIR}/${ID}-arbol-360x640.png` });

  const n3 = nodoGen3();
  // Dos flechas de entrada en el cruce.
  await expect(page.locator(`[data-testid="arista"][data-hasta="${n3.id}"]`)).toHaveCount(2);
  await tocar(page, n3.id);
  await expect(page.getByTestId("hoja-nodo")).toBeVisible();
  await expect(page.getByTestId("hoja-titulo")).toHaveText("Generación 3");
  await expect(page.getByTestId("hoja-pista")).toHaveText("La Cordillera");
  await expect(page.getByTestId("hoja-distancia")).toHaveText(coma(n3.distance!));
  await expect(page.getByTestId("hoja-padre")).toHaveCount(2);
  await page.screenshot({ path: `${DIR}/${ID}-hoja-360x640.png` });
  const lat = await page.evaluate(() => window.__debug!.latencias().filter((l) => l.evento === "abrir-nodo"));
  expect(lat.length).toBeGreaterThan(0);

  await page.getByTestId("abrir-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
  await expect.poll(async () => (await estado(page)).genomaEnTaller !== null).toBe(true);
  expect((await estado(page)).genomaEnTaller).toEqual(n3.genome);
});

test("ln-1 capturas del árbol y de la hoja en los tres tamaños", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { linaje: "demo-5-generaciones" });
  await abrirLinaje(page);
  await capturas(page, "arbol");
  await tocar(page, nodoGen3().id);
  await expect(page.getByTestId("hoja-nodo")).toBeVisible();
  await capturas(page, "hoja");
});

test("ln-2 «Ver correr» repite la carrera en la pista del nodo y llega a su distancia", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  // La pista elegida es otra: la carrera tiene que ser en la del nodo.
  await abrir(page, { linaje: "demo-5-generaciones", pista: "rampa" });
  await abrirLinaje(page);
  const n3 = nodoGen3();
  await tocar(page, n3.id);
  await page.getByTestId("ver-correr").click();
  await expect.poll(async () => (await estado(page)).pantalla).toBe("pista");
  await expect.poll(async () => (await estado(page)).pistaSeleccionada).toBe(n3.trackId);
  await expect(page.getByTestId("pista")).toBeVisible();
  await expect.poll(async () => (await estado(page)).genomaEnPista !== null).toBe(true);
  for (let i = 0; i < 8 && (await estado(page)).ultimoResultado === null; i++) await adelantar(page, 200);
  const r = await estado(page);
  expect(r.ultimoResultado!.trackId).toBe(n3.trackId);
  // Con detmath el núcleo da la misma marca en Node y en Chromium.
  expect(r.ultimoResultado!.distance).toBe(n3.distance);
});

test("ln-3 sin linaje la pantalla lo dice y lleva a Evolución", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { vacio: true });
  await abrirLinaje(page);
  await expect(page.getByTestId("linaje-vacio")).toContainText("Aún no hay árbol: evoluciona una población o guarda un coche para ver de dónde viene.");
  await capturas(page, "vacio");
  await page.setViewportSize({ width: 360, height: 640 });
  await page.getByTestId("vacio-evolucion").click();
  await expect(page.getByTestId("inicio-evolucion")).toBeVisible();
});

/** 36 generaciones de 10 coches; cada uno hijo de dos de la anterior. El último, el de más metros, tiene unos 300 antepasados. */
function linajeGrande() {
  const nodos = [];
  for (let g = 0; g < 36; g++) {
    for (let k = 0; k < 10; k++) {
      nodos.push({
        id: `g${g}-${k}`,
        parents: g === 0 ? [] : [`g${g - 1}-${k}`, `g${g - 1}-${(k + 1) % 10}`],
        op: g === 0 ? "design" : "crossover",
        generation: g,
        distance: 10 + g * 3 + k * 0.1,
        trackId: "cordillera",
        genome: STOCK_CAR,
        hue: (g * 37 + k * 11) % 360,
        humanTouched: g === 0,
        prunedParents: false,
      });
    }
  }
  return nodos;
}

test("ln-4 un linaje de 300 nodos se dispone rápido, se desplaza y mantiene etiquetas de 12 px", async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { linaje: linajeGrande() });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await abrirLinaje(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  expect(Number(await page.getByTestId("linaje-lienzo").getAttribute("data-nodos"))).toBeGreaterThanOrEqual(300);
  const disposicion = await page.evaluate(() => performance.getEntriesByName("dd:linaje:disposicion").map((e) => e.duration));
  expect(disposicion.length, "marca de disposición").toBeGreaterThan(0);
  expect(Math.max(...disposicion)).toBeLessThanOrEqual(300);

  // Etiquetas: el tamaño en pantalla es el del texto por la escala acumulada.
  const px = await page.getByTestId("nodo-distancia").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize) * (el as SVGGraphicsElement).getScreenCTM()!.a);
  expect(px).toBeGreaterThanOrEqual(12);
  await page.screenshot({ path: `${DIR}/${ID}-300-nodos-360x640.png` });

  const svg = page.getByTestId("linaje-svg");
  const antes = (await svg.boundingBox())!;
  const caja = (await page.getByTestId("linaje-lienzo").boundingBox())!;
  const cx = caja.x + caja.width / 2;
  const cy = caja.y + caja.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy - 120, { steps: 6 });
  await page.mouse.up();
  const despues = (await svg.boundingBox())!;
  expect(Math.round(antes.x - despues.x)).toBe(60);
  expect(Math.round(antes.y - despues.y)).toBe(120);
  // Un desplazamiento no abre ninguna hoja.
  await expect(page.getByTestId("hoja-nodo")).toHaveCount(0);

  await page.getByTestId("zoom-menos").click();
  const reducido = (await svg.boundingBox())!;
  expect(reducido.width).toBeLessThan(despues.width);
  await page.getByTestId("zoom-mas").click();
  await page.getByTestId("zoom-mas").click();
  expect((await svg.boundingBox())!.width).toBeGreaterThan(despues.width);

  await tocar(page, "g35-9");
  await expect(page.getByTestId("hoja-nodo")).toBeVisible();
  const abrirNodo = () => page.evaluate(() => window.__debug!.latencias().filter((l) => l.evento === "abrir-nodo"));
  await expect.poll(async () => (await abrirNodo()).length).toBeGreaterThan(0);
  const lat = await abrirNodo();
  expect(lat[lat.length - 1].ms).toBeLessThanOrEqual(200);
});

test("ln-5 un coche evolucionado, retocado a mano y evolucionado de nuevo cuelga del original como «✋ retoque»", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page, { linaje: "demo-5-generaciones" });
  await abrirLinaje(page);
  const original = demoJson.campeon;
  await tocar(page, original);
  await page.getByTestId("abrir-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
  await expect.poll(async () => (await estado(page)).genomaEnTaller !== null).toBe(true);
  await page.waitForTimeout(300);

  // Se mueve el vértice 0 hacia el centro.
  const caja = (await page.locator("canvas").boundingBox())!;
  const g = (await estado(page)).genomaEnTaller!;
  const s = Math.min(caja.width, caja.height) / 7;
  const v = g.body[0];
  const x = caja.x + caja.width / 2 + Math.cos(v.angle) * v.length * s;
  const y = caja.y + caja.height / 2 - Math.sin(v.angle) * v.length * s;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move((x + caja.x + caja.width / 2) / 2, (y + caja.y + caja.height / 2) / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await estado(page)).genomaEnTaller!.body[0].length).not.toBe(g.body[0].length);

  await page.getByTestId("evolucionar").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await expect.poll(async () => (await estado(page)).pantalla).toBe("evolucion");
  await adelantar(page, 900);
  await page.getByTestId("volver").click();
  await abrirLinaje(page);
  await page.getByTestId("linaje-selector").selectOption({ label: "campeón actual" });
  const retoque = page.locator('[data-testid="nodo-linaje"][data-op="retouch"]');
  await expect(retoque).toHaveCount(1);
  await expect(retoque.getByTestId("nodo-mano")).toHaveText("✋ retoque");
  const id = (await retoque.getAttribute("data-id"))!;
  await expect(page.locator(`[data-testid="arista"][data-hasta="${id}"]`)).toHaveAttribute("data-desde", original);
  await page.screenshot({ path: `${DIR}/${ID}-retoque-360x640.png` });
  await capturas(page, "retoque");
  expect(porId.has(original)).toBe(true);
});
