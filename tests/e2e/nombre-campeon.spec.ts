import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "nombre-campeon-1";
const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];
const SUCIO = "<img src=x onerror=alert(1)>";

type Estado = {
  pantalla: string;
  generacion: number | null;
  hojaNombre: { modo: string; propuesto: string } | null;
  garaje: number;
  rankings: Record<string, { carId: string; distance: number }[]>;
};
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);
const latencias = (page: Page, evento: string) =>
  page.evaluate((e) => window.__debug!.latencias().filter((l) => l.evento === e), evento);

async function abrir(page: Page, escenario: Record<string, unknown>) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

// Deja la evolución de demostración con una generación terminada, para que haya campeón que guardar.
async function enEvolucion(page: Page) {
  await abrir(page, { vacio: true, evolucion: "demo-gen-8" });
  await page.getByTestId("acceso-continuar").click();
  await expect.poll(async () => (await estado(page)).generacion ?? 0).toBeGreaterThan(0);
  await page.evaluate(() => window.__debug!.adelantarSimulacion(200));
  await expect(page.getByTestId("guardar-campeon")).toBeEnabled();
}

test("nom-1 guardar campeón pide nombre, avisa y lo enseñan Garaje y Rankings tras recargar", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await enEvolucion(page);
  await page.getByTestId("guardar-campeon").click();
  const hoja = page.getByTestId("hoja-nombre");
  await expect(hoja).toBeVisible();
  const input = page.getByTestId("nombre-input");
  const propuesto = await input.inputValue();
  expect(propuesto.length).toBeGreaterThan(2);
  expect(propuesto).not.toMatch(/^Campeón gen/);
  expect(await page.evaluate(() => { const i = document.activeElement as HTMLInputElement; return i.selectionStart === 0 && i.selectionEnd === i.value.length; })).toBe(true);
  await expect(page.getByTestId("hoja-nombre-ficha")).toHaveText(/^Evolucionado en La Cordillera · gen \d+$/);
  expect((await estado(page)).hojaNombre).toMatchObject({ modo: "guardar", propuesto });
  const g0 = (await estado(page)).generacion!;
  await page.screenshot({ path: `${DIR}/${ID}-hoja-360x640.png` });

  await input.fill("Rayo Azul");
  await page.getByTestId("nombre-guardar").click();
  await expect(page.getByTestId("aviso-guardado")).toHaveText("Guardado en el garaje como «Rayo Azul»");
  await expect(hoja).toBeHidden();
  await page.screenshot({ path: `${DIR}/${ID}-aviso-360x640.png` });
  expect((await estado(page)).hojaNombre).toBeNull();
  // La evolución siguió viva debajo.
  await page.evaluate(() => window.__debug!.adelantarSimulacion(200));
  expect((await estado(page)).generacion!).toBeGreaterThanOrEqual(g0);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-garaje").click();
  await expect(page.getByTestId("tarjeta-coche").first()).toContainText("Rayo Azul");
  await expect(page.getByTestId("ficha-origen").first()).toHaveText(/^Evolucionado en La Cordillera · gen \d+$/);
  await page.screenshot({ path: `${DIR}/${ID}-garaje-360x640.png` });
  await page.getByTestId("volver").click();
  await page.getByTestId("tarjeta-cordillera").click();
  await expect(page.getByTestId("ranking-lista")).toContainText("Rayo Azul");
  await page.screenshot({ path: `${DIR}/${ID}-ranking-360x640.png` });
});

test("nom-1 campo vacío guarda el propuesto y «Cancelar» no guarda", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await enEvolucion(page);
  await page.getByTestId("guardar-campeon").click();
  await page.getByTestId("nombre-cancelar").click();
  await expect(page.getByTestId("hoja-nombre")).toBeHidden();
  expect((await estado(page)).garaje).toBe(0);
  await page.evaluate(() => window.__debug!.adelantarSimulacion(200));
  await page.getByTestId("guardar-campeon").click();
  const propuesto = await page.getByTestId("nombre-input").inputValue();
  await page.getByTestId("nombre-input").fill("   ");
  await page.getByTestId("nombre-guardar").click();
  await expect(page.getByTestId("aviso-guardado")).toHaveText(`Guardado en el garaje como «${propuesto}»`);
});

