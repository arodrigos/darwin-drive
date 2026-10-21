import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "pistas-nuevas-1";
const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];
const NUEVAS = [
  { id: "glaciar", nombre: "El Glaciar" },
  { id: "trampolines", nombre: "Los Trampolines" },
  { id: "escalera", nombre: "La Escalera" },
] as const;
const TODAS = ["cordillera", "rampa", "dunas", "pedregal", "glaciar", "trampolines", "escalera"];

type Estado = { rankings: Record<string, { distance: number }[]>; pistaSeleccionada: string };
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

async function abrir(page: Page, escenario: Record<string, unknown> = { vacio: true }) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

test("pn-1 las tres pistas nuevas se corren hasta el final, aparecen en Rankings y la marca sigue tras recargar", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 360, height: 640 });
  for (const p of NUEVAS) {
    await abrir(page, { vacio: true, pista: p.id });
    await page.getByTestId("acceso-taller").click();
    await expect(page.getByTestId("selector-pista")).toContainText(p.nombre);
    await page.getByTestId("probar").click();
    await expect(page.getByTestId("pista")).toBeVisible();
    await page.getByTestId("ritmo-final").click();
    await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
    await expect.poll(async () => (await estado(page)).rankings[p.id].length).toBe(1);
    const marca = (await estado(page)).rankings[p.id][0].distance;
    expect(marca).toBeGreaterThan(0);

    await page.reload();
    await page.waitForFunction(() => Boolean(window.__debug));
    await expect.poll(async () => (await estado(page)).rankings[p.id].length).toBe(1);
    expect((await estado(page)).rankings[p.id][0].distance).toBe(marca);

    // La portada enseña la marca en la tarjeta y la pestaña de Rankings la lista.
    await expect(page.getByTestId(`tarjeta-${p.id}`)).toContainText("n.º 1");
    await page.getByTestId(`tarjeta-${p.id}`).click();
    await expect(page.getByTestId("rankings")).toBeVisible();
    await expect(page.getByTestId(`pestana-${p.id}`)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("fila-ranking")).toHaveCount(1);
    await page.screenshot({ path: `${DIR}/${ID}-ranking-${p.id}-360x640.png` });
  }
});

test("pn-5 el carrusel cabe en 120 px, deja ver todo el lienzo y «Probar» en cada pantalla y tamaño", async ({ page }) => {
  test.setTimeout(240_000);
  const pantallas = [
    { acceso: "acceso-explorar", nombre: "explorar" },
    { acceso: "acceso-taller", nombre: "taller" },
    { acceso: "acceso-garaje", nombre: "garaje" },
    { acceso: "acceso-evolucion", nombre: "evolucion" },
  ];
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    for (const pantalla of pantallas) {
      await abrir(page);
      await page.getByTestId(pantalla.acceso).click();
      await page.getByTestId("selector-pista").click();
      const hoja = page.getByTestId("hoja-pistas");
      await expect(hoja).toBeVisible();
      const tarjetas = hoja.locator("button.tarjeta-pista");
      await expect(tarjetas).toHaveCount(7);
      const carrusel = (await page.getByTestId("carrusel-pistas").boundingBox())!;
      expect(carrusel.height).toBeLessThanOrEqual(120);
      for (const caja of await tarjetas.evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }))) {
        expect(caja[0]).toBeGreaterThanOrEqual(44);
        expect(caja[1]).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `${DIR}/${ID}-carrusel-${pantalla.nombre}-${t.w}x${t.h}.png` });

      // Al elegir una pista nueva la hoja se cierra y quedan a la vista el lienzo entero y, si lo hay, «Probar».
      await page.getByTestId("pista-escalera").click();
      await expect(hoja).toHaveCount(0);
      await expect(page.getByTestId("selector-pista")).toContainText("La Escalera");
      const lienzo = page.getByTestId("lienzo");
      if (await lienzo.count()) {
        const c = (await lienzo.boundingBox())!;
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x + c.width).toBeLessThanOrEqual(t.w + 1);
        expect(c.y + c.height).toBeLessThanOrEqual(t.h + 1);
      }
      const probar = page.getByTestId("probar");
      if (await probar.count()) await expect(probar).toBeInViewport();
    }
  }
});

test("pn-1 cada pista nueva se puede elegir en el selector y se recuerda", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  for (const p of NUEVAS) {
    await abrir(page);
    await page.getByTestId("acceso-explorar").click();
    await page.getByTestId("selector-pista").click();
    await page.getByTestId(`pista-${p.id}`).click();
    await expect(page.getByTestId("selector-pista")).toHaveText(`Pista: ${p.nombre} ▾`);
    expect((await estado(page)).pistaSeleccionada).toBe(p.id);
  }
  expect(TODAS).toHaveLength(7);
});

test("pn-6 una pista nueva sin marcas enseña el estado vacío en Rankings", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page);
    await page.getByTestId("tarjeta-glaciar").click();
    await expect(page.getByTestId("rankings")).toBeVisible();
    await expect(page.getByTestId("ranking-vacio")).toBeVisible();
    await expect(page.getByTestId("vacio-taller")).toBeVisible();
    await page.screenshot({ path: `${DIR}/${ID}-rankings-glaciar-vacio-${t.w}x${t.h}.png` });
  }
});

test("pn-8 la guía trae la ficha de cada pista nueva y el selector su lema", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page);
    await page.getByTestId("acceso-guia").click();
    await page.getByTestId("guia-ir-pistas").click();
    for (const p of NUEVAS) {
      const ficha = page.getByTestId(`ficha-${p.id}`);
      await expect(ficha).toContainText(p.nombre);
      await expect(ficha).toContainText("Premia:");
    }
    await page.screenshot({ path: `${DIR}/${ID}-guia-fichas-${t.w}x${t.h}.png` });
  }
});

test("pn-4 las superficies se dibujan con su patrón en las pistas nuevas", async ({ page }) => {
  test.setTimeout(120_000);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    for (const p of NUEVAS) {
      await abrir(page, { vacio: true, pista: p.id });
      await page.getByTestId("acceso-explorar").click();
      await page.waitForFunction(() => window.__debug!.estado().tramosGenerados > 0);
      await page.screenshot({ path: `${DIR}/${ID}-superficie-${p.id}-${t.w}x${t.h}.png` });
    }
  }
});
