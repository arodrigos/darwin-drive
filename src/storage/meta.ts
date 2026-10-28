import { del, get, set, type UseStore } from "idb-keyval";
import { DEFAULT_TRACK_ID, getTrack, type TrackId } from "@/sim/tracks";
import { abrirBase } from "./base";

export const META_KEY = "dd:v1:meta";

/** Los ritmos que Pista recuerda: «Hasta el final» es una orden de una sola vez, no un ajuste. */
export const RITMOS_RECORDADOS = ["x1", "x2", "x4", "x8"] as const;
export type RitmoRecordado = (typeof RITMOS_RECORDADOS)[number];

export interface Meta {
  seenHelp: string[];
  persistRequested: boolean;
  lastTrack: TrackId;
  ritmo: RitmoRecordado;
  /** Sonido encendido; la primera vez está apagado. */
  sonido: boolean;
}

export const DEFAULT_META: Meta = { seenHelp: [], persistRequested: false, lastTrack: DEFAULT_TRACK_ID, ritmo: "x1", sonido: false };

export function esRitmoRecordado(v: unknown): v is RitmoRecordado {
  return typeof v === "string" && (RITMOS_RECORDADOS as readonly string[]).includes(v);
}

/** Devuelve null si el valor guardado no es una Meta válida: se descarta entero. */
export function validateMeta(raw: unknown): Meta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.seenHelp) || !r.seenHelp.every((s) => typeof s === "string")) return null;
  if (typeof r.persistRequested !== "boolean") return null;
  const track = getTrack(r.lastTrack);
  if (!track) return null;
  // Una Meta anterior no trae ritmo y un valor desconocido («turbo», uno futuro) no la invalida: solo se ignora.
  const ritmo = esRitmoRecordado(r.ritmo) ? r.ritmo : "x1";
  // Igual que ritmo: si falta o no es booleano, vale false y la Meta sigue siendo válida.
  return { seenHelp: r.seenHelp.slice(0, 50), persistRequested: r.persistRequested, lastTrack: track.id, ritmo, sonido: r.sonido === true };
}

// Sin IndexedDB (modo privado antiguo, políticas del navegador) el juego sigue
// funcionando con un almacén en memoria; el aviso lo da quien llama.
let enMemoria: Meta | null = null;
let almacen: UseStore | null = null;
const base = () => (almacen ??= abrirBase());

export async function loadMeta(): Promise<{ meta: Meta; warning: string | null; available: boolean }> {
  try {
    const raw = await get(META_KEY, base());
    if (raw === undefined) return { meta: DEFAULT_META, warning: null, available: true };
    const meta = validateMeta(raw);
    if (meta) return { meta, warning: null, available: true };
    await del(META_KEY, base());
    return { meta: DEFAULT_META, warning: "Los ajustes guardados no eran válidos y se han descartado.", available: true };
  } catch {
    return {
      meta: enMemoria ?? DEFAULT_META,
      warning: "Este navegador no deja guardar en el dispositivo: lo que hagas se perderá al cerrar.",
      available: false,
    };
  }
}

export async function saveMeta(meta: Meta): Promise<void> {
  enMemoria = meta;
  try {
    await set(META_KEY, meta, base());
  } catch {
    // Ya avisó loadMeta; guardar es lo mejor que se puede hacer.
  }
}
