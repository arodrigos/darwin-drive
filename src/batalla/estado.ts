import { esColorCoche, type ColorCoche } from "@/game/colores-coche";
import { MAX_PIEZAS, compararMarcas, decimas, type Marca } from "@/sim/clasificacion";
import { MAX_STEPS } from "@/sim/constants";
import { normalizeGenome, type Genome } from "@/sim/genome";
import { TRACKS, type TrackId } from "@/sim/tracks";
import { limpiarNombre } from "@/storage/nombres";

/** Clave aparte y fuera del registro de la copia de seguridad: los nombres de los jugadores no salen del dispositivo. */
export const KEY_BATALLA = "dd:v1:batalla";

export const MIN_JUGADORES = 2;
export const MAX_JUGADORES = 4;

export type FaseBatalla = "configurar" | "relevo" | "turno" | "elegir-pista" | "carrera" | "resultado";
export type CriterioBatalla = "distancia" | "entero" | "tiempo" | "empate";

export interface JugadorBatalla {
  nombre: string;
  color: ColorCoche;
  coche: { genome: Genome; nombre: string } | null;
}

export interface ResultadoBatalla {
  jugador: number;
  distance: number;
  bestStep: number;
  piezasPerdidas: number;
  reason: string;
  posicion: number;
  criterio: CriterioBatalla;
}

/** Lo que trae la carrera de cada jugador, antes de ordenarlo. */
export type ResultadoCrudo = Omit<ResultadoBatalla, "posicion" | "criterio">;

export interface EstadoBatalla {
  v: 1;
  id: string;
  fase: FaseBatalla;
  jugadores: JugadorBatalla[];
  /** Jugador al que le toca en relevo y turno; 0 en el resto de fases. */
  activo: number;
  pista: TrackId | null;
  resultados: ResultadoBatalla[] | null;
  creada: string;
}

export type AccionBatalla =
  | { tipo: "configurar"; jugadores: { nombre: string; color: ColorCoche }[] }
  | { tipo: "empezar" }
  | { tipo: "comenzar-turno" }
  | { tipo: "terminar-coche"; genome: Genome; nombre: string }
  | { tipo: "elegir-pista"; pista: TrackId }
  | { tipo: "correr" }
  | { tipo: "terminar-carrera"; resultados: ResultadoCrudo[] }
  | { tipo: "revancha" }
  | { tipo: "otra-pista" };

const NOMBRE_JUGADOR_MAX = 40;

function jugadoresValidos(js: { nombre: string; color: ColorCoche }[]): boolean {
  if (js.length < MIN_JUGADORES || js.length > MAX_JUGADORES) return false;
  return new Set(js.map((j) => j.color)).size === js.length;
}

export function crearBatalla(
  jugadores: { nombre: string; color: ColorCoche }[],
  id: string,
  creada: string,
): EstadoBatalla {
  if (!jugadoresValidos(jugadores)) throw new Error("La batalla pide de 2 a 4 jugadores con colores distintos");
  return {
    v: 1,
    id,
    fase: "configurar",
    jugadores: jugadores.map((j, i) => ({
      nombre: limpiarNombre(j.nombre).slice(0, NOMBRE_JUGADOR_MAX) || `Jugador ${i + 1}`,
      color: j.color,
      coche: null,
    })),
    activo: 0,
    pista: null,
    resultados: null,
    creada,
  };
}

function fuera(e: EstadoBatalla, a: AccionBatalla): never {
  throw new Error(`La acción «${a.tipo}» no vale en la fase «${e.fase}»`);
}

