import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "portada-jerarquia-1";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

async function abrirPortada(page: Page) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await expect(page.getByTestId("portada")).toBeVisible();
}

const caja = async (l: ReturnType<Page["locator"]>) => (await l.boundingBox())!;

for (const t of TAMANOS) {
  test(`por-1 tres zonas con estilos distintos @tamanos ${t.w}x${t.h}`, async ({ page }) => {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrirPortada(page);

    const zonas = [page.getByTestId("zona-jugar"), page.getByTestId("zona-records"), page.getByTestId("zona-mas")];
    const titulos = ["Jugar", "Récords por pista", "Más"];
    for (let i = 0; i < 3; i++) await expect(zonas[i].getByRole("heading", { level: 2 })).toHaveText(titulos[i]);

    const jugar = zonas[0];
    await expect(jugar.locator(".boton-primario")).toHaveCount(1);
    await expect(jugar.locator(".boton-primario")).toHaveText("Taller");
    const estilo = (l: ReturnType<Page["locator"]>) =>
      l.first().evaluate((el) => {
        const s = getComputedStyle(el);
        return { fondo: s.backgroundColor, borde: parseFloat(s.borderTopWidth) };
      });
    const prim = await estilo(jugar.locator(".boton-primario"));
    expect(prim.fondo).not.toBe("rgba(0, 0, 0, 0)");
    const sec = await estilo(jugar.locator(".boton-secundario"));
    expect(sec.fondo).toBe("rgba(0, 0, 0, 0)");
    expect(sec.borde).toBeGreaterThanOrEqual(2);
    const ter = zonas[2].locator(".enlace-terciario");
    await expect(ter).toHaveCount(6);
    for (const e of await ter.all()) {
      const s = await e.evaluate((el) => ({ borde: parseFloat(getComputedStyle(el).borderTopWidth), fondo: getComputedStyle(el).backgroundColor }));
      expect(s.borde).toBe(0);
      expect(s.fondo).toBe("rgba(0, 0, 0, 0)");
      expect((await caja(e)).height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByTestId("tarjeta-rampa")).toBeVisible();

    // Separación entre zonas ≥ 24 px y entre botones de una misma zona ≥ 8 px.
    const [a, b, c] = [await caja(zonas[0]), await caja(zonas[1]), await caja(zonas[2])];
    expect(b.y - (a.y + a.height)).toBeGreaterThanOrEqual(24 - 0.5);
    expect(c.y - (b.y + b.height)).toBeGreaterThanOrEqual(24 - 0.5);
    const taller = await caja(page.getByTestId("acceso-taller"));
    const evo = await caja(page.getByTestId("acceso-evolucion"));
    expect(evo.y - (taller.y + taller.height)).toBeGreaterThanOrEqual(8 - 0.5);

    // Sin desplazamiento horizontal de la página.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(taller.height).toBeGreaterThanOrEqual(48);

    await page.screenshot({ path: `${DIR}/${ID}-portada-${t.w}x${t.h}.png` });
  });
}

test("por-3 a 360x640 se ve el título, «Taller» y el principio de los récords sin desplazar", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrirPortada(page);
  const vp = { w: 360, h: 640 };
  for (const l of [page.locator("h1.titulo"), page.getByTestId("acceso-taller"), page.getByTestId("tarjeta-cordillera")]) {
    const b = await caja(l);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + 20).toBeLessThanOrEqual(vp.h);
  }
  const todos = ["acceso-taller", "acceso-evolucion", "acceso-garaje", "acceso-linaje", "acceso-especies", "acceso-explorar", "acceso-serie", "acceso-guia"];
  for (const id of todos) expect((await caja(page.getByTestId(id))).height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `${DIR}/${ID}-sin-desplazar-360x640.png` });
});

test("por-2 cada acceso sigue llevando a su pantalla", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const destinos: [string, string][] = [
    ["acceso-taller", "taller"],
    ["tarjeta-rampa", "rankings"],
    ["acceso-garaje", "garaje"],
    ["acceso-linaje", "linaje"],
    ["acceso-especies", "especies"],
    ["acceso-explorar", "pista"],
    ["acceso-serie", "pista"],
    ["acceso-evolucion", "evolucion"],
  ];
  for (const [testid, pantalla] of destinos) {
    await abrirPortada(page);
    await page.getByTestId(testid).click();
    await expect.poll(() => page.evaluate(() => window.__debug!.estado().pantalla)).toBe(pantalla);
  }
  await abrirPortada(page);
  await page.getByTestId("acceso-guia").click();
  await expect.poll(() => page.evaluate(() => window.__debug!.estado().guia.abierta)).toBe(true);
});
