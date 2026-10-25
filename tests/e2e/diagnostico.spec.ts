import { test, expect, type Page } from "@playwright/test";
import { tamanoBase } from "./tamano";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "diagnostico-cuesta-12";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Caja = { x: number; y: number; w: number; h: number };
type Estado = {
  ultimoResultado: { reason: string; causaParada: string | null; pendienteParada: number | null } | null;
  marcador: { caja: Caja; tamEtiquetaPx: number; colorPlaca: string; colorTexto: string; altoCochePx: number; altoCunaPx: number } | null;
  cajaCoche: Caja | null;
  rankings: Record<string, { distance: number }[]>;
  guia: { abierta: boolean; seccion: string | null };
};
/** Caja del elemento o null si no está: una sola lectura en la página, porque boundingBox() de Playwright espera a que aparezca. */
const cajaSiExiste = (page: Page, testid: string) =>
  page.evaluate((id) => {
    const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }, testid);
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

async function abrirRampa(page: Page) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ genoma: "demo-motor-rampa", pista: "rampa" }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

async function probarYTerminar(page: Page, ritmo: "ritmo-final" | "ritmo-x1") {
  await page.getByTestId("acceso-taller").click();
  await page.getByTestId("probar").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  if (ritmo === "ritmo-final") {
    await page.getByTestId("ritmo-final").click();
  } else {
    await page.getByTestId("ritmo-x1").click();
    await page.evaluate(() => window.__debug!.adelantarSimulacion(600));
  }
  await expect(page.getByTestId("fin-causa")).toBeVisible({ timeout: 90000 });
  // La cámara sube el suelo con un suavizado: se espera a que la caja del marcador se quede quieta.
  let previa: number[] | null = null;
  await expect
    .poll(async () => {
      const m = (await estado(page)).marcador;
      const c = m?.caja;
      const ahora = c ? [c.x, c.y, c.w, c.h] : null;
      // Medio píxel: el suavizado de la cámara converge sin llegar nunca a igualar.
      const quieto = ahora !== null && previa !== null && ahora.every((v, i) => Math.abs(v - previa![i]) < 0.5);
      previa = ahora;
      return quieto;
    }, { timeout: 10000, intervals: [250] })
    .toBe(true);
}

