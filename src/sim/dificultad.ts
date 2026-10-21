// Curva de dificultad común a las cuatro clásicas: cóncava (sube rápido y se
// aplana), con un respiro cada 250 m para que el coche se recupere. Es función
// pura de la distancia desde la salida llana.

/** ≈ 50 % del techo a 120 m y 80 % a 450 m. */
const ESCALA = 140;
const EXPONENTE = 1.12;
export const PERIODO_RESPIRO = 250;
/** Largo de cada respiro: el pico se recupera antes de 50 m. */
export const LARGO_RESPIRO = 40;
const PROFUNDIDAD_RESPIRO = 0.4;

/** Fracción del techo en [0, 1] a `d` metros de la salida llana. */
export function curvaDificultad(d: number): number {
  if (!(d > 0)) return 0;
  const base = 1 - Math.pow(1 + d / ESCALA, -EXPONENTE);
  const k = Math.floor(d / PERIODO_RESPIRO);
  const m = d - k * PERIODO_RESPIRO;
  // El primer tramo no lleva respiro: la dificultad temprana es lo que se pide.
  if (k < 1 || m >= LARGO_RESPIRO) return base;
  const s = Math.sin((Math.PI * m) / LARGO_RESPIRO);
  return base * (1 - PROFUNDIDAD_RESPIRO * s * s);
}

/** Cierto si `d` cae dentro de un respiro (la curva puede bajar ahí). */
export function enRespiro(d: number): boolean {
  if (!(d > 0)) return false;
  const k = Math.floor(d / PERIODO_RESPIRO);
  return k >= 1 && d - k * PERIODO_RESPIRO < LARGO_RESPIRO;
}
