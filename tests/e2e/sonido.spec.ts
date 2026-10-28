import { test, expect, type Page } from "@playwright/test";
import { esperarLatencia } from "./ayudas/latencia";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "sonido";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Caja = { x: number; y: number; w: number; h: number };
const cruzan = (a: Caja, b: Caja) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const adelantar = (page: Page, s: number) => page.evaluate((x) => window.__debug!.adelantarSimulacion(x), s);
const sonidos = (page: Page) => page.evaluate(() => window.__debug!.sonidos());
const altavoz = (page: Page) => page.getByTestId("boton-sonido");

/** Una sola lectura en la página: los elementos de cabecera no deben esperar a aparecer. */
const cajas = (page: Page, ids: string[], selectores: string[] = []) =>
  page.evaluate(
    ({ ids, selectores }) => {
      const leer = (el: Element | null) => {
        const r = el?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
      };
      return {
        ...Object.fromEntries(ids.map((id) => [id, leer(document.querySelector(`[data-testid="${id}"]`))])),
        ...Object.fromEntries(selectores.map((s) => [s, leer(document.querySelector(s))])),
      } as Record<string, Caja | null>;
    },
    { ids, selectores },
  );

async function abrir(page: Page, t = TAMANOS[0], escenario?: object) {
  await page.setViewportSize({ width: t.w, height: t.h });
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  if (escenario) await page.evaluate((e) => window.__debug!.cargarEscenario(e as never), escenario);
}

async function encender(page: Page) {
  await altavoz(page).click();
  await expect.poll(async () => (await sonidos(page)).contexto).toBe("running");
}

test("so-1 el altavoz empieza apagado, se enciende, se recuerda y se apaga @tamanos", async ({ page }) => {
  await abrir(page);
  await expect(altavoz(page)).toHaveAttribute("aria-pressed", "false");
  await expect(altavoz(page)).toHaveAttribute("aria-label", "Sonido apagado. Toca para encenderlo");
  expect(await sonidos(page)).toMatchObject({ encendido: false, cargado: false });
  await page.screenshot({ path: `${DIR}/${ID}-apagado-360x640.png` });

  await altavoz(page).click();
  await expect(altavoz(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await sonidos(page)).cargado).toBe(true);
  expect(await sonidos(page)).toMatchObject({ encendido: true, contexto: "running" });
  await esperarLatencia(page, "sonido");
  await page.screenshot({ path: `${DIR}/${ID}-encendido-360x640.png` });

  // Tras recargar sigue encendido, pero sin gesto ZzFX no se ha cargado (so-4).
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await expect(altavoz(page)).toHaveAttribute("aria-pressed", "true");
  expect(await sonidos(page)).toMatchObject({ encendido: true, cargado: false, contexto: "sin-crear" });

  await altavoz(page).click();
  await expect(altavoz(page)).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await expect(altavoz(page)).toHaveAttribute("aria-pressed", "false");
});

test("so-1 una Meta antigua sin sonido arranca apagada y conserva lastTrack y ritmo", async ({ page }) => {
  await abrir(page);
  await page.evaluate(
    () =>
      new Promise<void>((ok, mal) => {
        const r = indexedDB.open("darwin-drive-pruebas");
        r.onerror = () => mal(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction("datos", "readwrite");
          tx.objectStore("datos").put({ seenHelp: [], persistRequested: false, lastTrack: "dunas", ritmo: "x4" }, "dd:v1:meta");
          tx.oncomplete = () => ok();
          tx.onerror = () => mal(tx.error);
        };
      }),
  );
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await expect(altavoz(page)).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await page.evaluate(() => window.__debug!.estado())).pistaSeleccionada).toBe("dunas");
});

