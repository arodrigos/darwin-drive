import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "compartir-garaje-16";
test.setTimeout(120_000);

async function abrirGaraje(page: Page, escenario: Record<string, unknown>) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.getByTestId("acceso-garaje").click();
  await expect(page.getByTestId("garaje")).toBeVisible();
}

const hashes = (page: Page) => page.evaluate(() => (window.__debug!.estado() as unknown as { garaje: number }).garaje);

async function compartirSegundo(page: Page): Promise<string> {
  await page.getByTestId("garaje-compartir").nth(1).click();
  await expect(page.getByTestId("aviso-garaje")).toHaveText("Código copiado. Pégalo en «Importar coche» en el otro dispositivo");
  const codigo = await page.evaluate(() => window.__debug!.ultimoCompartido());
  expect(codigo).toMatch(/^DD1\.[A-Za-z0-9_-]+$/);
  return codigo!;
}

async function contexto(browser: import("@playwright/test").Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 360, height: 640 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:3000" }).catch(() => {});
  return ctx;
}

test("comp-1: «Compartir» copia el código DD1 y avisa; la latencia 'compartir' no pasa de 200 ms", async ({ browser }) => {
  const ctx = await contexto(browser);
  const page = await ctx.newPage();
  await abrirGaraje(page, { garaje: 3 });
  const codigo = await compartirSegundo(page);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(codigo);
  await page.screenshot({ path: `${DIR}/${ID}-aviso-compartir-360x640.png` });
  const l = await page.evaluate(() => window.__debug!.latencias().filter((x) => x.evento === "compartir"));
  expect(l.length).toBeGreaterThan(0);
  expect(l[l.length - 1].trabajoMs).toBeLessThanOrEqual(200);
  // Al menos 3 s a la vista.
  await page.waitForTimeout(2800);
  await expect(page.getByTestId("aviso-garaje")).toBeVisible();
  await ctx.close();
});

test("comp-1 límite: sin portapapeles se abre la hoja con el código seleccionable", async ({ browser }) => {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 360, height: 640 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
  await abrirGaraje(page, { garaje: 2 });
  await page.getByTestId("garaje-compartir").first().click();
  await expect(page.getByTestId("hoja-copia-manual")).toContainText("Copia este código");
  await expect(page.getByTestId("codigo-manual")).toHaveValue(/^DD1\./);
  await page.screenshot({ path: `${DIR}/${ID}-copia-manual-360x640.png` });
  await ctx.close();
});

test("comp-2: importar en otro contexto añade un coche y no toca nada más; el mismo código no se duplica", async ({ browser }) => {
  const a = await contexto(browser);
  const pa = await a.newPage();
  await abrirGaraje(pa, { garaje: 3 });
  const codigo = await compartirSegundo(pa);
  const nombreA = (await pa.getByTestId("garaje-nombre").nth(1).textContent())!;
  await a.close();

  const b = await contexto(browser);
  const pb = await b.newPage();
  await abrirGaraje(pb, { garaje: 1, rankings: {} });
  // Todo el contenido de IndexedDB salvo el garaje, antes y después.
  const otrasClaves = () =>
    pb.evaluate(async () => {
      const abrir = indexedDB.open("darwin-drive-pruebas");
      const db: IDBDatabase = await new Promise((ok, ko) => ((abrir.onsuccess = () => ok(abrir.result)), (abrir.onerror = () => ko(abrir.error))));
      const store = db.transaction("datos").objectStore("datos");
      const claves: IDBValidKey[] = await new Promise((ok) => ((store.getAllKeys().onsuccess = function () { ok(this.result as IDBValidKey[]); })));
      const salida: Record<string, string> = {};
      for (const k of claves) {
        if (String(k) === "dd:v1:garage") continue;
        salida[String(k)] = await new Promise((ok) => ((store.get(k).onsuccess = function () { ok(JSON.stringify(this.result)); })));
      }
      db.close();
      return salida;
    });
  const antes = await otrasClaves();
  expect(await hashes(pb)).toBe(1);

  await pb.getByTestId("garaje-importar").click();
  await expect(pb.getByTestId("importar-ayuda")).toHaveText("Pega un código que empiece por DD1.");
  await pb.getByTestId("importar-codigo").fill(`  ${codigo}\n`);
  await pb.getByTestId("importar-aceptar").click();
  await expect(pb.getByTestId("hoja-importar")).toBeHidden();
  await expect(pb.getByTestId("tarjeta-coche")).toHaveCount(2);
  await expect(pb.getByTestId("aviso-garaje")).toHaveText(/^Coche importado: .+/);
  expect(await hashes(pb)).toBe(2);
  await expect(pb.getByTestId("tarjeta-coche").nth(1)).toContainText(nombreA.trim());
  expect(await otrasClaves()).toEqual(antes);
  await pb.screenshot({ path: `${DIR}/${ID}-importado-360x640.png` });
  const l = await pb.evaluate(() => window.__debug!.latencias().filter((x) => x.evento === "importar"));
  expect(l[l.length - 1].trabajoMs).toBeLessThanOrEqual(200);

  // El garaje identifica cada diseño por su hash: el mismo código otra vez no duplica nada y lo dice.
  await pb.getByTestId("garaje-importar").click();
  await pb.getByTestId("importar-codigo").fill(codigo);
  await pb.getByTestId("importar-aceptar").click();
  await expect(pb.getByTestId("importar-error")).toContainText("Ya tienes este coche en el garaje");
  expect(await hashes(pb)).toBe(2);
  await pb.keyboard.press("Escape");

  // Desde el coche importado se puede probar.
  await pb.getByTestId("garaje-probar").nth(1).click();
  await expect.poll(() => pb.evaluate(() => (window.__debug!.estado() as unknown as { pantalla: string }).pantalla)).toBe("pista");
  await b.close();
});

