import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// Único spec que deja actuar al service worker; el resto de la suite va con
// serviceWorkers:'block' para que nada se juzgue servido desde una caché.
test.use({ serviceWorkers: "allow" });

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "pwa-copia-28";
const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Estado = { pantalla: string; generacion: number | null; ultimoResultado: { trackId: string; distance: number } | null; cochesVivos: number };
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

async function esperarInstalacion(page: Page) {
  await page.waitForFunction(() => Boolean(window.__debug) && window.__debug!.pwa.controlado, undefined, { timeout: 60_000 });
}

async function abrirInstalado(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/?pruebas=1");
  await esperarInstalacion(page);
  return page;
}

test("pw-4 tras la primera visita el juego abre y se juega sin conexión", async ({ context }) => {
  test.setTimeout(180_000);
  const page = await abrirInstalado(context);
  await page.evaluate(() => window.__debug!.cargarEscenario({ pista: "rampa" }));
  await context.setOffline(true);
  const respuesta = await page.reload();
  expect(respuesta!.fromServiceWorker()).toBe(true);
  await page.waitForFunction(() => Boolean(window.__debug));

  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await expect.poll(async () => (await estado(page)).cochesVivos).toBe(1);
  await page.evaluate(() => window.__debug!.adelantarSimulacion(200));
  expect((await estado(page)).ultimoResultado?.trackId).toBe("rampa");
  await page.screenshot({ path: `${DIR}/${ID}-sin-conexion-rampa-360x640.png` });

  await page.getByTestId("volver").click();
  await page.getByTestId("acceso-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
  await page.getByTestId("volver").click();
  await page.getByTestId("tarjeta-rampa").click();
  await expect(page.getByTestId("rankings")).toBeVisible();
  await page.getByTestId("volver").click();
  await page.getByTestId("acceso-evolucion").click();
  await expect(page.getByTestId("inicio-evolucion")).toBeVisible();
  await page.getByTestId("empezar-evolucion").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await expect.poll(async () => (await estado(page)).generacion, { timeout: 60_000 }).toBe(1);
  await context.setOffline(false);
});

test("pw-5 una versión nueva se avisa y no interrumpe la evolución hasta tocar Recargar", async ({ context }) => {
  test.setTimeout(180_000);
  const page = await abrirInstalado(context);
  await page.getByTestId("acceso-evolucion").click();
  await page.getByTestId("empezar-evolucion").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await expect.poll(async () => (await estado(page)).generacion).toBe(1);
  await page.evaluate(() => {
    (window as unknown as { __marca: number }).__marca = 1;
  });

  await page.evaluate(() => window.__debug!.pwa.forzarVersionNueva());
  const aviso = page.getByTestId("aviso-version-nueva");
  await expect(aviso).toBeVisible({ timeout: 5_000 });
  await expect(aviso).toHaveText("Hay una versión nueva · Recargar");
  expect((await page.getByTestId("recargar-version").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await page.screenshot({ path: `${DIR}/${ID}-version-nueva-${t.w}x${t.h}.png` });
  }
  await page.setViewportSize({ width: 360, height: 640 });

  // Sin tocar nada, la página no se recarga y la evolución sigue en la pantalla.
  await page.waitForTimeout(4_000);
  expect(await page.evaluate(() => (window as unknown as { __marca?: number }).__marca)).toBe(1);
  await expect(page.getByTestId("evolucion")).toBeVisible();
  expect((await estado(page)).generacion).not.toBeNull();

  let cargas = 0;
  page.on("load", () => {
    cargas++;
  });
  await Promise.all([page.waitForEvent("load", { timeout: 30_000 }), page.getByTestId("recargar-version").click()]);
  await page.waitForTimeout(1_500);
  expect(cargas).toBe(1);
  await expect(page.getByTestId("aviso-version-nueva")).toHaveCount(0);
});
