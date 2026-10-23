import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "lienzo-1";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Estado = {
  distanciaLider: number | null;
  ritmo: string | null;
  lienzo: string;
  contextosWebgl: number;
  sondasLienzo: number;
  camaraX: number;
  generacion: number | null;
  genomaEnTaller: { body: { length: number }[] } | null;
  ultimoResultado: Record<string, unknown> | null;
};
const estado = (page: Page) =>
  page.evaluate(() => window.__debug!.estado() as unknown as Estado);
const muestra = (page: Page) =>
  page.evaluate(() => window.__debug!.muestraLienzo());

async function abrir(
  page: Page,
  w: number,
  h: number,
  escenario: Record<string, unknown>,
) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

async function claves(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const req = indexedDB.open("darwin-drive-pruebas");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const st = db.transaction("datos", "readonly").objectStore("datos");
          const ks = st.getAllKeys();
          const vs = st.getAll();
          vs.onsuccess = () => {
            const out = (ks.result as string[])
              .map((k, i) => [k, vs.result[i]] as const)
              .filter(([k]) => k.startsWith("dd:v1:"))
              .sort(([a], [b]) => (a < b ? -1 : 1));
            db.close();
            resolve(JSON.stringify(out));
          };
        };
      }),
  );
}

async function verCocheDeSerie(page: Page) {
  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await expect
    .poll(async () => (await estado(page)).distanciaLider ?? 0)
    .toBeGreaterThan(1);
}

