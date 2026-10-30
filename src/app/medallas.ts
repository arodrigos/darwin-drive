import { META_DISTANCE, type CarResult } from "../sim/constants";
import { DT } from "../sim/race";
import type { TrackId } from "../sim/tracks";

export type Medalla = "bronce" | "plata" | "oro" | "autor";

/** Metros (más es mejor) o segundos simulados hasta la meta (menos es mejor). */
export interface Umbrales {
  tipo: "distancia" | "tiempo";
  bronce: number;
  plata: number;
  oro: number;
  autor: number;
}

const ORDEN: readonly Medalla[] = ["bronce", "plata", "oro", "autor"];

/**
 * Calibrados con `npm run medir:pistas -- --medallas` (tests/fixtures/medallas-calibracion.json): bronce justo por
 * encima del percentil 90 de 200 genomas aleatorios, autor en la marca del campeón de referencia, y plata y oro
 * escalonados geométricamente entre ambos. Subir la versión de una pista exige recalibrar y añadir su fila aquí
 * (lo comprueba tests/unit/medallas.test.ts); una versión sin fila no da medalla.
 * El Acantilado cuenta en tiempo, como La Recta: más del 10 % de los aleatorios ya hace los 5 km.
 */
export const UMBRALES: Record<TrackId, Record<number, Umbrales>> = {
  cordillera: { 5: { tipo: "distancia", bronce: 1180, plata: 1851, oro: 2902, autor: 4552 } },
  rampa: { 4: { tipo: "distancia", bronce: 670, plata: 1094, oro: 1786, autor: 2916 } },
  dunas: { 4: { tipo: "distancia", bronce: 240, plata: 271, oro: 307, autor: 347 } },
  pedregal: { 4: { tipo: "distancia", bronce: 470, plata: 991, oro: 2091, autor: 4411 } },
  glaciar: { 2: { tipo: "distancia", bronce: 2240, plata: 2821, oro: 3552, autor: 4472 } },
  trampolines: { 2: { tipo: "distancia", bronce: 520, plata: 969, oro: 1808, autor: 3370 } },
  escalera: { 2: { tipo: "distancia", bronce: 1650, plata: 2388, oro: 3455, autor: 5000 } },
  acantilado: { 2: { tipo: "tiempo", bronce: 315, plata: 270, oro: 231, autor: 198 } },
  recta: { 1: { tipo: "tiempo", bronce: 226, plata: 208, oro: 192, autor: 177 } },
  mosaico: { 2: { tipo: "distancia", bronce: 560, plata: 1155, oro: 2383, autor: 4916 } },
};

type Marca = Pick<CarResult, "distance" | "bestStep" | "reason">;

/** Valor de la marca en la unidad de la pista, o null si no cuenta (en tiempo, sin llegar a la meta). */
function valorDe(u: Umbrales, r: Marca): number | null {
  if (u.tipo === "distancia") return r.distance;
  return r.reason === "meta" ? r.bestStep * DT : null;
}

const alcanza = (u: Umbrales, v: number, m: Medalla) => (u.tipo === "distancia" ? v >= u[m] : v <= u[m]);

function umbralesDe(trackId: TrackId, versionPista: number): Umbrales | null {
  return UMBRALES[trackId]?.[versionPista] ?? null;
}

export function medallaDe(trackId: TrackId, versionPista: number, r: Marca): Medalla | null {
  const u = umbralesDe(trackId, versionPista);
  const v = u && valorDe(u, r);
  if (!u || v === null) return null;
  let ganada: Medalla | null = null;
  for (const m of ORDEN) if (alcanza(u, v, m)) ganada = m;
  return ganada;
}

/**
 * Siguiente medalla y lo que falta para ella. En una pista de tiempo, una marca que no llegó a la meta no tiene
 * tiempo del que restar: da null, igual que medallaDe.
 */
export function siguiente(trackId: TrackId, versionPista: number, r: Marca): { medalla: Medalla; falta: number; unidad: "m" | "s" } | null {
  const u = umbralesDe(trackId, versionPista);
  const v = u && valorDe(u, r);
  if (!u || v === null) return null;
  const actual = medallaDe(trackId, versionPista, r);
  const medalla = ORDEN[actual === null ? 0 : ORDEN.indexOf(actual) + 1];
  if (!medalla) return null;
  return u.tipo === "distancia" ? { medalla, falta: u[medalla] - v, unidad: "m" } : { medalla, falta: v - u[medalla], unidad: "s" };
}

/** Pistas con alguna medalla sobre el total de pistas que se le pasan. */
export function recuento(mejores: Record<TrackId, Medalla | null>): { ganadas: number; total: number } {
  const valores = Object.values(mejores);
  return { ganadas: valores.filter((m) => m !== null).length, total: valores.length };
}


export const NOMBRE_MEDALLA: Record<Medalla, string> = { bronce: "Bronce", plata: "Plata", oro: "Oro", autor: "Autor" };

const rango = (m: Medalla | null) => (m === null ? 0 : ORDEN.indexOf(m) + 1);

/** Mejor medalla entre las marcas de una pista. Una marca sin bestStep (pendiente de medir) no cuenta en pistas de tiempo. */
export function mejorMedalla(
  trackId: TrackId,
  marcas: readonly { distance: number; bestStep?: number; trackVersion: number }[],
): Medalla | null {
  let mejor: Medalla | null = null;
  for (const e of marcas) {
    // El ranking no guarda el motivo de parada: llegar a la meta es lo que da el tiempo en La Recta y el Acantilado.
    const m = medallaDe(trackId, e.trackVersion, { distance: e.distance, bestStep: e.bestStep ?? 0, reason: e.distance >= META_DISTANCE && e.bestStep !== undefined ? "meta" : "stall" });
    if (rango(m) > rango(mejor)) mejor = m;
  }
  return mejor;
}

/** Cuenta cada medalla con las inferiores (oro = 3), de ahí «X de 40». */
export function totalMedallas(mejores: Record<TrackId, Medalla | null>): { ganadas: number; total: number } {
  const valores = Object.values(mejores);
  return { ganadas: valores.reduce((s, m) => s + rango(m), 0), total: valores.length * ORDEN.length };
}

export const esMayor = (a: Medalla | null, b: Medalla | null) => rango(a) > rango(b);