/** Pura: devuelve un estado nuevo y, si la acción no vale, lanza sin tocar el de entrada. */
export function transicion(e: EstadoBatalla, a: AccionBatalla): EstadoBatalla {
  switch (a.tipo) {
    case "configurar": {
      if (e.fase !== "configurar") return fuera(e, a);
      return crearBatalla(a.jugadores, e.id, e.creada);
    }
    case "empezar":
      if (e.fase !== "configurar") return fuera(e, a);
      return { ...e, fase: "relevo", activo: 0 };
    case "comenzar-turno":
      if (e.fase !== "relevo") return fuera(e, a);
      return { ...e, fase: "turno" };
    case "terminar-coche": {
      if (e.fase !== "turno") return fuera(e, a);
      const genome = normalizeGenome(a.genome);
      const nombre = limpiarNombre(a.nombre) || `Coche de ${e.jugadores[e.activo].nombre}`;
      const jugadores = e.jugadores.map((j, i) => (i === e.activo ? { ...j, coche: { genome, nombre } } : j));
      const ultimo = e.activo === e.jugadores.length - 1;
      return ultimo ? { ...e, jugadores, fase: "elegir-pista", activo: 0 } : { ...e, jugadores, fase: "relevo", activo: e.activo + 1 };
    }
    case "elegir-pista":
      if (e.fase !== "elegir-pista" || !TRACKS.some((t) => t.id === a.pista)) return fuera(e, a);
      return { ...e, pista: a.pista };
    case "correr":
      if (e.fase !== "elegir-pista" || e.pista === null) return fuera(e, a);
      return { ...e, fase: "carrera" };
    case "terminar-carrera": {
      if (e.fase !== "carrera") return fuera(e, a);
      const jugadoresOk = a.resultados.length === e.jugadores.length && new Set(a.resultados.map((r) => r.jugador)).size === e.jugadores.length;
      if (!jugadoresOk || a.resultados.some((r) => !Number.isInteger(r.jugador) || r.jugador < 0 || r.jugador >= e.jugadores.length)) {
        throw new Error("La carrera tiene que traer un resultado por jugador");
      }
      return { ...e, fase: "resultado", resultados: ordenarBatalla(a.resultados) };
    }
    case "revancha":
      if (e.fase !== "resultado") return fuera(e, a);
      return { ...e, fase: "carrera", resultados: null };
    case "otra-pista":
      if (e.fase !== "resultado") return fuera(e, a);
      return { ...e, fase: "elegir-pista", pista: null, resultados: null };
  }
}

const marcaDe = (r: ResultadoCrudo): Marca => ({
  distance: r.distance,
  bestStep: r.bestStep,
  piezasPerdidas: r.piezasPerdidas,
  descalificado: r.reason === "anomaly",
});

/**
 * Orden de la batalla: distancia visible (décimas), coche entero, tiempo. Ni la fecha ni el hash ni el
 * orden de diseño desempatan: dos coches idénticos empatan y comparten posición (1, 1, 3...).
 */
export function ordenarBatalla(rs: ResultadoCrudo[]): ResultadoBatalla[] {
  // Las marcas no llevan fecha ni hash, así que compararMarcas devuelve 0 exactamente cuando hay empate.
  const orden = rs.map((r, i) => ({ r, i, m: marcaDe(r) })).sort((a, b) => compararMarcas(a.m, b.m) || a.i - b.i);
  const posiciones: number[] = [];
  orden.forEach((x, k) => posiciones.push(k > 0 && compararMarcas(orden[k - 1].m, x.m) === 0 ? posiciones[k - 1] : k + 1));
  return orden.map((x, k) => {
    const prev = k > 0 ? orden[k - 1] : null;
    const sig = k < orden.length - 1 ? orden[k + 1] : null;
    const empata = (prev !== null && compararMarcas(prev.m, x.m) === 0) || (sig !== null && compararMarcas(x.m, sig.m) === 0);
    // La clave decisiva es la que separa a este coche del siguiente (o del anterior, en el último puesto).
    const criterio: CriterioBatalla = empata ? "empate" : sig ? claveDecisiva(x.m, sig.m) : prev ? claveDecisiva(prev.m, x.m) : "distancia";
    return { ...x.r, posicion: posiciones[k], criterio };
  });
}

function claveDecisiva(a: Marca, b: Marca): CriterioBatalla {
  if (decimas(a.distance) !== decimas(b.distance) || !!a.descalificado !== !!b.descalificado) return "distancia";
  if ((a.piezasPerdidas ?? 0) === 0 !== ((b.piezasPerdidas ?? 0) === 0)) return "entero";
  return "tiempo";
}

// --- Validación: de todo o nada, nunca lanza.

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const FASES: readonly FaseBatalla[] = ["configurar", "relevo", "turno", "elegir-pista", "carrera", "resultado"];
const CRITERIOS: readonly CriterioBatalla[] = ["distancia", "entero", "tiempo", "empate"];

function genomaGuardado(raw: unknown): Genome | null {
  if (!esObj(raw)) return null;
  const g = normalizeGenome(raw);
  // Un genoma que la normalización cambia no se escribió con este juego: se rechaza en vez de corregirlo.
  return JSON.stringify(g) === JSON.stringify(raw) ? g : null;
}