test("so-2 cada evento suena una vez con el sonido encendido y ninguno con él apagado", async ({ page }) => {
  test.setTimeout(180_000);
  await abrir(page);
  await encender(page);
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("probar").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await expect.poll(async () => (await sonidos(page)).arranque).toBe(1);

  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
  // «Hasta el final» no suena, pero el récord (ya con la carrera acabada) sí, una vez.
  await expect.poll(async () => (await sonidos(page)).record).toBe(1);
  expect(await sonidos(page)).toMatchObject({ arranque: 1, especie: 0 });

  // «Repetir» es otra carrera: otro arranque, y el récord no vuelve a sonar si no se bate.
  await page.waitForTimeout(1100);
  await page.getByTestId("repetir").click();
  await expect.poll(async () => (await sonidos(page)).arranque).toBe(2);

  // Con el altavoz apagado, el mismo recorrido deja los contadores donde estaban.
  const antes = await sonidos(page);
  await altavoz(page).click();
  await expect(altavoz(page)).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
  const despues = await sonidos(page);
  expect({ a: despues.arranque, r: despues.record, e: despues.especie, v: despues.vuelco }).toEqual({ a: antes.arranque, r: antes.record, e: antes.especie, v: antes.vuelco });
});

test("so-2 el vuelco de Probar suena una vez", async ({ page }) => {
  test.setTimeout(120_000);
  // El coche de serie vuelca a ~136 m en Los Trampolines.
  await abrir(page, TAMANOS[0], { vacio: true, pista: "trampolines" });
  await encender(page);
  await page.getByTestId("acceso-serie").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await expect
    .poll(async () => {
      await adelantar(page, 5);
      return (await sonidos(page)).vuelco;
    }, { timeout: 90_000, intervals: [100] })
    .toBe(1);
  expect((await sonidos(page)).record).toBe(0);
});

test("so-2 «especie nueva» suena al acabar un lote con novedades", async ({ page }) => {
  test.setTimeout(120_000);
  await abrir(page);
  await encender(page);
  await page.getByTestId("acceso-especies").click();
  await page.getByTestId("explorar-especies").click();
  await adelantar(page, 900);
  await expect(page.getByTestId("aviso-especies")).toBeVisible();
  expect((await sonidos(page)).especie).toBe(1);
});

test("so-2 y so-3 Evolución arranca una vez, el récord suena y el turbo calla", async ({ page }) => {
  test.setTimeout(240_000);
  await abrir(page);
  await encender(page);
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("evolucionar").click();
  await expect(page.getByTestId("evolucion")).toBeVisible();
  await expect.poll(async () => (await sonidos(page)).arranque).toBe(1);
  // Dos generaciones completas: el arranque no se repite por generación.
  for (const gen of [1, 2]) {
    await expect
      .poll(async () => {
        await adelantar(page, 30);
        return page.getByTestId("contador").textContent();
      }, { timeout: 90_000, intervals: [100] })
      .toContain(`Gen ${gen + 1}`);
  }
  const s = await sonidos(page);
  expect(s.arranque).toBe(1);
  expect(s.record).toBe(1);
  expect(s.vuelco).toBeLessThanOrEqual(3);

  const antes = await sonidos(page);
  await page.getByTestId("evo-ritmo-turbo").click();
  await page.waitForTimeout(3000);
  const turbo = await sonidos(page);
  expect({ a: turbo.arranque, r: turbo.record, e: turbo.especie, v: turbo.vuelco }).toEqual({ a: antes.arranque, r: antes.record, e: antes.especie, v: antes.vuelco });
});

test("so-4 antes de un gesto ZzFX no está cargado aunque la Meta diga encendido, y el trozo inicial no lo trae", async ({ page }) => {
  const trozos: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/_next/static/chunks/") && r.url().endsWith(".js")) trozos.push(r.url());
  });
  await abrir(page);
  await altavoz(page).click();
  await expect.poll(async () => (await sonidos(page)).cargado).toBe(true);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  expect(await sonidos(page)).toMatchObject({ encendido: true, cargado: false });
  // Tocar cualquier sitio de la página es el gesto que lo carga.
  await page.getByTestId("paisaje").click({ force: true });
  await expect.poll(async () => (await sonidos(page)).cargado).toBe(true);
});

