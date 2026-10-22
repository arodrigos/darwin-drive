import "./detmath";

/** Variación de velocidad (m/s) que aguanta un triángulo grueso de 70 kg/m² y 0,5 m²; se calibra con `npm run medir:fragilidad`. */
export const V_ROTURA = 6;
/** Con menos de esta fracción de la masa de origen montada, el coche está destrozado. */
export const FRACCION_DESTROZADO = 0.05;
/** Pasos que vive una pieza suelta antes de desaparecer. */
export const VIDA_PIEZA_PASOS = 600;
/** Metros por detrás del coche a los que una pieza suelta ya no importa. */
export const DISTANCIA_PIEZA = 20;
export const PIEZAS_MAX = 8;

const GRADOS = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface Punto {
  x: number;
  y: number;
}

/** Área de un triángulo (0, a, b). */
export function areaTriangulo(a: Punto, b: Punto): number {
  return Math.abs(a.x * b.y - a.y * b.x) / 2;
}

/** Ángulo interior más agudo del triángulo (0, a, b), en radianes. */
export function anguloMinimo(a: Punto, b: Punto): number {
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy);
  const enO = ang(a.x, a.y, b.x, b.y);
  const enA = ang(-a.x, -a.y, b.x - a.x, b.y - a.y);
  const enB = ang(-b.x, -b.y, a.x - b.x, a.y - b.y);
  return Math.min(enO, enA, enB);
}

/**
 * Impulso por kilo que rompe un triángulo: crece con la densidad, con el ángulo
 * más agudo (un pico fino cede antes) y con el área. Siempre > 0.
 */
export function umbralRotura(densidad: number, a: Punto, b: Punto): number {
  const grosor = clamp(anguloMinimo(a, b) / (30 * GRADOS), 0.35, 1);
  const tamano = clamp(Math.sqrt(areaTriangulo(a, b) / 0.5), 0.5, 1.5);
  return V_ROTURA * Math.sqrt(densidad / 70) * grosor * tamano;
}