function jugadorGuardado(raw: unknown): JugadorBatalla | null {
  if (!esObj(raw) || typeof raw.nombre !== "string" || !esColorCoche(raw.color)) return null;
  if (limpiarNombre(raw.nombre).slice(0, NOMBRE_JUGADOR_MAX) !== raw.nombre || raw.nombre === "") return null;
  let coche: JugadorBatalla["coche"] = null;
  if (raw.coche !== null) {
    if (!esObj(raw.coche) || typeof raw.coche.nombre !== "string" || limpiarNombre(raw.coche.nombre) !== raw.coche.nombre || raw.coche.nombre === "") return null;
    const genome = genomaGuardado(raw.coche.genome);
    if (!genome) return null;
    coche = { genome, nombre: raw.coche.nombre };
  }
  return { nombre: raw.nombre, color: raw.color, coche };
}

function resultadoGuardado(raw: unknown, n: number): ResultadoBatalla | null {
  if (!esObj(raw)) return null;
  const { jugador, distance, bestStep, piezasPerdidas, reason, posicion, criterio } = raw;
  if (typeof jugador !== "number" || !Number.isInteger(jugador) || jugador < 0 || jugador >= n) return null;
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) return null;
  if (typeof bestStep !== "number" || !Number.isInteger(bestStep) || bestStep < 0 || bestStep > MAX_STEPS) return null;
  if (typeof piezasPerdidas !== "number" || !Number.isInteger(piezasPerdidas) || piezasPerdidas < 0 || piezasPerdidas > MAX_PIEZAS) return null;
  if (typeof reason !== "string" || typeof posicion !== "number" || !Number.isInteger(posicion) || posicion < 1 || posicion > n) return null;
  if (!CRITERIOS.includes(criterio as CriterioBatalla)) return null;
  return { jugador, distance, bestStep, piezasPerdidas, reason, posicion, criterio: criterio as CriterioBatalla };
}

/** Devuelve el estado si es coherente de punta a punta y null si no (versión futura, fase imposible, coche donde no toca...). */
export function validarBatalla(raw: unknown): EstadoBatalla | null {
  try {
    if (!esObj(raw) || raw.v !== 1 || typeof raw.id !== "string" || typeof raw.creada !== "string") return null;
    if (!FASES.includes(raw.fase as FaseBatalla)) return null;
    const fase = raw.fase as FaseBatalla;
    if (!Array.isArray(raw.jugadores)) return null;
    const jugadores: JugadorBatalla[] = [];
    for (const j of raw.jugadores) {
      const v = jugadorGuardado(j);
      if (!v) return null;
      jugadores.push(v);
    }
    if (!jugadoresValidos(jugadores)) return null;
    const n = jugadores.length;
    if (typeof raw.activo !== "number" || !Number.isInteger(raw.activo) || raw.activo < 0 || raw.activo >= n) return null;
    const activo = raw.activo;

    // Qué jugadores tienen coche en cada fase: ninguno al configurar, los anteriores al activo mientras se diseña, todos después.
    const conCoche = jugadores.map((j) => j.coche !== null);
    const esperado =
      fase === "configurar" ? conCoche.map(() => false) : fase === "relevo" || fase === "turno" ? conCoche.map((_, i) => i < activo) : conCoche.map(() => true);
    if (conCoche.some((c, i) => c !== esperado[i])) return null;
    if ((fase === "configurar" || fase === "elegir-pista" || fase === "carrera" || fase === "resultado") && activo !== 0) return null;

    let pista: TrackId | null = null;
    if (raw.pista !== null) {
      const t = TRACKS.find((x) => x.id === raw.pista);
      if (!t) return null;
      pista = t.id;
    }
    if ((fase === "carrera" || fase === "resultado") && pista === null) return null;
    if (fase !== "elegir-pista" && fase !== "carrera" && fase !== "resultado" && pista !== null) return null;

    let resultados: ResultadoBatalla[] | null = null;
    if (fase === "resultado") {
      if (!Array.isArray(raw.resultados) || raw.resultados.length !== n) return null;
      resultados = [];
      for (const r of raw.resultados) {
        const v = resultadoGuardado(r, n);
        if (!v) return null;
        resultados.push(v);
      }
      if (new Set(resultados.map((r) => r.jugador)).size !== n) return null;
    } else if (raw.resultados !== null) return null;

    return { v: 1, id: raw.id, fase, jugadores, activo, pista, resultados, creada: raw.creada };
  } catch {
    return null;
  }
}
