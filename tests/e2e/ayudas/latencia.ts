import { expect, type Page } from "@playwright/test";

export interface MedidaLatencia {
  evento: string;
  ms: number;
  trabajoMs: number;
  t: number;
}

/**
 * Espera a que exista una medida del evento y comprueba sus varas.
 * trabajoMs (fin del JS del efecto) se juzga en todos los proyectos; ms (hasta el siguiente
 * fotograma) solo en el proyecto movil, porque en las tabletas del CI el dibujo es por software.
 */
export async function esperarLatencia(
  page: Page,
  evento: string,
  op: { maxTrabajo?: number; maxPintado?: number | null } = {},
): Promise<MedidaLatencia> {
  const maxTrabajo = op.maxTrabajo ?? 200;
  const maxPintado = op.maxPintado === undefined ? (page.viewportSize()?.width === 360 ? 200 : null) : op.maxPintado;
  const leer = () =>
    page.evaluate((e) => window.__debug!.latencias().filter((l) => l.evento === e).at(-1) ?? null, evento);
  await expect.poll(async () => (await leer()) !== null, { message: `medida ${evento}` }).toBe(true);
  const medida = (await leer())!;
  expect(medida.trabajoMs, `${evento}: trabajoMs`).toBeLessThanOrEqual(maxTrabajo);
  if (maxPintado !== null) expect(medida.ms, `${evento}: ms`).toBeLessThanOrEqual(maxPintado);
  return medida;
}
