import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "gt";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

const CASO_PEOR = { reason: "stall", causaParada: "motor", pendienteParada: 37, piezasPerdidas: 8, metroRotura: 120.5, recordPendiente: true, avisoMigracion: true } as const;

async function hastaTarjeta(page: Page) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ genoma: "demo-motor-rampa", pista: "rampa" }));
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("probar").click();
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
}

const dosFrames = (page: Page) => page.evaluate(() => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))));

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
            const out = (ks.result as string[]).map((k, i) => [k, vs.result[i]] as const).filter(([k]) => k.startsWith("dd:v1:")).sort(([a], [b]) => (a < b ? -1 : 1));
            db.close();
            resolve(JSON.stringify(out));
          };
        };
      }),
  );
}

const migracion = (page: Page) => page.evaluate(() => JSON.stringify(window.__debug!.estado().migracion));

test("gt-1 @tamanos el caso peor de la tarjeta se ve entero y sin cruzarse con el aviso", async ({ page }) => {
  // Tres tamaños con una carrera «hasta el final» cada uno: no caben en los 30 s por defecto.
  test.setTimeout(240_000);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await hastaTarjeta(page);
    expect(await page.evaluate(() => window.__debug!.estado().migracion.enCurso)).toBe(false);
    await page.evaluate((p) => window.__debug!.forzarTarjetaFin(p), CASO_PEOR);
    await dosFrames(page);
    await expect(page.getByTestId("fin-record-pendiente")).toContainText("Récord pendiente");
    await expect(page.getByTestId("aviso-migracion")).toContainText("Marcas actualizadas: 12 coches");
    await expect(page.getByTestId("fin-piezas")).toContainText("Perdió 8 piezas (la primera a los 120,5 m)");
    const tarjeta = (await page.getByTestId("tarjeta-fin").boundingBox())!;
    const aviso = (await page.getByTestId("aviso-migracion").boundingBox())!;
    expect(aviso.y + aviso.height).toBeLessThanOrEqual(tarjeta.y + 0.5);
    expect(tarjeta.y).toBeGreaterThanOrEqual(0);
    expect(tarjeta.y + tarjeta.height).toBeLessThanOrEqual(t.h);
    expect(tarjeta.x + tarjeta.width).toBeLessThanOrEqual(t.w);
    for (const id of ["repetir", "volver-fin", "fin-porque"]) {
      const c = (await page.getByTestId(id).boundingBox())!;
      expect(c.width, id).toBeGreaterThanOrEqual(44);
      expect(c.height, id).toBeGreaterThanOrEqual(44);
      expect(c.y + c.height, id).toBeLessThanOrEqual(t.h);
    }
    // Sin scroll interno: lo que el criterio pide ver tiene que verse, no quedar tras un desplazamiento.
    const cuerpo = await page.locator(".cuerpo-fin").evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(cuerpo.sh).toBeLessThanOrEqual(cuerpo.ch + 1);
    const rec = (await page.getByTestId("fin-record-pendiente").boundingBox())!;
    expect(rec.y + rec.height).toBeLessThanOrEqual(tarjeta.y + tarjeta.height);
    await page.screenshot({ path: `${DIR}/${ID}-caso-peor-${t.w}x${t.h}.png` });

    await page.evaluate(() => window.__debug!.forzarTarjetaFin({ recordPendiente: false, avisoMigracion: false }));
    await expect(page.getByTestId("fin-record-pendiente")).toHaveCount(0);
    await expect(page.getByTestId("aviso-migracion")).toHaveCount(0);
    await expect(page.getByTestId("fin-causa")).toBeVisible();
    await expect(page.getByTestId("fin-piezas")).toBeVisible();
    await expect(page.getByTestId("repetir")).toBeVisible();
  }
});

test("gt-1 el aviso con N=1 va en singular y 'destrozado' sigue funcionando", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await hastaTarjeta(page);
  await page.evaluate(() => window.__debug!.forzarTarjetaFin({ avisoMigracion: 1 }));
  await expect(page.getByTestId("aviso-migracion")).toContainText("1 coche vuelto a medir");
  await page.evaluate(() => window.__debug!.forzarTarjetaFin({ reason: "destrozado" }));
  await expect(page.getByTestId("fin-causa")).toContainText("Se rompió en pedazos");
});

test("gt-2 y gt-3 el ✕ quita el aviso, Repetir limpia todo y lo guardado no cambia", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await hastaTarjeta(page);
  const guardadoAntes = await claves(page);
  const migAntes = await migracion(page);
  await page.evaluate((p) => window.__debug!.forzarTarjetaFin(p), CASO_PEOR);
  await expect(page.getByTestId("aviso-migracion")).toBeVisible();
  expect(await migracion(page)).toBe(migAntes);
  await page.getByTestId("aviso-migracion-cerrar").click();
  await expect(page.getByTestId("aviso-migracion")).toHaveCount(0);
  await expect(page.getByTestId("repetir")).toBeVisible();
  await expect(page.getByTestId("volver-fin")).toBeVisible();
  await expect(page.getByTestId("fin-record-pendiente")).toBeVisible();
  await page.getByTestId("repetir").click();
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("fin-record-pendiente")).toHaveCount(0);
  await expect(page.getByTestId("aviso-migracion")).toHaveCount(0);
  expect(await migracion(page)).toBe(migAntes);
  expect(await claves(page)).toBe(guardadoAntes);
});

test("gt-2 Volver borra lo forzado", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await hastaTarjeta(page);
  await page.evaluate((p) => window.__debug!.forzarTarjetaFin(p), CASO_PEOR);
  await page.getByTestId("volver-fin").click();
  await expect(page.getByTestId("aviso-migracion")).toHaveCount(0);
});

test("gt-3 sin ?pruebas=1 no existe window.__debug", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(() => "__debug" in window)).toBe(false);
});

test("gt-4 @tamanos con reason stall y causa la pista rehace el marcador y el rótulo", async ({ page }) => {
  // Tres tamaños con una carrera «hasta el final» cada uno: no caben en los 30 s por defecto.
  test.setTimeout(240_000);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await hastaTarjeta(page);
    await page.evaluate(() => window.__debug!.forzarTarjetaFin({ reason: "stall", causaParada: "vuelco", pendienteParada: null }));
    await dosFrames(page);
    await expect.poll(() => page.evaluate(() => window.__debug!.estado().marcador !== null)).toBe(true);
    await page.screenshot({ path: `${DIR}/${ID}-marcador-${t.w}x${t.h}.png` });
    await page.evaluate(() => window.__debug!.forzarTarjetaFin({ reason: "timeout" }));
    await expect.poll(() => page.evaluate(() => window.__debug!.estado().marcador === null)).toBe(true);
  }
});
