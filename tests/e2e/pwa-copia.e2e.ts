import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "pwa-copia-28";
const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

const INVALIDA = "Este fichero no es una copia de Darwin Drive o es de una versión que no entiendo. No se ha cambiado nada.";
const NO_PERSISTENTE =
  "Safari puede borrar el guardado si pasas 7 días sin jugar. Añade el juego a la pantalla de inicio o exporta una copia.";

type Estado = { rankings: Record<string, { distance: number }[]>; garaje: number; generacion: number | null };
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

async function abrir(page: Page) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
}

async function leerClaves(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const req = indexedDB.open("keyval-store");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const store = req.result.transaction("keyval", "readonly").objectStore("keyval");
          const claves = store.getAllKeys();
          const valores = store.getAll();
          valores.onsuccess = () => {
            const out: Record<string, unknown> = {};
            (claves.result as string[]).forEach((k, i) => {
              if (k.startsWith("dd:v1:")) out[k] = valores.result[i];
            });
            resolve(out);
          };
          valores.onerror = () => reject(valores.error);
        };
      }),
  );
}

async function irAlGaraje(page: Page) {
  await page.getByTestId("acceso-garaje").click();
  await expect(page.getByTestId("garaje")).toBeVisible();
}

async function importar(page: Page, nombre: string, contenido: Buffer | string) {
  await page.getByTestId("copia-fichero").setInputFiles({ name: nombre, mimeType: "application/json", buffer: Buffer.from(contenido) });
}

async function capturas(page: Page, nombre: string) {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${DIR}/${ID}-${nombre}-${t.w}x${t.h}.png` });
  }
  await page.setViewportSize({ width: TAMANOS[0].w, height: TAMANOS[0].h });
}


async function cargarEstadoCompleto(page: Page) {
  await page.evaluate(async () => {
    await window.__debug!.cargarEscenario({ vacio: true });
    await window.__debug!.cargarEscenario({ rankings: "demo", evolucion: { generacion: 4, trackId: "dunas" }, linaje: "demo-5-generaciones" });
  });
  // Tres coches en el garaje: los del escenario de rankings, como genomas.
  const genomas = await page.evaluate(async () => {
    const r = (await leerRankings()) as { genome: unknown }[];
    return r.slice(0, 3).map((e) => e.genome);
    async function leerRankings() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("keyval-store");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const g = req.result.transaction("keyval", "readonly").objectStore("keyval").get("dd:v1:rankings");
          g.onsuccess = () => resolve(Object.values(g.result as Record<string, unknown[]>).flat());
          g.onerror = () => reject(g.error);
        };
      });
    }
  });
  await page.evaluate((g) => window.__debug!.cargarEscenario({ garaje: g }), genomas);
}

test("pw-1 copia de punta a punta: exportar, vaciar, importar y recuperar todo", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await cargarEstadoCompleto(page);
  const antes = { estado: await estado(page), claves: await leerClaves(page) };
  expect(antes.estado.garaje).toBe(3);
  expect((antes.claves["dd:v1:evolution"] as { generation: number }).generation).toBe(4);
  expect(Object.keys(antes.claves)).toEqual(expect.arrayContaining(["dd:v1:rankings", "dd:v1:garage", "dd:v1:lineage"]));

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await irAlGaraje(page);
  const [descarga] = await Promise.all([page.waitForEvent("download"), page.getByTestId("copia-exportar").click()]);
  expect(descarga.suggestedFilename()).toMatch(/^darwin-drive-copia-\d{4}-\d{2}-\d{2}\.json$/);
  const ruta = await descarga.path();
  const texto = fs.readFileSync(ruta, "utf8");
  expect(JSON.parse(texto).format).toBe("darwin-drive-copia");
  await expect(page.getByTestId("copia-ok")).toContainText("Copia exportada");

  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  expect((await estado(page)).garaje).toBe(0);
  await irAlGaraje(page);

  await importar(page, descarga.suggestedFilename(), texto);
  await expect(page.getByTestId("copia-confirmacion")).toContainText("Se reemplazará todo");
  await expect(page.getByTestId("copia-confirmacion")).toContainText("3 coches");
  await capturas(page, "confirmar");
  await page.getByTestId("copia-reemplazar").click();
  await expect(page.getByTestId("copia-ok")).toContainText("Copia importada");

  const despues = { estado: await estado(page), claves: await leerClaves(page) };
  expect(despues.estado).toEqual(antes.estado);
  expect(despues.claves).toEqual(antes.claves);
  await capturas(page, "importada");
});

test("pw-2 un fichero que no es una copia no cambia nada y se explica", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await cargarEstadoCompleto(page);
  await irAlGaraje(page);
  const antes = { estado: await estado(page), claves: await leerClaves(page) };
  const [descarga] = await Promise.all([page.waitForEvent("download"), page.getByTestId("copia-exportar").click()]);
  const valida = JSON.parse(fs.readFileSync(await descarga.path(), "utf8")) as { data: Record<string, unknown> };

  const corrupto = JSON.parse(JSON.stringify(valida));
  corrupto.data["dd:v1:garage"][0].genome.bodyDensity = 99999;
  const pistaFalsa = JSON.parse(JSON.stringify(valida));
  pistaFalsa.data["dd:v1:rankings"].marte = pistaFalsa.data["dd:v1:rankings"].rampa;

  const casos: [string, Buffer | string][] = [
    ["otro-formato.json", JSON.stringify({ ...valida, format: "otra-cosa" })],
    ["pesado.json", Buffer.alloc(6 * 1024 * 1024, 32)],
    ["genoma-corrupto.json", JSON.stringify(corrupto)],
    ["pista-inexistente.json", JSON.stringify(pistaFalsa)],
  ];
  let i = 0;
  for (const [nombre, contenido] of casos) {
    await importar(page, nombre, contenido);
    const error = page.getByTestId("copia-error");
    await expect(error).toHaveText(INVALIDA);
    await expect(page.getByTestId("copia-confirmacion")).toHaveCount(0);
    expect(await estado(page)).toEqual(antes.estado);
    expect(await leerClaves(page)).toEqual(antes.claves);
    if (i++ === 0) await capturas(page, "fichero-invalido");
  }
});

test("pw-3 el Garaje dice si el guardado es duradero y cómo mejorarlo", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  for (const persistido of [true, false]) {
    await page.addInitScript((p) => {
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: { persisted: async () => p, persist: async () => p },
      });
    }, persistido);
    await abrir(page);
    await irAlGaraje(page);
    const estadoTexto = page.getByTestId("estado-guardado");
    if (persistido) {
      await expect(estadoTexto).toHaveText("Guardado persistente en este dispositivo");
      await expect(page.getByTestId("pasos-pantalla-inicio")).toHaveCount(0);
    } else {
      await expect(estadoTexto).toHaveText(NO_PERSISTENTE);
      await expect(page.getByTestId("pasos-pantalla-inicio")).toContainText("Añadir a pantalla de inicio");
    }
    await capturas(page, persistido ? "guardado-persistente" : "guardado-no-persistente");
    // Cada vuelta suma un initScript; solo vale el último, y recargar la página lo aplica de nuevo.
  }
});

test("pw-3 tras el primer guardado se pide navigator.storage.persist()", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __persistPedido: number };
    w.__persistPedido = 0;
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persisted: async () => false, persist: async () => { w.__persistPedido += 1; return true; } },
    });
  });
  await abrir(page);
  await page.evaluate(() => window.__debug!.cargarEscenario({ rankings: "demo" }));
  expect(await page.evaluate(() => (window as unknown as { __persistPedido: number }).__persistPedido)).toBeGreaterThanOrEqual(1);
});
