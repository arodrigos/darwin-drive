import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "identidad-coche-5";
const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];
test.setTimeout(120_000);

type Id = { nombre: string; color: string } | null;
const identidad = (page: Page) => page.evaluate(() => (window.__debug!.estado() as unknown as { identidadTaller: Id }).identidadTaller);

async function abrirTaller(page: Page) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
}

for (const t of TAMANOS) {
  test(`id-1 cabecera con nombre y muestra; el color recolorea el lienzo @tamanos ${t.w}x${t.h}`, async ({ page }) => {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrirTaller(page);
    const inicial = (await identidad(page))!;
    expect(inicial.nombre.split(" ")).toHaveLength(2);
    await expect(page.getByTestId("taller-nombre")).toHaveText(inicial.nombre);
    await page.screenshot({ path: `${DIR}/${ID}-taller-cabecera-${t.w}x${t.h}.png` });

    await page.getByTestId("taller-color").click();
    await expect(page.getByTestId("fila-colores").getByRole("button")).toHaveCount(8);
    await page.getByTestId("color-azul").click();
    // Elegir cierra la paleta para que el coche recoloreado quede a la vista.
    await expect(page.getByTestId("fila-colores")).toHaveCount(0);
    expect((await identidad(page))!.color).toBe("azul");
    await page.getByTestId("taller-color").click();
    await expect(page.getByTestId("color-azul")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("color-azul").click();
    await expect.poll(() => page.evaluate(() => window.__debug!.latencias().filter((l) => l.evento === "color-coche").length)).toBeGreaterThan(0);
    const ms = await page.evaluate(() => window.__debug!.latencias().filter((l) => l.evento === "color-coche").map((l) => l.ms));
    expect(Math.max(...ms)).toBeLessThanOrEqual(200);
    // Un pixel del relleno del coche (centro del lienzo) ya no es el naranja de antes: el color se pinta de verdad.
    const hayAzul = await page.getByTestId("lienzo").locator("canvas").evaluate((c: HTMLCanvasElement) => {
      const tmp = document.createElement("canvas");
      tmp.width = c.width;
      tmp.height = c.height;
      const ctx = tmp.getContext("2d")!;
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let azules = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i] + 40 && d[i + 2] > 120) azules++;
      return azules;
    });
    expect(hayAzul).toBeGreaterThan(200);
    await page.screenshot({ path: `${DIR}/${ID}-taller-azul-${t.w}x${t.h}.png` });
  });
}

test("id-1/id-2/id-5 renombrar, guardar, probar y recargar conservan nombre y color; el hash no cambia", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrirTaller(page);
  const hashAntes = await page.evaluate(() => JSON.stringify(window.__debug!.estado().genomaEnTaller));

  // Un nombre vacío no se acepta.
  await page.getByTestId("taller-nombre").click();
  await page.getByTestId("nombre-input").fill("   ");
  await page.getByTestId("nombre-guardar").click();
  await expect(page.getByTestId("nombre-error")).toHaveText("Ponle un nombre de al menos una letra");
  await page.getByTestId("nombre-input").fill("Rayo Azul");
  await page.getByTestId("nombre-guardar").click();
  await expect(page.getByTestId("taller-nombre")).toHaveText("Rayo Azul");

  await page.getByTestId("taller-color").click();
  await page.getByTestId("color-azul").click();
  expect(await identidad(page)).toEqual({ nombre: "Rayo Azul", color: "azul" });
  expect(await page.evaluate(() => JSON.stringify(window.__debug!.estado().genomaEnTaller))).toBe(hashAntes);

  await page.getByTestId("guardar").click();
  await expect(page.getByTestId("aviso-guardado")).toHaveText(/Guardado/);

  await page.getByTestId("probar").click();
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ path: `${DIR}/${ID}-pista-azul-360x640.png` });

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-garaje").click();
  const nombre = page.getByTestId("garaje-nombre").first();
  await expect(nombre).toHaveText("Rayo Azul");
  await expect(nombre.getByTestId("muestra-color")).toHaveAttribute("data-color", "azul");
  await page.screenshot({ path: `${DIR}/${ID}-garaje-360x640.png` });
  expect(await page.evaluate(() => window.__debug!.estado().garaje)).toBe(1);

  await page.getByTestId("volver").click();
  await page.getByTestId("tarjeta-cordillera").click();
  const fila = page.getByTestId("fila-ranking").first();
  await expect(fila.getByTestId("fila-nombre")).toHaveText("Rayo Azul");
  await expect(fila.getByTestId("muestra-color")).toHaveAttribute("data-color", "azul");
  await page.screenshot({ path: `${DIR}/${ID}-ranking-azul-360x640.png` });
});

test("id-3 «Coche nuevo» pide confirmación si hay cambios y trae otro nombre", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrirTaller(page);
  const antes = (await identidad(page))!.nombre;
  // Sin cambios no pregunta.
  await page.getByTestId("coche-nuevo").click();
  await expect(page.getByTestId("confirmar-nuevo")).toBeHidden();
  const medio = (await identidad(page))!.nombre;
  expect(medio).not.toBe(antes);

  await page.getByTestId("deslizador-peso").fill("150");
  await page.getByTestId("coche-nuevo").click();
  await expect(page.getByTestId("confirmar-nuevo")).toContainText("Se perderá el diseño actual si no lo guardas");
  await page.screenshot({ path: `${DIR}/${ID}-confirmar-nuevo-360x640.png` });
  await page.getByTestId("confirmar-nuevo-si").click();
  expect((await identidad(page))!.nombre).not.toBe(medio);
  expect((await identidad(page))!.color).toBe("naranja");
});
