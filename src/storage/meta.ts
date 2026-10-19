import { del, get, set } from "idb-keyval";
import { DEFAULT_TRACK_ID, getTrack, type TrackId } from "@/sim/tracks";

export const META_KEY = "dd:v1:meta";

export interface Meta {
  seenHelp: string[];
  persistRequested: boolean;
  lastTrack: TrackId;
}

export const DEFAULT_META: Meta = { seenHelp: [], persistRequested: false, lastTrack: DEFAULT_TRACK_ID };

/** Devuelve null si el valor guardado no es una Meta válida: se descarta entero. */
export function validateMeta(raw: unknown): Meta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.seenHelp) || !r.seenHelp.every((s) => typeof s === "string")) return null;
  if (typeof r.persistRequested !== "boolean") return null;
  const track = getTrack(r.lastTrack);
  if (!track) return null;
  return { seenHelp: r.seenHelp.slice(0, 50), persistRequested: r.persistRequested, lastTrack: track.id };
}

// Sin IndexedDB (modo privado antiguo, políticas del navegador) el juego sigue
// funcionando con un almacén en memoria; el aviso lo da quien llama.
let enMemoria: Meta | null = null;

export async function loadMeta(): Promise<{ meta: Meta; warning: string | null; available: boolean }> {
  try {
    const raw = await get(META_KEY);
    if (raw === undefined) return { meta: DEFAULT_META, warning: null, available: true };
    const meta = validateMeta(raw);
    if (meta) return { meta, warning: null, available: true };
    await del(META_KEY);
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
    await set(META_KEY, meta);
  } catch {
    // Ya avisó loadMeta; guardar es lo mejor que se puede hacer.
  }
}