for (const { w, h } of TAMANOS) {
  test(`lz-1 @tamanos 35 entradas y salidas de la Pista y la carrera 36 se dibuja entera a ${w}x${h}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const avisos: string[] = [];
    page.on("console", (m) => {
      if (m.text().includes("Too many active WebGL contexts"))
        avisos.push(m.text());
    });
    await abrir(page, w, h, { vacio: true, pista: "cordillera" });
    for (let i = 0; i < 35; i++) {
      await verCocheDeSerie(page);
      await page.getByTestId("volver").click();
      await expect(page.getByTestId("portada")).toBeVisible();
    }
    await verCocheDeSerie(page);
    await page.waitForTimeout(3000);
    const m = await muestra(page);
    const e = await estado(page);
    expect(m.fraccionNegra).toBeLessThan(0.3);
    expect(e.contextosWebgl).toBeLessThanOrEqual(1);
    expect(e.sondasLienzo).toBe(1);
    expect(e.distanciaLider ?? 0).toBeGreaterThan(1);
    expect(avisos).toEqual([]);
    await page.screenshot({ path: `${DIR}/${ID}-carrera-36-${w}x${h}.png` });
  });

  test(`lz-1 @tamanos 40 «Repetir» seguidos en una misma Pista dejan un solo contexto a ${w}x${h}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await abrir(page, w, h, { vacio: true, pista: "rampa" });
    await verCocheDeSerie(page);
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => window.__debug!.adelantarSimulacion(900));
      await expect(page.getByTestId("tarjeta-fin")).toBeVisible({
        timeout: 60_000,
      });
      await page.getByTestId("repetir").click();
      await expect(page.getByTestId("tarjeta-fin")).toHaveCount(0);
    }
    expect((await estado(page)).contextosWebgl).toBeLessThanOrEqual(1);
    await page.waitForTimeout(1000);
    expect((await muestra(page)).fraccionNegra).toBeLessThan(0.3);
  });

  test(`lz-3 @tamanos la pérdida del contexto a media carrera se recupera sin cambiar el resultado a ${w}x${h}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await abrir(page, w, h, { vacio: true, pista: "rampa" });
    await verCocheDeSerie(page);
    await page.waitForTimeout(3000);
    const antes = (await estado(page)).distanciaLider ?? 0;
    await page.evaluate(() => {
      void window.__debug!.perderLienzo({ msRestaurar: 600 });
    });
    await expect(page.getByTestId("lienzo-recuperando")).toBeVisible();
    await expect(page.getByTestId("lienzo-recuperando")).toContainText(
      "Recuperando el dibujo",
    );
    await page.screenshot({ path: `${DIR}/${ID}-recuperando-${w}x${h}.png` });
    await expect(page.getByTestId("lienzo-recuperando")).toHaveCount(0, {
      timeout: 4000,
    });
    await page.waitForTimeout(1500);
    const e = await estado(page);
    expect(e.lienzo).toBe("ok");
    expect(e.ritmo).toBe("x1");
    expect(e.distanciaLider ?? 0).toBeGreaterThan(antes);
    expect(e.contextosWebgl).toBeLessThanOrEqual(1);
    expect((await muestra(page)).fraccionNegra).toBeLessThan(0.3);
    await page.screenshot({ path: `${DIR}/${ID}-recuperado-${w}x${h}.png` });

    await page.evaluate(() => window.__debug!.adelantarSimulacion(900));
    await expect(page.getByTestId("tarjeta-fin")).toBeVisible({
      timeout: 60_000,
    });
    const conPerdida = (await estado(page)).ultimoResultado;
    await page.getByTestId("repetir").click();
    await page.evaluate(() => window.__debug!.adelantarSimulacion(900));
    await expect(page.getByTestId("tarjeta-fin")).toBeVisible({
      timeout: 60_000,
    });
    const sinPerdida = (await estado(page)).ultimoResultado;
    expect(conPerdida).not.toBeNull();
    expect(conPerdida).toEqual(sinPerdida);
  });

  test(`lz-4 @tamanos si el contexto no vuelve, «Reintentar dibujo» rehace el lienzo a ${w}x${h}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await abrir(page, w, h, { vacio: true, pista: "rampa" });
    await verCocheDeSerie(page);
    await page.evaluate(() => {
      void window.__debug!.perderLienzo({ restaurar: false });
    });
    const boton = page.getByTestId("lienzo-reintentar");
    await expect(boton).toBeVisible({ timeout: 10_000 });
    expect((await estado(page)).lienzo).toBe("perdido");
    const caja = (await boton.boundingBox())!;
    expect(caja.width).toBeGreaterThanOrEqual(44);
    expect(caja.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${DIR}/${ID}-perdido-${w}x${h}.png` });
    await boton.click();
    await expect.poll(async () => (await estado(page)).lienzo).toBe("ok");
    await page.waitForTimeout(1000);
    expect((await muestra(page)).fraccionNegra).toBeLessThan(0.3);
    expect((await estado(page)).contextosWebgl).toBeLessThanOrEqual(1);
  });

  test(`lz-4 @tamanos la cuarta recuperación en un minuto ofrece «Reintentar dibujo» a ${w}x${h}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await abrir(page, w, h, { vacio: true, pista: "rampa" });
    await verCocheDeSerie(page);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() =>
        window.__debug!.perderLienzo({ msRestaurar: 100 }),
      );
      await expect
        .poll(async () => (await estado(page)).lienzo, { timeout: 10_000 })
        .toBe("ok");
    }
    await page.evaluate(() =>
      window.__debug!.perderLienzo({ msRestaurar: 100 }),
    );
    await expect(page.getByTestId("lienzo-reintentar")).toBeVisible({
      timeout: 10_000,
    });
    expect((await estado(page)).contextosWebgl).toBeLessThanOrEqual(1);
  });

  test(`lz-5 @tamanos Explorar, Taller y Evolución conservan lo que había tras perder el lienzo a ${w}x${h}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await abrir(page, w, h, { vacio: true, evolucion: "demo-gen-8" });

    await page.getByTestId("acceso-explorar").click();
    await expect(page.getByTestId("explorar")).toBeVisible();
    // La escena tiene que haber pintado antes de arrastrar: si no, el gesto se pierde.
    await page.waitForFunction(() => window.__debug!.estado().tramosGenerados > 0);
    const caja = (await page.getByTestId("lienzo").boundingBox())!;
    const y = caja.y + caja.height / 2;
    await page.mouse.move(caja.x + caja.width - 30, y);
    await page.mouse.down();
    await page.mouse.move(caja.x + 30, y, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => (await estado(page)).camaraX, { timeout: 5_000 })
      .toBeGreaterThan(0);
    const camara = (await estado(page)).camaraX;
    await page.evaluate(() =>
      window.__debug!.perderLienzo({ msRestaurar: 300 }),
    );
    await expect
      .poll(async () => (await estado(page)).lienzo, { timeout: 10_000 })
      .toBe("ok");
    await page.waitForTimeout(1000);
    expect((await estado(page)).camaraX).toBeCloseTo(camara, 3);
    expect((await muestra(page)).fraccionNegra).toBeLessThan(0.3);
    await page.screenshot({ path: `${DIR}/${ID}-explorar-${w}x${h}.png` });
    await page.getByTestId("volver").click();

    await page.getByTestId("acceso-taller").click();
    await expect(page.getByTestId("taller")).toBeVisible();
    const genoma = JSON.stringify((await estado(page)).genomaEnTaller);
    await page.evaluate(() =>
      window.__debug!.perderLienzo({ msRestaurar: 300 }),
    );
    await expect
      .poll(async () => (await estado(page)).lienzo, { timeout: 10_000 })
      .toBe("ok");
    await page.waitForTimeout(1000);
    expect(JSON.stringify((await estado(page)).genomaEnTaller)).toBe(genoma);
    expect((await muestra(page)).fraccionNegra).toBeLessThan(0.3);
    await page.screenshot({ path: `${DIR}/${ID}-taller-${w}x${h}.png` });
    await page.getByTestId("volver").click();

    // «Continuar» cuelga de la portada: pasar antes por «Evolución» llevaría a otra pantalla.
    await page.getByTestId("acceso-continuar").click();
    await expect
      .poll(async () => (await estado(page)).generacion ?? 0, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    const generacion = (await estado(page)).generacion;
    await page.evaluate(() =>
      window.__debug!.perderLienzo({ msRestaurar: 300 }),
    );
    await expect
      .poll(async () => (await estado(page)).lienzo, { timeout: 10_000 })
      .toBe("ok");
    await page.waitForTimeout(1000);
    expect((await estado(page)).generacion).toBe(generacion);
    expect((await muestra(page)).fraccionNegra).toBeLessThan(0.3);
    await page.screenshot({ path: `${DIR}/${ID}-evolucion-${w}x${h}.png` });
  });
}

test("lz-6 perderLienzo y muestraLienzo no escriben en lo guardado y sin ?pruebas=1 no existen", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await abrir(page, 360, 640, { vacio: true, pista: "rampa" });
  await verCocheDeSerie(page);
  const antes = await claves(page);
  await page.evaluate(() => window.__debug!.perderLienzo({ msRestaurar: 200 }));
  await expect
    .poll(async () => (await estado(page)).lienzo, { timeout: 10_000 })
    .toBe("ok");
  await muestra(page);
  expect(await claves(page)).toBe(antes);
  await page.goto("/");
  expect(
    await page.evaluate(
      () => typeof (window as unknown as { __debug?: unknown }).__debug,
    ),
  ).toBe("undefined");
});
