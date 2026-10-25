import { esColorCoche, type ColorCoche } from "@/game/colores-coche";
import { del, get, set, update, type UseStore } from "idb-keyval";
import { abrirBase } from "./base";
import { genomeHash, normalizeGenome, type Genome } from "@/sim/genome";
import { PHYSICS_VERSION, type CarResult } from "@/sim/constants";
import { getTrack, TRACKS, type TrackId } from "@/sim/tracks";
import { nombrePropuesto } from "@/app/nombres";
import { conservarVersiones, mejorMarca } from "./marcas";
import { compararMarcas, marcaCreible } from "@/sim/clasificacion";
import { limpiarNombre, normalizarNombre } from "./nombres";
import { DEFAULT_META, META_KEY, validateMeta } from "./meta";
import {
  emptyRankings,
  GARAGE_SIZE,
  KEY_EVOLUTION,
  KEY_GARAGE,
  KEY_LINEAGE,
  KEY_RANKINGS,
  KEY_SPECIES,
  entradaPendiente,
  normalizeRanking,
  RANKING_SIZE,
  validateEvolution,
  validateGarage,
  validateLineage,
  validateRankings,
  validateSpecies,
  type DetalleMarca,
  type Origin,
  type RankingEntry,
  type Rankings,
  type SavedCar,
  type Warn,
} from "./schema";

export { RANKING_SIZE, GARAGE_SIZE };

interface Registro {
  validate: (raw: unknown, warn: Warn) => unknown;
  fallback: unknown;
  label: string;
}

const registro = new Map<string, Registro>();

/**
 * `validate` devuelve null si el valor no sirve (se descarta la clave entera y
 * se usa `fallback`); puede avisar con `warn` de entradas sueltas descartadas.
 */
export function registerKey<T>(
  key: string,
  validate: (raw: unknown, warn: Warn) => T | null,
  fallback: T,
  label = key,
): void {
  registro.set(key, { validate, fallback, label });
}

registerKey(KEY_RANKINGS, validateRankings, emptyRankings(), "ranking");
registerKey(KEY_GARAGE, validateGarage, [] as SavedCar[], "garaje");
registerKey(KEY_EVOLUTION, (raw) => validateEvolution(raw), null, "evolución");
registerKey(KEY_LINEAGE, validateLineage, [], "linaje");
registerKey(KEY_SPECIES, validateSpecies, {}, "especies");
registerKey(META_KEY, (raw) => validateMeta(raw), DEFAULT_META, "ajustes");

// --- Acceso: IndexedDB o, si no se puede abrir, memoria hasta cerrar la pestaña.

let almacen: UseStore | null = null;
let disponible = true;
const memoria = new Map<string, unknown>();

function abrir(): UseStore | null {
  if (!disponible) return null;
  if (!almacen) {
    try {
      almacen = abrirBase();
    } catch {
      disponible = false;
    }
  }
  return almacen;
}

async function leer(key: string): Promise<unknown> {
  const s = abrir();
  if (s) {
    try {
      return await get(key, s);
    } catch {
      disponible = false;
    }
  }
  return memoria.get(key);
}

/** El actualizador es síncrono: lee y escribe en una sola transacción, así dos escrituras no se pisan. */
async function actualizar(key: string, fn: (actual: unknown) => unknown): Promise<void> {
  const s = abrir();
  if (s) {
    try {
      await update(key, (v) => fn(v), s);
      void pedirPersistencia();
      return;
    } catch {
      disponible = false;
    }
  }
  memoria.set(key, fn(memoria.get(key)));
}

/**
 * Pide al navegador que no desaloje el guardado. Se llama tras escribir y solo
 * llega a pedirlo una vez por pestaña: Safari decide por su cuenta y volver a
 * preguntar en cada guardado no cambia su respuesta.
 */
let persistenciaPedida = false;
async function pedirPersistencia(): Promise<void> {
  if (persistenciaPedida) return;
  persistenciaPedida = true;
  try {
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
    if (!storage || typeof storage.persist !== "function") return;
    if (typeof storage.persisted === "function" && (await storage.persisted())) return;
    await storage.persist();
  } catch {
    // Denegarlo no impide nada: el Garaje explica el remedio.
  }
}

/** Para tests: olvida la conexión y la memoria, como una pestaña recién abierta. */
export function resetStoreConnection(): void {
  persistenciaPedida = false;
  almacen = null;
  disponible = true;
  memoria.clear();
}

