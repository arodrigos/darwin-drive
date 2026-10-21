import { test, type Page } from "@playwright/test";

const linea: string[] = [];
const t0 = () => Date.now();
async function paso<T>(nombre: string, f: () => Promise<T>, ms = 25_000): Promise<T | undefined> {
  const a = t0();
  try {
    const r = await Promise.race([f(), new Promise<never>((_, no) => setTimeout(() => no(new Error("TOPE")), ms))]);
    linea.push(`${nombre.slice(0,5)}:${t0() - a}`);
    return r;
  } catch (e) {
    linea.push(`${nombre}:FALLA ${String(e).slice(0, 25).replace(/\s+/g, " ")}@${t0() - a}`);
    return undefined;
  }
}
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Record<string, unknown>);

test("diag dif-3", async ({ page }) => {
  test.setTimeout(170_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await paso("goto", () => page.goto("/?pruebas=1"));
  await paso("dbg", () => page.waitForFunction(() => Boolean(window.__debug)));
  await paso("escenario", () => page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true, rankings: "demo-version-anterior" } as never)));
  await paso("goto2", () => page.goto("/?pruebas=1"));
  await paso("dbg2", () => page.waitForFunction(() => Boolean(window.__debug)));
  await page.waitForTimeout(6000);
  await paso("tarjeta", () => page.getByTestId("tarjeta-cordillera").click({ timeout: 15000 }), 20000);
  await paso("selector", () => page.getByTestId("selector-pista").click({ timeout: 15000 }), 20000);
  for (const [w, h] of [[360, 640], [820, 1180], [1180, 820]]) {
    await paso(`vp${w}`, () => page.setViewportSize({ width: w, height: h }));
    await paso(`shot${w}`, () => page.screenshot({ path: `test-results/diag-${w}.png` }), 30000);
  }
  throw new Error("TIMELINE " + linea.join(" | "));
});