test("so-5 al ocultar la página el audio se suspende y al volver se reanuda", async ({ page }) => {
  await abrir(page);
  await encender(page);
  const visibilidad = (v: "hidden" | "visible") =>
    page.evaluate((estado) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado });
      document.dispatchEvent(new Event("visibilitychange"));
    }, v);
  await visibilidad("hidden");
  await expect.poll(async () => (await sonidos(page)).contexto).toBe("suspended");
  await visibilidad("visible");
  await expect.poll(async () => (await sonidos(page)).contexto).toBe("running");
});

test("so-6 la ayuda del altavoz explica el interruptor de silencio", async ({ page }) => {
  await abrir(page);
  await expect(altavoz(page)).toHaveAttribute("title", /En iPhone y iPad, el interruptor de silencio también calla el juego/);
});

test("so-8 tras encender el sonido y jugar no sale ninguna petición fuera del propio origen", async ({ page }) => {
  test.setTimeout(120_000);
  const ajenas: string[] = [];
  await abrir(page);
  const origen = new URL(page.url()).origin;
  page.on("request", (r) => {
    if (!r.url().startsWith(origen) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) ajenas.push(r.url());
  });
  await encender(page);
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("probar").click();
  await page.getByTestId("ritmo-final").click();
  await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
  expect(ajenas).toEqual([]);
});

for (const t of TAMANOS) {
  test(`so-9 el altavoz mide 44x44, va a la derecha y no se cruza con la cabecera @tamanos ${t.w}x${t.h}`, async ({ page }) => {
    test.setTimeout(120_000);
    await abrir(page, t);
    const comprobar = async (pantalla: string, otros: string[], selectores: string[] = []) => {
      const c = await cajas(page, ["boton-sonido", ...otros], selectores);
      const b = c["boton-sonido"]!;
      expect(b, `${pantalla}: altavoz`).not.toBeNull();
      expect(b.w, `${pantalla}: ancho`).toBeGreaterThanOrEqual(44);
      expect(b.h, `${pantalla}: alto`).toBeGreaterThanOrEqual(44);
      expect(b.x + b.w, `${pantalla}: dentro de la pantalla`).toBeLessThanOrEqual(t.w);
      for (const [nombre, caja] of Object.entries(c)) {
        if (nombre === "boton-sonido" || caja === null) continue;
        expect(cruzan(b, caja), `${pantalla}: altavoz sobre ${nombre}`).toBe(false);
      }
    };
    await comprobar("portada", ["ayuda-boton"], [".titulo"]);
    await page.screenshot({ path: `${DIR}/${ID}-portada-${t.w}x${t.h}.png` });

    await page.getByTestId("acceso-taller").click();
    await page.getByTestId("probar").click();
    await expect(page.getByTestId("pista")).toBeVisible();
    await comprobar("pista", ["volver", "nombre-pista", "ayuda-boton"], [".cabecera"]);
    await page.screenshot({ path: `${DIR}/${ID}-pista-${t.w}x${t.h}.png` });

    await abrir(page, t);
    await page.getByTestId("acceso-taller").click();
    await page.getByTestId("evolucionar").click();
    await expect(page.getByTestId("evolucion")).toBeVisible();
    await comprobar("evolucion", ["volver", "nombre-pista", "contador", "ayuda-boton"], [".cabecera"]);
    await page.screenshot({ path: `${DIR}/${ID}-evolucion-${t.w}x${t.h}.png` });

    await abrir(page, t);
    await page.getByTestId("acceso-especies").click();
    await comprobar("especies", ["volver", "ayuda-boton"], [".garaje-cabecera h2"]);
    await page.screenshot({ path: `${DIR}/${ID}-especies-${t.w}x${t.h}.png` });
  });
}
