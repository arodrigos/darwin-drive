import { test, type Page } from "@playwright/test";

/**
 * Tamaño con el que arranca cada test de un solo tamaño: el del proyecto de Playwright (tableta-vertical,
 * tableta-horizontal) o el del móvil de referencia. Sin esto, los 360x640 escritos a mano en cada spec
 * anularían el viewport del proyecto y las tabletas no probarían nada.
 */
export const MOVIL = { width: 360, height: 640 };

export async function tamanoBase(page: Page): Promise<{ width: number; height: number }> {
  const v = test.info().project.use.viewport;
  const t = v ? { width: v.width, height: v.height } : MOVIL;
  await page.setViewportSize(t);
  return t;
}
