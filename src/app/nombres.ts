import { uniformInt } from "pure-rand/distribution/uniformInt";
import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import { getTrack } from "@/sim/tracks";

type Genero = "m" | "f";
/** Adjetivo con sus dos formas: [masculina, femenina]. */
type Adjetivo = readonly [string, string];

export const ADJETIVOS: readonly Adjetivo[] = [
  ["Tenaz", "Tenaz"], ["Veloz", "Veloz"], ["Bravo", "Brava"], ["Audaz", "Audaz"], ["Fiero", "Fiera"], ["Ágil", "Ágil"],
  ["Terco", "Terca"], ["Ligero", "Ligera"], ["Robusto", "Robusta"], ["Astuto", "Astuta"], ["Sereno", "Serena"],
  ["Rudo", "Ruda"], ["Vivo", "Viva"], ["Noble", "Noble"], ["Cauto", "Cauta"], ["Feroz", "Feroz"], ["Alegre", "Alegre"],
  ["Pícaro", "Pícara"], ["Firme", "Firme"], ["Rápido", "Rápida"], ["Ancho", "Ancha"], ["Curioso", "Curiosa"],
  ["Bizarro", "Bizarra"], ["Testarudo", "Testaruda"], ["Sagaz", "Sagaz"], ["Intrépido", "Intrépida"],
  ["Travieso", "Traviesa"], ["Elegante", "Elegante"], ["Resuelto", "Resuelta"], ["Obstinado", "Obstinada"],
  ["Valiente", "Valiente"], ["Silencioso", "Silenciosa"],
];
export const SUSTANTIVOS: readonly (readonly [string, Genero])[] = [
  ["Escarabajo", "m"], ["Halcón", "m"], ["Lince", "m"], ["Tortuga", "f"], ["Zorro", "m"], ["Cangrejo", "m"],
  ["Bisonte", "m"], ["Gato", "m"], ["Lagarto", "m"], ["Búho", "m"], ["Mapache", "m"], ["Jabalí", "m"],
  ["Cometa", "m"], ["Trueno", "m"], ["Cohete", "m"], ["Molino", "m"], ["Camello", "m"], ["Petirrojo", "m"],
  ["Erizo", "m"], ["Delfín", "m"], ["Gorrión", "m"], ["Tejón", "m"], ["Águila", "f"], ["Castor", "m"],
  ["Mosquito", "m"], ["Lobo", "m"], ["Mono", "m"], ["Oso", "m"], ["Pulpo", "m"], ["Rinoceronte", "m"],
  ["Saltamontes", "m"], ["Topo", "m"], ["Libélula", "f"], ["Mariposa", "f"], ["Ardilla", "f"], ["Cebra", "f"],
  ["Gacela", "f"], ["Pantera", "f"], ["Avispa", "f"], ["Nutria", "f"],
];

/** Combinaciones que, aun concordadas, suenan mal o hacen gracia a quien no toca; se comprueba contra todo el espacio. */
export const EXCLUIDOS: ReadonlySet<string> = new Set(["Mosquito Feroz", "Mono Bizarro", "Gato Pícaro", "Pulpo Travieso"]);

const PALABRAS_POR_GENERO = (g: Genero) => ADJETIVOS.map((a) => (g === "m" ? a[0] : a[1]));

/** Todos los nombres posibles, en orden estable; los tests los recorren enteros. */
export function todosLosNombres(): string[] {
  const out: string[] = [];
  for (const [s, g] of SUSTANTIVOS) for (const a of PALABRAS_POR_GENERO(g)) if (!EXCLUIDOS.has(`${s} ${a}`)) out.push(`${s} ${a}`);
  return out;
}

const NOMBRES = todosLosNombres();

/** «Sustantivo Adjetivo» concordado en género a partir de un aleatorio en [0, 1). */
export function generarNombre(rand: () => number): string {
  const r = rand();
  const i = Math.min(NOMBRES.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * NOMBRES.length)));
  return NOMBRES[i];
}

/** FNV-1a: determinista y sin dependencias; solo hace falta repartir bien, no resistir ataques. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Nombre concordado fijo para un coche: el mismo genoma propone siempre el mismo nombre. */
export function nombrePropuesto(genomeHash: string): string {
  return NOMBRES[fnv(genomeHash) % NOMBRES.length];
}

/** Aleatorio de la app: pure-rand con una semilla de crypto.getRandomValues, nunca Math.random. */
export function aleatorioDeApp(): () => number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const gen = xoroshiro128plus(buf[0]);
  return () => uniformInt(gen, 0, 0xfffffff) / 0x10000000;
}

/** La ficha que acompaña al nombre: de dónde salió el coche. Nunca falla con datos que falten. */
export function fichaOrigen(origin: string, nodo: { generation: number; trackId: string | null } | null, pista?: string): string {
  const track = getTrack(nodo?.trackId ?? pista);
  if (origin === "evolución") {
    if (!track) return "Evolucionado";
    return nodo ? `Evolucionado en ${track.name} · gen ${nodo.generation}` : `Evolucionado en ${track.name}`;
  }
  if (origin === "mixto") return "Mezcla de diseño y evolución";
  return "Diseñado en el Taller";
}