function luminancia(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contraste = (a: string, b: string) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const cruzan = (a: Caja, b: Caja) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const dentro = (c: Caja, w: number, h: number) => c.x >= 0 && c.y >= 0 && c.x + c.w <= w && c.y + c.h <= h;

test("diag-1 el coche de serie se para en La Rampa, la tarjeta dice por qué y la guía devuelve a la misma tarjeta sin guardar otra vez", async ({ page }) => {
  // El coche de serie recorre ahora ~1,4 km antes de pararse: en un equipo lento la tarjeta tarda más de 30 s.
  test.setTimeout(120_000);
  const t = await tamanoBase(page);
  await abrirRampa(page);
  await probarYTerminar(page, "ritmo-final");
  const e = await estado(page);
  expect(e.ultimoResultado?.reason).toBe("stall");
  // Con La Rampa endurecida el coche de serie se atasca en un obstáculo antes de agotar el motor.
  expect(e.ultimoResultado?.causaParada).toBe("obstaculo");
  const texto = (await page.getByTestId("fin-causa").textContent()) ?? "";
  expect(texto).toContain("Se topó con un obstáculo que no pudo salvar");
  await page.screenshot({ path: `${DIR}/${ID}-tarjeta-${t.width}x${t.height}.png` });
  // Causa y récord a la vez: las acciones tienen que verse sin desplazar nada.
  for (const id of ["repetir", "volver-fin"]) {
    const c = (await page.getByTestId(id).boundingBox())!;
    expect(dentro({ x: c.x, y: c.y, w: c.width, h: c.height }, t.width, t.height)).toBe(true);
  }
  // El aviso de récord no se monta sobre «← Volver» de la cabecera.
  // Sin isVisible() antes: el aviso se va solo y entre las dos llamadas boundingBox() devolvería null.
  const av = await cajaSiExiste(page, "aviso-ranking");
  if (av) {
    const vo = (await page.getByTestId("volver").boundingBox())!;
    expect(cruzan(av, { x: vo.x, y: vo.y, w: vo.width, h: vo.height })).toBe(false);
  }
  const entradas = e.rankings.rampa.length;

  await page.getByTestId("fin-porque").click();
  await expect(page.getByTestId("guia")).toBeVisible();
  expect((await estado(page)).guia.seccion).toBe("por-que-se-para");
  await expect(page.getByTestId("guia-titulo")).toBeVisible();
  await page.screenshot({ path: `${DIR}/${ID}-guia-${t.width}x${t.height}.png` });

  await page.getByTestId("guia-volver").click();
  await expect(page.getByTestId("fin-causa")).toHaveText(texto);
  await expect(page.getByTestId("repetir")).toBeVisible();
  const despues = await estado(page);
  expect(despues.marcador).not.toBeNull();
  expect(dentro(despues.marcador!.caja, t.width, t.height)).toBe(true);
  expect(despues.rankings.rampa.length).toBe(entradas);
  await page.screenshot({ path: `${DIR}/${ID}-vuelta-${t.width}x${t.height}.png` });

  // Lo mismo con el «atrás» del navegador.
  await page.getByTestId("fin-porque").click();
  await expect(page.getByTestId("guia")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("fin-causa")).toHaveText(texto);
  expect((await estado(page)).rankings.rampa.length).toBe(entradas);
});

for (const ritmo of ["ritmo-final", "ritmo-x1"] as const) {
  for (const { w, h } of TAMANOS) {
    test(`diag-4 el marcador de la parada se ve y no se cruza con nada (${ritmo}, ${w}x${h})`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await abrirRampa(page);
      await probarYTerminar(page, ritmo);
      const m = (await estado(page)).marcador!;
      const coche = (await estado(page)).cajaCoche!;
      expect(m).not.toBeNull();
      expect(dentro(m.caja, w, h)).toBe(true);
      expect(m.tamEtiquetaPx).toBeGreaterThanOrEqual(14);
      expect(contraste(m.colorTexto, m.colorPlaca)).toBeGreaterThanOrEqual(4.5);
      expect(m.altoCunaPx).toBeGreaterThanOrEqual(m.altoCochePx);
      const tarjeta = (await page.getByTestId("tarjeta-fin").boundingBox())!;
      const t: Caja = { x: tarjeta.x, y: tarjeta.y, w: tarjeta.width, h: tarjeta.height };
      expect(cruzan(m.caja, t)).toBe(false);
      expect(cruzan(coche, t)).toBe(false);
      // El aviso de récord (la primera carrera de demo-motor-rampa lo es) no puede taparlos durante sus 2,5 s.
      for (let i = 0; i < 12; i++) {
        const a = await cajaSiExiste(page, "aviso-ranking");
        if (a) {
          const ahora = await estado(page);
          expect(cruzan(a, ahora.marcador!.caja)).toBe(false);
          expect(cruzan(a, ahora.cajaCoche!)).toBe(false);
        }
        await page.waitForTimeout(250);
      }
      await page.screenshot({ path: `${DIR}/${ID}-marcador-${ritmo === "ritmo-x1" ? "x1" : "final"}-${w}x${h}.png` });
    });
  }
}

test("diag-5 la causa queda guardada y el detalle del ranking la cuenta", async ({ page }) => {
  const t = await tamanoBase(page);
  await abrirRampa(page);
  await probarYTerminar(page, "ritmo-final");
  await expect.poll(async () => (await estado(page)).rankings.rampa.length).toBe(1);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("tarjeta-rampa").click();
  await page.getByTestId("fila-ranking").first().click();
  const hoja = page.getByTestId("hoja-causa");
  await expect(hoja).toBeVisible();
  await expect(hoja).toContainText("Se paró: Se topó con un obstáculo");
  await page.screenshot({ path: `${DIR}/${ID}-ranking-causa-${t.width}x${t.height}.png` });
});
