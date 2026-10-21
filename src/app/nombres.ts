import { getTrack } from "@/sim/tracks";

const ADJETIVOS = [
  "Rayo", "Tenaz", "Veloz", "Bravo", "Audaz", "Fiero", "Ágil", "Terco", "Ligero", "Robusto",
  "Astuto", "Sereno", "Rudo", "Vivo", "Noble", "Cauto", "Feroz", "Alegre", "Pícaro", "Firme",
  "Rápido", "Ancho", "Curioso", "Bizarro", "Testarudo", "Sagaz", "Intrépido", "Travieso", "Elegante", "Resuelto",
  "Obstinado", "Valiente",
];
const SUSTANTIVOS = [
  "Escarabajo", "Halcón", "Lince", "Tortuga", "Zorro", "Cangrejo", "Bisonte", "Gato", "Lagarto", "Búho",
  "Mapache", "Jabalí", "Cometa", "Trueno", "Cohete", "Molino", "Camello", "Petirrojo", "Erizo", "Delfín",
  "Gorrión", "Tejón", "Águila", "Castor", "Mosquito", "Lobo", "Mono", "Oso", "Pulpo", "Rinoceronte",
  "Saltamontes", "Topo",
];

/** FNV-1a: determinista y sin dependencias; solo hace falta repartir bien, no resistir ataques. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** «Adjetivo Sustantivo» fijo para un coche: el mismo genoma propone siempre el mismo nombre. */
export function nombrePropuesto(genomeHash: string): string {
  const h = fnv(genomeHash);
  const a = ADJETIVOS[h % ADJETIVOS.length];
  const s = SUSTANTIVOS[Math.floor(h / ADJETIVOS.length) % SUSTANTIVOS.length];
  return `${s} ${a}`;
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
