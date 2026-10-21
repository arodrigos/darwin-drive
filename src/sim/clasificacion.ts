import { ANOMALY_SPEED, DT, MAX_STEPS, META_DISTANCE, type CarResult } from "./constants";

/**
 * Lo que decide el puesto de un coche. Todas las partes del juego (ranking, garaje, especies, élite del
 * algoritmo genético, «Mejor») ordenan con compararMarcas: un único orden, sin empates posibles.
 */
export interface Marca {
  distance: number;
  /** Ausente en una marca de una versión anterior o con el valor inválido: va por detrás de las medidas. */
  bestStep?: number;
  piezasPerdidas?: number;
  descalificado?: boolean;
  /** Fecha ISO de entrada en la tabla; sin ella, la marca no desempata por antigüedad. */
  date?: string;
  genomeHash?: string;
}

export const MAX_PIEZAS = 8;

/** La distancia que ve el jugador, en décimas: dos marcas con la misma tienen «la misma distancia». */
export const decimas = (distance: number): number => Math.round(distance * 10);

const entero = (m: Marca): boolean => (m.piezasPerdidas ?? 0) === 0;
const paso = (m: Marca): number => (m.bestStep === undefined ? MAX_STEPS + 1 : m.bestStep);
const tiempoDe = (m: Marca): number => (m.date ? Date.parse(m.date) || 0 : 0);

export type ClaveDesempate = "distancia" | "entera" | "rapida" | "llegada" | "hash" | "igual";

/** Primera de las seis claves que separa a dos marcas, y de qué lado: negativo si `a` va delante. */
function decidir(a: Marca, b: Marca): { clave: ClaveDesempate; orden: number } {
  const da = a.descalificado ? 1 : 0;
  const db = b.descalificado ? 1 : 0;
  if (da !== db) return { clave: "distancia", orden: da - db };
  const dist = decimas(b.distance) - decimas(a.distance);
  if (dist !== 0) return { clave: "distancia", orden: dist };
  const ea = entero(a) ? 0 : 1;
  const eb = entero(b) ? 0 : 1;
  if (ea !== eb) return { clave: "entera", orden: ea - eb };
  const pa = paso(a) - paso(b);
  if (pa !== 0) return { clave: "rapida", orden: pa };
  const fa = tiempoDe(a) - tiempoDe(b);
  if (fa !== 0) return { clave: "llegada", orden: fa };
  const ha = a.genomeHash ?? "";
  const hb = b.genomeHash ?? "";
  if (ha !== hb) return { clave: "hash", orden: ha < hb ? -1 : 1 };
  return { clave: "igual", orden: 0 };
}

export function compararMarcas(a: Marca, b: Marca): number {
  return Math.sign(decidir(a, b).orden);
}

/** Qué clave puso a `a` por delante de `b` cuando la distancia visible es la misma; la insignia de la tabla. */
export function claveTexto(a: Marca, b: Marca): "entera" | "rapida" | "llegada" | null {
  if (a.descalificado || b.descalificado || decimas(a.distance) !== decimas(b.distance)) return null;
  const { clave } = decidir(a, b);
  return clave === "entera" ? "entera" : clave === "rapida" ? "rapida" : clave === "llegada" ? "llegada" : null;
}

export function marcaDeResultado(r: CarResult, extra: { date?: string; genomeHash?: string } = {}): Marca {
  return { distance: r.distance, bestStep: r.bestStep, piezasPerdidas: r.piezasPerdidas, descalificado: r.reason === "anomaly", ...extra };
}

/** Un resultado con sus campos dentro de lo que la física permite (copias manipuladas o de otra versión). */
export function marcaCreible(m: { distance: number; bestStep?: number; piezasPerdidas?: number }): boolean {
  if (!Number.isFinite(m.distance) || m.distance < 0 || m.distance > META_DISTANCE) return false;
  if (m.bestStep === undefined || !Number.isInteger(m.bestStep) || m.bestStep < 0 || m.bestStep > MAX_STEPS) return false;
  if (m.piezasPerdidas !== undefined && (!Number.isInteger(m.piezasPerdidas) || m.piezasPerdidas < 0 || m.piezasPerdidas > MAX_PIEZAS)) return false;
  // Ningún coche anómalo-libre llega más rápido que la velocidad que descalifica.
  return m.distance <= m.bestStep * ANOMALY_SPEED * DT + 1e-9;
}

/** «m:ss,d»: el tiempo hasta la marca, truncado a la décima (el reloj de la carrera no redondea hacia arriba). */
export function formatTiempo(bestStep: number): string {
  const decimasTotal = Math.floor((bestStep / 60) * 10 + 1e-9);
  const min = Math.floor(decimasTotal / 600);
  const seg = Math.floor((decimasTotal % 600) / 10);
  return `${min}:${String(seg).padStart(2, "0")},${decimasTotal % 10}`;
}
