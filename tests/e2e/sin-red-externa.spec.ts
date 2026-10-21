import { test, expect, type Page } from "@playwright/test";

// Con el service worker activo: en Chromium `context.on('request')` también ve lo que pide el worker.
test.use({ serviceWorkers: "allow" });

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "nombre-campeon-1";

type Estado = { generacion: number | null };
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

test("nom-6 un recorrido completo no hace ninguna petición a otro origen", async ({ page, context, baseURL }) => {
  test.setTimeout(240_000);
  const origen = new URL(baseURL!).origin;
  const vistas: string[] = [];
  const externas: string[] = [];
  context.on("request", (r) => {
    const url = r.url();
    vistas.push(url);
    if (/^https?:/i.test(url) && new URL(url).origin !== origen) externas.push(url);
  });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug) && window.__debug!.pwa.controlado, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true, evolucion: "demo-gen-8" }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));

  await page.getByTestId("acceso-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
  await page.getByTestId("volver").click();

  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await page.getByTestId("ritmo-final").click();
  await page.evaluate(() => window.__debug!.adelantarSimulacion(200));
  await page.getByTestId("volver").click();

  await page.getByTestId("acceso-continuar").click();
  await expect.poll(async () => (await estado(page)).generacion ?? 0).toBeGreaterThan(0);
  await page.evaluate(() => window.__debug!.adelantarSimulacion(200));
  await page.getByTestId("guardar-campeon").click();
  await page.getByTestId("nombre-input").fill("Rayo Azul");
  await page.getByTestId("nombre-guardar").click();
  await expect(page.getByTestId("aviso-guardado")).toContainText("Rayo Azul");
  await page.getByTestId("volver").click();

  await page.getByTestId("tarjeta-cordillera").click();
  await expect(page.getByTestId("ranking-lista")).toContainText("Rayo Azul");
  await page.getByTestId("volver").click();

  await page.getByTestId("acceso-garaje").click();
  const [descarga] = await Promise.all([page.waitForEvent("download"), page.getByTestId("copia-exportar").click()]);
  const texto = await (await import("node:fs/promises")).readFile((await descarga.path())!, "utf8");
  await page.getByTestId("copia-fichero").setInputFiles({ name: "copia.json", mimeType: "application/json", buffer: Buffer.from(texto) });
  await page.getByTestId("copia-reemplazar").click();
  await expect(page.getByTestId("copia-ok")).toContainText("Copia importada");
  await page.getByTestId("volver").click();

  await page.getByTestId("acceso-guia").click();
  await expect(page.getByTestId("guia")).toBeVisible();
  await page.screenshot({ path: `${DIR}/${ID}-sin-red-360x640.png` });

  // La lista queda en el informe de Playwright aunque el test pase.
  test.info().annotations.push({ type: "peticiones", description: [...new Set(vistas)].join("\n") });
  expect(externas, `peticiones a otro origen:\n${externas.join("\n")}`).toEqual([]);
});