function leerValidado(key: string, raw: unknown, warnings: string[]): unknown {
  const r = registro.get(key);
  if (!r) return raw;
  if (raw === undefined) return r.fallback;
  let value: unknown = null;
  try {
    value = r.validate(raw, (m) => warnings.push(m));
  } catch {
    value = null;
  }
  if (value === null) {
    warnings.push(`Lo guardado en ${r.label} no era válido y se ha descartado.`);
    return r.fallback;
  }
  return value;
}

/** Claves registradas con su validador, para la copia en fichero. */
export function clavesRegistradas(): { key: string; label: string; admiteNulo: boolean }[] {
  return [...registro].map(([key, r]) => ({ key, label: r.label, admiteNulo: r.fallback === null }));
}

/**
 * Valida un valor de copia con el validador de su clave, sin perdonar nada:
 * al cargar el juego una entrada suelta inválida se descarta con aviso, pero
 * una copia con una sola entrada mala se rechaza entera (no se cambia nada).
 */
export function validarEstricto(key: string, raw: unknown): { ok: true; value: unknown } | { ok: false } {
  const r = registro.get(key);
  if (!r) return { ok: false };
  if (raw === null) return r.fallback === null ? { ok: true, value: null } : { ok: false };
  let avisos = 0;
  let value: unknown = null;
  try {
    value = r.validate(raw, () => (avisos += 1));
  } catch {
    return { ok: false };
  }
  return value === null || avisos > 0 ? { ok: false } : { ok: true, value };
}

/**
 * Cuenta las sustituciones masivas de lo guardado (importar una copia, cargar un escenario). Una medida de la
 * migración que empezó en una época anterior no se escribe: lo que midió ya no es lo que hay guardado.
 */
let epocaDatos = 0;
export const epocaActual = (): number => epocaDatos;

/** Sustituye todas las claves registradas por las de la copia (ya validada); las que no vengan se borran. */
export async function reemplazarTodo(data: Record<string, unknown>): Promise<void> {
  epocaDatos += 1;
  for (const key of registro.keys()) await save(key, data[key] ?? null);
}

/** Para la migración y los escenarios: marca que lo guardado cambió por debajo de cualquier medida en vuelo. */
export function nuevaEpoca(): void {
  epocaDatos += 1;
}

/** Lectura y escritura atómica de una clave tal cual (sin validar): para la migración, que valida por elemento. */
export const leerClave = leer;
export const actualizarClave = actualizar;

/**
 * Lo guardado tal cual está, validado y solo de las claves que existen: la copia no inventa claves que el
 * dispositivo no tenía (loadAll las rellena con su valor de fábrica y reimportarlas cambiaría el almacén).
 */
export async function leerGuardado(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of registro.keys()) {
    const raw = await leer(key);
    if (raw === undefined) continue;
    const valor = leerValidado(key, raw, []);
    out[key] = valor;
  }
  return out;
}

export interface LoadResult {
  data: Record<string, unknown>;
  warnings: string[];
  available: boolean;
  persistent: boolean | "unknown";
  needsRemeasure: RankingEntry[];
}

export async function persistente(): Promise<boolean | "unknown"> {
  try {
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
    if (!storage || typeof storage.persisted !== "function") return "unknown";
    return await storage.persisted();
  } catch {
    return "unknown";
  }
}

export function isStale(e: RankingEntry): boolean {
  return e.physicsVersion !== PHYSICS_VERSION || e.trackVersion !== getTrack(e.trackId)?.version || entradaPendiente(e);
}

/** Nunca lanza: cada clave se valida sola y lo malo se sustituye por su valor por defecto. */
export async function loadAll(): Promise<LoadResult> {
  const warnings: string[] = [];
  const data: Record<string, unknown> = {};
  for (const key of registro.keys()) {
    const raw = await leer(key);
    data[key] = leerValidado(key, raw, warnings);
  }
  if (!disponible) warnings.push("Este navegador no deja guardar en el dispositivo: lo que hagas se perderá al cerrar.");
  const rankings = data[KEY_RANKINGS] as Rankings;
  const needsRemeasure = TRACKS.flatMap((t) => rankings[t.id].filter(isStale));
  return { data, warnings, available: disponible, persistent: await persistente(), needsRemeasure };
}

/** null o undefined borran la clave: «sin evolución» es no tener nada guardado. */
export async function save<T>(key: string, value: T): Promise<void> {
  if (value === null || value === undefined) {
    memoria.delete(key);
    const s = abrir();
    if (s) {
      try {
        await del(key, s);
        return;
      } catch {
        disponible = false;
      }
    }
    return;
  }
  const s = abrir();
  if (s) {
    try {
      await set(key, value, s);
      void pedirPersistencia();
      return;
    } catch {
      disponible = false;
    }
  }
  memoria.set(key, value);
}