test("comp-3: cada código malo da su mensaje, el garaje no cambia y el garaje vacío ofrece importar", async ({ browser }) => {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 360, height: 640 } });
  const page = await ctx.newPage();
  await abrirGaraje(page, { vacio: true });
  await page.screenshot({ path: `${DIR}/${ID}-garaje-vacio-360x640.png` });
  await page.getByTestId("garaje-importar").click();
  const casos: [string, string][] = [
    ["hola", "Este código no es de Darwin Drive o está incompleto. Cópialo otra vez entero."],
    ["DD2.abc", "Este código es de una versión más nueva del juego. Actualiza la app y vuelve a probar."],
    ["DD1.abcdefgh", "Este código no es de Darwin Drive o está incompleto. Cópialo otra vez entero."],
    [`DD1.${"A".repeat(5000)}`, "El código es demasiado largo para ser un coche."],
  ];
  for (const [texto, mensaje] of casos) {
    await page.getByTestId("importar-codigo").fill(texto);
    await page.getByTestId("importar-aceptar").click();
    await expect(page.getByTestId("importar-error")).toHaveText(mensaje);
    if (texto === "DD2.abc") await page.screenshot({ path: `${DIR}/${ID}-error-version-360x640.png` });
  }
  expect(await hashes(page)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hoja-importar")).toBeHidden();
  await ctx.close();
});

test("comp-4: con hoja nativa se llama a share con el texto; AbortError no avisa; NotAllowedError copia", async ({ browser }) => {
  for (const modo of ["ok", "AbortError", "NotAllowedError"]) {
    const ctx = await contexto(browser);
    const page = await ctx.newPage();
    await page.addInitScript((m) => {
      const w = window as unknown as { __share: unknown[] };
      w.__share = [];
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: (d: unknown) => {
          w.__share.push(d);
          return m === "ok" ? Promise.resolve() : Promise.reject(new DOMException("x", m));
        },
      });
    }, modo);
    await abrirGaraje(page, { garaje: 2 });
    await page.getByTestId("garaje-compartir").first().click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __share: unknown[] }).__share.length)).toBe(1);
    const enviado = await page.evaluate(() => (window as unknown as { __share: { text: string }[] }).__share[0].text);
    expect(enviado).toMatch(/^DD1\./);
    if (modo === "AbortError") {
      await page.waitForTimeout(500);
      await expect(page.getByTestId("aviso-garaje")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("aviso-garaje")).toContainText(modo === "ok" ? "Código compartido" : "Código copiado");
    }
    await ctx.close();
  }
});

for (const t of [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
]) {
  test(`comp-1/comp-3 capturas del aviso, la hoja de importar y el garaje vacío @tamanos ${t.w}x${t.h}`, async ({ browser }) => {
    const ctx = await contexto(browser);
    const page = await ctx.newPage();
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrirGaraje(page, { garaje: 3 });
    await compartirSegundo(page);
    await page.screenshot({ path: `${DIR}/${ID}-aviso-${t.w}x${t.h}.png` });
    await page.getByTestId("garaje-importar").click();
    await page.getByTestId("importar-codigo").fill("DD2.abc");
    await page.getByTestId("importar-aceptar").click();
    await expect(page.getByTestId("importar-error")).toBeVisible();
    // Sin desbordes horizontales con la hoja abierta.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${DIR}/${ID}-importar-error-${t.w}x${t.h}.png` });
    await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__debug));
    await page.getByTestId("acceso-garaje").click();
    await expect(page.getByTestId("garaje-importar")).toBeVisible();
    await page.screenshot({ path: `${DIR}/${ID}-garaje-vacio-${t.w}x${t.h}.png` });
    await ctx.close();
  });
}
