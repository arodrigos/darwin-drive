import { VERTEX_COUNT, type Genome } from "@/sim/genome";

/** Contorno del coche en carrera: más oscuro que el 0x1b1b1b de antes para llegar a 3:1 con el suelo de La Cordillera. */
export const CONTORNO_COCHE = 0x0c0c0c;

/** Cuatro escalones: con menos de 0,4 el contorno deja de leerse sobre el cielo. */
export const NIVELES_OPACIDAD = [0.4, 0.6, 0.8, 1] as const;

// Umbrales sobre bodyDensity (kg/m², rango 20..200): 64 aún es ligero, 65 ya no.
const UMBRALES_DENSIDAD = [65, 110, 155] as const;

/** Opacidad estática de la carrocería según su peso. */
export function opacidadBase(bodyDensity: number): number {
  const d = Number.isFinite(bodyDensity) ? bodyDensity : 0;
  const i = UMBRALES_DENSIDAD.findIndex((u) => d < u);
  return NIVELES_OPACIDAD[i < 0 ? NIVELES_OPACIDAD.length - 1 : i];
}

/**
 * Carga [0, 1] del triángulo i (el que une el centro con los vértices i e i+1):
 * suma la de las ruedas montadas en cualquiera de esos dos vértices.
 * `cargas` va en el orden de las ruedas activas, como en CarPose.
 */
export function cargaTriangulo(i: number, cargas: readonly number[] | undefined, genome: Genome): number {
  if (!cargas) return 0;
  const a = i % VERTEX_COUNT;
  const b = (i + 1) % VERTEX_COUNT;
  let total = 0;
  let k = 0;
  for (const w of genome.wheels) {
    if (w.vertex < 0) continue;
    const c = cargas[k++];
    if ((w.vertex === a || w.vertex === b) && Number.isFinite(c)) total += c;
  }
  return Math.min(1, Math.max(0, total));
}

/** Sube la opacidad base hacia 1 en proporción a la carga: nunca baja de la base. */
export function opacidadTriangulo(base: number, carga: number): number {
  const c = Number.isFinite(carga) ? Math.min(1, Math.max(0, carga)) : 0;
  return Math.min(1, base + (1 - base) * c);
}

/** Opacidad de los 8 triángulos; sin cargas es la base en todos. */
export function opacidadesCoche(genome: Genome, cargas?: readonly number[]): number[] {
  const base = opacidadBase(genome.bodyDensity);
  return Array.from({ length: VERTEX_COUNT }, (_, i) => opacidadTriangulo(base, cargaTriangulo(i, cargas, genome)));
}