// --- Rankings

export interface RankingOutcome {
  entered: boolean;
  position: number | null;
  alreadyAt: number | null;
  isRecord: boolean;
  cutoff: number | null;
}

const NO_ENTRA: RankingOutcome = { entered: false, position: null, alreadyAt: null, isRecord: false, cutoff: null };

function rankingsDe(raw: unknown): Rankings {
  return (raw === undefined ? null : validateRankings(raw)) ?? emptyRankings();
}

export async function updateRanking(candidate: {
  result: CarResult;
  genome: Genome;
  origin: Origin;
  lineageId?: string;
  name?: string;
  color?: ColorCoche;
}): Promise<RankingOutcome> {
  const { result } = candidate;
  const track = getTrack(result.trackId);
  const valido =
    track !== null &&
    result.reason !== "anomaly" &&
    Number.isFinite(result.distance) &&
    result.distance >= 0 &&
    result.physicsVersion === PHYSICS_VERSION &&
    result.trackVersion === track.version &&
    marcaCreible(result);
  if (!valido) return NO_ENTRA;

  const genome = normalizeGenome(candidate.genome);
  const hash = genomeHash(genome);
  let outcome = NO_ENTRA;
  await actualizar(KEY_RANKINGS, (raw) => {
    const rankings = rankingsDe(raw);
    const list = rankings[track.id];
    const yaEsta = list.findIndex((e) => e.genomeHash === hash);
    if (yaEsta >= 0) {
      outcome = { ...NO_ENTRA, alreadyAt: yaEsta + 1 };
      return raw ?? rankings;
    }
    const entry: RankingEntry = {
      carId: result.carId,
      genome,
      genomeHash: hash,
      distance: result.distance,
      bestStep: result.bestStep,
      piezasPerdidas: result.piezasPerdidas,
      causaParada: result.causaParada,
      pendienteParada: result.pendienteParada,
      origin: candidate.origin,
      date: new Date().toISOString(),
      trackId: track.id,
      trackVersion: result.trackVersion,
      physicsVersion: result.physicsVersion,
    };
    // Con el ranking lleno hay que ir por delante del 10.º según compararMarcas; la fecha de hoy hace que un
    // empate total pierda (llegó después).
    if (list.length >= RANKING_SIZE && compararMarcas(entry, list[RANKING_SIZE - 1]) >= 0) {
      outcome = { ...NO_ENTRA, cutoff: list[RANKING_SIZE - 1].distance };
      return raw ?? rankings;
    }
    if (candidate.lineageId !== undefined) entry.lineageId = candidate.lineageId;
    const nombre = candidate.name === undefined ? "" : limpiarNombre(candidate.name);
    if (nombre) entry.name = nombre;
    if (esColorCoche(candidate.color)) entry.color = candidate.color;
    const position = list.filter((e) => compararMarcas(e, entry) < 0).length + 1;
    rankings[track.id] = [...list.slice(0, position - 1), entry, ...list.slice(position - 1)].slice(0, RANKING_SIZE);
    outcome = { entered: true, position, alreadyAt: null, isRecord: position === 1, cutoff: null };
    return rankings;
  });
  return outcome;
}

export interface RemeasureChange {
  trackId: TrackId;
  carId: string;
  before: number;
  after: number;
}

/**
 * Vuelve a medir las entradas con otra versión de física o de pista. Simula
 * fuera de la transacción (puede tardar) y aplica el resultado por carId, así
 * lo que cambie mientras tanto no se pisa.
 */
export async function remeasureRankings(
  simulate: (g: Genome, t: TrackId) => CarResult,
): Promise<RemeasureChange[]> {
  const rankings = rankingsDe(await leer(KEY_RANKINGS));
  const medidas = new Map<string, CarResult>();
  for (const t of TRACKS) {
    for (const e of rankings[t.id].filter(isStale)) medidas.set(`${t.id}/${e.carId}`, simulate(e.genome, t.id));
  }
  const cambios: RemeasureChange[] = [];
  if (medidas.size === 0) return cambios;
  await actualizar(KEY_RANKINGS, (raw) => {
    cambios.length = 0;
    const actual = rankingsDe(raw);
    for (const t of TRACKS) {
      const nuevos: RankingEntry[] = [];
      for (const e of actual[t.id]) {
        const m = medidas.get(`${t.id}/${e.carId}`);
        if (!m || !isStale(e)) {
          nuevos.push(e);
          continue;
        }
        // Una anomalía descalifica: ya no puede estar en el ranking.
        const after = m.reason === "anomaly" ? 0 : m.distance;
        cambios.push({ trackId: t.id, carId: e.carId, before: e.distance, after });
        if (m.reason !== "anomaly") {
          nuevos.push({ ...e, distance: after, bestStep: m.bestStep, piezasPerdidas: m.piezasPerdidas, causaParada: m.causaParada, pendienteParada: m.pendienteParada, trackVersion: m.trackVersion, physicsVersion: m.physicsVersion });
        }
      }
      actual[t.id] = normalizeRanking(nuevos);
    }
    return actual;
  });
  return cambios;
}

