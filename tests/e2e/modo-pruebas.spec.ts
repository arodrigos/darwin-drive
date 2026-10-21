import { test, expect, type Page } from "@playwright/test";

// Se ejecuta contra la build de producción (npm run build && npm start): el modo de pruebas
// no puede depender de que se esté en desarrollo.

async function leerBase(page: Page, base: string, almacen: string): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    ([b, a]) =>
      new Promise<Record<string, unknown> | null>((resolve, reject) => {
        const req = indexedDB.open(b);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(a)) {
            db.close();
            resolve(null);
            return;
          }
          const st = db.transaction(a, "readonly").objectStore(a);
          const claves = st.getAllKeys();
          const valores = st.getAll();
          valores.onsuccess = () => {
            const out: Record<string, unknown> = {};
            (claves.result as string[]).forEach((k, i) => (out[k] = valores.result[i]));
            db.close();
            resolve(out);
          };
        };
      }),
    [base, almacen],
  );
}

test("rit-12 el modo de pruebas usa su base y no toca el garaje del jugador", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("guardar").click();
  await expect.poll(async () => Object.keys((await leerBase(page, "keyval-store", "keyval")) ?? {}).includes("dd:v1:garage")).toBe(true);
  expect(await page.evaluate(() => typeof (window as unknown as { __debug?: unknown }).__debug)).toBe("undefined");
  const garajeAntes = JSON.stringify(((await leerBase(page, "keyval-store", "keyval")) ?? {})["dd:v1:garage"]);

  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true, rankings: "demo" }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("guardar").click();
  await page.getByTestId("probar").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  const pruebas = await leerBase(page, "darwin-drive-pruebas", "datos");
  expect(pruebas && Object.keys(pruebas).length).toBeGreaterThan(0);
  expect(pruebas).toHaveProperty(["dd:v1:rankings"]);

  await page.goto("/");
  expect(await page.evaluate(() => typeof (window as unknown as { __debug?: unknown }).__debug)).toBe("undefined");
  const garajeDespues = JSON.stringify(((await leerBase(page, "keyval-store", "keyval")) ?? {})["dd:v1:garage"]);
  expect(garajeDespues).toBe(garajeAntes);
  // Recargar con el parámetro sigue en la base de pruebas.
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  expect(await leerBase(page, "darwin-drive-pruebas", "datos")).toHaveProperty(["dd:v1:garage"]);
});