test("nom-2 y nom-3 Renombrar cambia Garaje y Rankings, mantiene la fecha y pinta el texto literal", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await enEvolucion(page);
  await page.getByTestId("guardar-campeon").click();
  await page.getByTestId("nombre-input").fill("Rayo Azul");
  await page.getByTestId("nombre-guardar").click();
  await expect(page.getByTestId("aviso-guardado")).toBeVisible();
  await page.getByTestId("volver").click();
  await page.getByTestId("tarjeta-cordillera").click();
  const fechaAntes = await page.getByTestId("ranking-lista").locator(".fecha").first().textContent();
  await page.getByTestId("volver").click();
  await page.getByTestId("acceso-garaje").click();

  const imgs = await page.locator("img").count();
  await page.getByTestId("garaje-renombrar").first().click();
  await expect(page.getByTestId("hoja-nombre")).toBeVisible();
  await expect(page.getByTestId("nombre-input")).toHaveValue("Rayo Azul");
  await page.getByTestId("nombre-input").fill(SUCIO);
  await page.getByTestId("nombre-guardar").click();
  await expect(page.getByTestId("hoja-nombre")).toBeHidden();
  await expect(page.getByTestId("tarjeta-coche").first()).toContainText(SUCIO);
  expect(await page.locator("img").count()).toBe(imgs);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("tarjeta-cordillera").click();
  await expect(page.getByTestId("ranking-lista")).toContainText(SUCIO);
  expect(await page.locator("img").count()).toBe(imgs);
  expect(await page.getByTestId("ranking-lista").locator(".fecha").first().textContent()).toBe(fechaAntes);
  await page.getByTestId("fila-ranking").first().click();
  await expect(page.getByTestId("hoja-fila")).toContainText(SUCIO);
  expect(await page.locator("img").count()).toBe(imgs);
});

test("nom-3 el aviso de guardado y la hoja pintan un nombre con HTML como texto", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await enEvolucion(page);
  const imgs = await page.locator("img").count();
  await page.getByTestId("guardar-campeon").click();
  await page.getByTestId("nombre-input").fill(SUCIO + "‮");
  expect(await page.locator("img").count()).toBe(imgs);
  await page.getByTestId("nombre-guardar").click();
  await expect(page.getByTestId("aviso-guardado")).toHaveText(`Guardado en el garaje como «${SUCIO}»`);
  expect(await page.locator("img").count()).toBe(imgs);
});

test("nom-4 con el teclado a la vista la hoja muestra campo y Guardar; Esc, Cancelar, fuera y atrás cierran sin guardar", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await enEvolucion(page);
  await page.getByTestId("guardar-campeon").click();
  await expect(page.getByTestId("nombre-ayuda")).toHaveText("Pon el nombre que quieras: podrás cambiarlo en el Garaje");
  await page.setViewportSize({ width: 360, height: 340 });
  for (const id of ["nombre-input", "nombre-guardar", "nombre-cancelar"]) {
    const c = (await page.getByTestId(id).boundingBox())!;
    expect(c.y, id).toBeGreaterThanOrEqual(0);
    expect(c.y + c.height, id).toBeLessThanOrEqual(340);
  }
  await page.screenshot({ path: `${DIR}/${ID}-teclado-360x340.png` });
  await page.setViewportSize({ width: 360, height: 640 });

  const cierres: [string, () => Promise<void>][] = [
    ["Esc", () => page.keyboard.press("Escape")],
    ["Cancelar", () => page.getByTestId("nombre-cancelar").click()],
    ["fuera", () => page.getByTestId("hoja-nombre-fondo").click({ position: { x: 5, y: 600 } })],
    ["atrás", async () => { await page.goBack(); }],
  ];
  for (const [nombre, cerrar] of cierres) {
    await page.getByTestId("guardar-campeon").click();
    await expect(page.getByTestId("hoja-nombre"), nombre).toBeVisible();
    await cerrar();
    await expect(page.getByTestId("hoja-nombre"), nombre).toBeHidden();
    expect((await estado(page)).pantalla, nombre).toBe("evolucion");
    expect((await estado(page)).garaje, nombre).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), nombre).toBe("guardar-campeon");
  }
});

test("nom-5 abrir la hoja y guardar tardan 200 ms o menos, en los tres tamaños", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await enEvolucion(page);
    await page.getByTestId("guardar-campeon").click();
    await expect(page.getByTestId("hoja-nombre")).toBeVisible();
    await page.screenshot({ path: `${DIR}/${ID}-hoja-${t.w}x${t.h}.png` });
    await page.getByTestId("nombre-guardar").click();
    await expect(page.getByTestId("aviso-guardado")).toBeVisible();
    await expect.poll(async () => (await latencias(page, "guardar-nombre")).length).toBeGreaterThan(0);
    for (const e of ["hoja-nombre", "guardar-nombre"]) {
      const m = await latencias(page, e);
      expect(m.length, e).toBeGreaterThan(0);
      expect(m[m.length - 1].ms, `${e} ${t.w}x${t.h}`).toBeLessThanOrEqual(200);
    }
  }
});
