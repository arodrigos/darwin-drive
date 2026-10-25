import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "ic";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];
const CAUSAS = ["vuelco", "sin-apoyo", "panza", "obstaculo"] as const;

interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}
const cruzan = (a: Caja, b: Caja) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const distancia = (a: Caja, b: Caja) => Math.hypot(Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)));

async function hastaTarjeta(page: Page, escenario: object, preparar: () => Promise<void>) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e as never), escenario);
  await preparar();
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
}

// Lee el estado en cada frame hasta que se ven a la vez el marcador y el rótulo (viven 1,5 s tras forzar la tarjeta).
function verAmbos(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ marcador: Caja; etiqueta: Caja; coche: Caja } | null>((resolve) => {
        const limite = performance.now() + 1200;
        const paso = () => {
          const e = window.__debug!.estado();
          if (e.marcador && e.etiquetaFin && e.cajaCoche) return resolve({ marcador: e.marcador.caja, etiqueta: e.etiquetaFin, coche: e.cajaCoche });
          if (performance.now() > limite) return resolve(null);
          requestAnimationFrame(paso);
        };
        paso();
      }),
  );
}

function comprobar(v: { marcador: Caja; etiqueta: Caja; coche: Caja } | null, t: { w: number; h: number }) {
  expect(v, "marcador, rótulo y coche a la vez").not.toBeNull();
  const { marcador, etiqueta, coche } = v!;
  expect(cruzan(marcador, etiqueta), "icono sobre el rótulo").toBe(false);
  expect(cruzan(marcador, coche), "icono sobre el coche").toBe(false);
  expect(marcador.x).toBeGreaterThanOrEqual(0);
  expect(marcador.y).toBeGreaterThanOrEqual(0);
  expect(marcador.x + marcador.w).toBeLessThanOrEqual(t.w);
  expect(marcador.y + marcador.h).toBeLessThanOrEqual(t.h);
  expect(distancia(marcador, coche)).toBeLessThanOrEqual(coche.h * 1.5);
}

test("ic-1 @tamanos el icono de causa no tapa el rótulo «fin · N m»", async ({ page }) => {
  test.setTimeout(420_000);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await hastaTarjeta(page, { vacio: true, pista: "dunas" }, async () => {
      await page.getByTestId("acceso-serie").click();
    });
    for (const causa of CAUSAS) {
      await page.evaluate((c) => window.__debug!.forzarTarjetaFin({ reason: "stall", causaParada: c, pendienteParada: null }), causa);
      const v = await verAmbos(page);
      comprobar(v, t);
      await page.screenshot({ path: `${DIR}/${ID}-${causa}-${t.w}x${t.h}.png` });
      await page.waitForTimeout(1600);
    }
  }
});

test("ic-2 @tamanos las placas de la cuña (motor) no tapan el rótulo «fin · N m»", async ({ page }) => {
  test.setTimeout(300_000);
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await hastaTarjeta(page, { genoma: "demo-motor-rampa", pista: "rampa" }, async () => {
      await page.getByTestId("acceso-taller").click();
      await page.getByTestId("probar").click();
    });
    await page.evaluate(() => window.__debug!.forzarTarjetaFin({ reason: "stall", causaParada: "motor", pendienteParada: 37 }));
    const v = await verAmbos(page);
    expect(v, "marcador y rótulo a la vez").not.toBeNull();
    expect(cruzan(v!.marcador, v!.etiqueta), "cuña sobre el rótulo").toBe(false);
    await page.screenshot({ path: `${DIR}/${ID}-motor-${t.w}x${t.h}.png` });
  }
});
