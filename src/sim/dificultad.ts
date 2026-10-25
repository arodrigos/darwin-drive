// Curva de dificultad común a las pistas endurecidas: sigue subiendo hasta la meta (5 km) en diente de
// sierra, con un respiro cada 250 m y otro más largo después de cada kilómetro para que el coche se
// recupere. Es función pura de la distancia desde la salida llana.
import "./detmath";

/** Rampa temprana de siempre: ≈ 50 % a 120 m y ≈ 90 % a 1 km. */
const ESCALA = 140;
const EXPONENTE = 1.12;
const EXPONENTE_LARGO = 1.6;
const PESO_RAMPA = 0.45;
const PESO_LARGO = 0.55;
/** Distancia en la que la curva vale exactamente 1: la meta. */
export const DISTANCIA_TOPE = 5000;
export const PERIODO_RESPIRO = 250;
/** Largo de cada respiro corto: el pico se recupera antes de 50 m. */
export const LARGO_RESPIRO = 40;
const PROFUNDIDAD_RESPIRO = 0.4;
/** Respiro largo tras cada kilómetro: más hondo y de 100 m, para que cada tramo de 1 km se sienta como un nivel. */
export const PERIODO_KM = 1000;
export const LARGO_RESPIRO_KM = 100;
const PROFUNDIDAD_RESPIRO_KM = 0.5;

// exp/log de detmath y no Math.pow: pow no es idéntico entre Node y el navegador y la marca saldría distinta.
function rampa(d: number): number {
  return 1 - Math.exp(-EXPONENTE * Math.log(1 + d / ESCALA));
}
const NORMA = PESO_RAMPA * rampa(DISTANCIA_TOPE) + PESO_LARGO;

/** Fracción del techo en [0, 1] a `d` metros de la salida llana. */
export function curvaDificultad(d: number): number {
  if (!(d > 0)) return 0;
  // Sin respiro en la meta: ahí vale 1 exactamente.
  if (d >= DISTANCIA_TOPE) return 1;
  const largo = Math.exp(EXPONENTE_LARGO * Math.log(d / DISTANCIA_TOPE));
  const base = Math.min(1, (PESO_RAMPA * rampa(d) + PESO_LARGO * largo) / NORMA);
  const km = d - Math.floor(d / PERIODO_KM) * PERIODO_KM;
  if (d >= PERIODO_KM && km < LARGO_RESPIRO_KM) {
    const s = Math.sin((Math.PI * km) / LARGO_RESPIRO_KM);
    return base * (1 - PROFUNDIDAD_RESPIRO_KM * s * s);
  }
  const m = d - Math.floor(d / PERIODO_RESPIRO) * PERIODO_RESPIRO;
  // El primer tramo no lleva respiro: la dificultad temprana es lo que se pide.
  if (d < PERIODO_RESPIRO || m >= LARGO_RESPIRO) return base;
  const s = Math.sin((Math.PI * m) / LARGO_RESPIRO);
  return base * (1 - PROFUNDIDAD_RESPIRO * s * s);
}

/** Cierto si `d` cae dentro de un respiro (la curva puede bajar ahí). */
export function enRespiro(d: number): boolean {
  if (!(d > 0) || d >= DISTANCIA_TOPE) return false;
  if (d >= PERIODO_KM && d - Math.floor(d / PERIODO_KM) * PERIODO_KM < LARGO_RESPIRO_KM) return true;
  return d >= PERIODO_RESPIRO && d - Math.floor(d / PERIODO_RESPIRO) * PERIODO_RESPIRO < LARGO_RESPIRO;
}

/** Las nueve pistas que se complican hasta los 5 km; La Recta sigue siendo la contrarreloj. */
export const PISTAS_ENDURECIDAS = ["cordillera", "rampa", "dunas", "pedregal", "glaciar", "trampolines", "escalera", "acantilado", "mosaico"] as const;