// --- Garaje

export type GarageResult = { ok: true } | { ok: false; reason: "garage-full" };

export const GARAGE_FULL_MESSAGE = `El garaje está lleno (${GARAGE_SIZE} coches). Borra alguno para guardar más.`;

function garajeDe(raw: unknown): SavedCar[] {
  return (raw === undefined ? null : validateGarage(raw)) ?? [];
}

/** Guardar un id que ya existe lo sustituye; el coche 61 nunca entra ni desplaza a otro. */
export async function saveToGarage(car: SavedCar): Promise<GarageResult> {
  let result: GarageResult = { ok: true };
  await actualizar(KEY_GARAGE, (raw) => {
    const garage = garajeDe(raw);
    const i = garage.findIndex((c) => c.id === car.id);
    if (i < 0 && garage.length >= GARAGE_SIZE) {
      result = { ok: false, reason: "garage-full" };
      return raw ?? garage;
    }
    result = { ok: true };
    if (i >= 0) garage[i] = conservarVersiones(garage[i], car);
    else garage.push(car);
    return garage;
  });
  return result;
}

export async function removeFromGarage(id: string): Promise<void> {
  await actualizar(KEY_GARAGE, (raw) => garajeDe(raw).filter((c) => c.id !== id));
}

/** Apunta la mejor marca de un coche del garaje en una pista. */
export async function recordMark(
  carId: string,
  trackId: TrackId,
  distance: number,
  versiones?: { trackVersion: number; physicsVersion: number },
  detalle?: DetalleMarca,
): Promise<void> {
  await actualizar(KEY_GARAGE, (raw) => {
    const garage = garajeDe(raw);
    for (const c of garage) {
      if (c.id !== carId) continue;
      const previa = c.markVersions?.[trackId];
      const vigente = previa?.trackVersion === getTrack(trackId)?.version && previa?.physicsVersion === PHYSICS_VERSION;
      // Una marca de otra versión no se compara con la nueva: la nueva manda aunque sea menor.
      const previaMarca = { distance: c.marks[trackId] ?? 0, ...c.markDetails?.[trackId] };
      if (c.marks[trackId] === undefined || (versiones && !vigente) || mejorMarca({ distance, ...detalle }, previaMarca)) {
        c.marks[trackId] = distance;
        if (versiones) c.markVersions = { ...c.markVersions, [trackId]: { ...versiones } };
        if (detalle) c.markDetails = { ...c.markDetails, [trackId]: { ...detalle } };
      }
    }
    return garage;
  });
}

/**
 * Cambia el nombre del coche en el garaje y en todas sus filas de ranking. No toca genoma, marcas ni fechas:
 * la fecha de una fila es la de su clasificación, no la de su último retoque. Devuelve el nombre ya normalizado.
 * Cada almacén se actualiza en su propia transacción: si falla el segundo, el coche conserva el nombre nuevo
 * y las filas el viejo, y repetir la llamada lo deja igual en los dos.
 */
export async function renombrarCoche(carId: string, nombre: string): Promise<string> {
  const final = normalizarNombre(nombre, nombrePropuesto(carId));
  await actualizar(KEY_GARAGE, (raw) => {
    const garage = garajeDe(raw);
    for (const c of garage) if (c.id === carId) c.name = final;
    return garage;
  });
  await renombrarEnRankings(carId, final);
  return final;
}

/** Solo las filas de ranking: quien ya escribió el nombre en el garaje por otro camino no repite esa transacción. */
export async function renombrarEnRankings(carId: string, nombreNormalizado: string): Promise<void> {
  await actualizar(KEY_RANKINGS, (raw) => {
    const rankings = rankingsDe(raw);
    for (const t of TRACKS) for (const e of rankings[t.id]) if (e.genomeHash === carId) e.name = nombreNormalizado;
    return rankings;
  });
}
