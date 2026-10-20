import type { EvolutionState } from "@/evolution/ga";
import { TRACKS } from "@/sim/tracks";
import { KEY_EVOLUTION, KEY_GARAGE, KEY_RANKINGS, type Rankings, type SavedCar } from "./schema";
import { clavesRegistradas, validarEstricto } from "./store";

export const COPIA_FORMAT = "darwin-drive-copia";
export const COPIA_VERSION = 1;
export const COPIA_MAX_BYTES = 5 * 1024 * 1024;

export const COPIA_INVALIDA =
  "Este fichero no es una copia de Darwin Drive o es de una versión que no entiendo. No se ha cambiado nada.";

export interface Copia {
  format: typeof COPIA_FORMAT;
  v: typeof COPIA_VERSION;
  exportedAt: string;
  data: Record<string, unknown>;
}

export type ResultadoCopia = { ok: true; data: Record<string, unknown>; resumen: string } | { ok: false; motivo: string };

export function crearCopia(data: Record<string, unknown>, ahora: Date): Copia {
  // Solo las claves registradas: lo que el juego no entiende no viaja en la copia.
  const limpia: Record<string, unknown> = {};
  for (const { key } of clavesRegistradas()) limpia[key] = data[key] ?? null;
  return { format: COPIA_FORMAT, v: COPIA_VERSION, exportedAt: ahora.toISOString(), data: limpia };
}

/** AAAA-MM-DD en hora local: es el día que la persona ve en su calendario. */
export function nombreFicheroCopia(ahora: Date): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `darwin-drive-copia-${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}.json`;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** «4 rankings con 23 marcas, 7 coches, evolución en la gen 12» */
export function resumenCopia(data: Record<string, unknown>): string {
  const rankings = data[KEY_RANKINGS] as Rankings | null | undefined;
  const listas = rankings ? TRACKS.map((t) => rankings[t.id]).filter((l) => l.length > 0) : [];
  const marcas = listas.reduce((suma, l) => suma + l.length, 0);
  const garaje = (data[KEY_GARAGE] as SavedCar[] | null | undefined) ?? [];
  const evolucion = data[KEY_EVOLUTION] as EvolutionState | null | undefined;
  const partes = [
    `${plural(listas.length, "ranking", "rankings")} con ${plural(marcas, "marca", "marcas")}`,
    plural(garaje.length, "coche", "coches"),
    evolucion ? `evolución en la gen ${evolucion.generation}` : "sin evolución",
  ];
  return partes.join(", ");
}

/** JSON con las claves ordenadas: dos valores iguales dan el mismo texto aunque vengan en otro orden. */
function canonico(v: unknown): string {
  return JSON.stringify(v, (_clave, valor: unknown) =>
    typeof valor === "object" && valor !== null && !Array.isArray(valor)
      ? Object.fromEntries(Object.entries(valor).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : valor,
  );
}

/**
 * Valida el texto de un fichero sin tocar nada. Tope de tamaño, formato y
 * versión, y cada clave contra su validador sin perdonar entradas sueltas.
 */
export function validarCopia(texto: string, bytes: number = new TextEncoder().encode(texto).length): ResultadoCopia {
  const invalida: ResultadoCopia = { ok: false, motivo: COPIA_INVALIDA };
  if (bytes > COPIA_MAX_BYTES) return invalida;
  let raw: unknown;
  try {
    raw = JSON.parse(texto);
  } catch {
    return invalida;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return invalida;
  const r = raw as Record<string, unknown>;
  if (r.format !== COPIA_FORMAT || r.v !== COPIA_VERSION) return invalida;
  if (typeof r.data !== "object" || r.data === null || Array.isArray(r.data)) return invalida;
  const data = r.data as Record<string, unknown>;
  const conocidas = new Set(clavesRegistradas().map((c) => c.key));
  // Una clave que este juego no conoce viene de otra versión: mejor no importar que perderla en silencio.
  if (Object.keys(data).some((k) => !conocidas.has(k))) return invalida;
  const validos: Record<string, unknown> = {};
  for (const { key } of clavesRegistradas()) {
    if (!(key in data)) continue;
    const v = validarEstricto(key, data[key]);
    // Los validadores corrigen en vez de rechazar (un genoma fuera de rango se recorta): si lo que
    // sale no es idéntico a lo que entró, el fichero no es una copia que el juego haya escrito.
    if (!v.ok || canonico(v.value) !== canonico(data[key])) return invalida;
    validos[key] = v.value;
  }
  return { ok: true, data: validos, resumen: resumenCopia(validos) };
}
