import type { Genome } from "../sim/genome";
import type { TrackId } from "../sim/tracks";
import type { Op } from "./ga";

export const MAX_LINEAGE_NODES = 3000;

export interface LineageNode {
  id: string;
  parents: string[];
  op: Op;
  generation: number;
  distance: number | null;
  trackId: TrackId | null;
  /** Versión de la pista en que se midió `distance`; los nodos sin ella son anteriores al versionado. */
  trackVersion?: number;
  genome: Genome;
  hue: number;
  humanTouched: boolean;
  prunedParents: boolean;
}

/** Un nodo lo toca una persona solo cuando el diseño o el retoque son suyos. */
export function isHumanOp(op: Op): boolean {
  return op === "design" || op === "retouch";
}

/**
 * Funde nodos nuevos o actualizados en el linaje. Un nodo que ya existía
 * conserva su forma (también `prunedParents`) y solo gana la distancia que
 * antes no se conocía: así una poda anterior no se deshace sin querer.
 */
export function mergeLineage(existing: LineageNode[], added: LineageNode[]): LineageNode[] {
  const byId = new Map<string, number>();
  const out = existing.slice();
  out.forEach((n, i) => byId.set(n.id, i));
  for (const n of added) {
    const i = byId.get(n.id);
    if (i === undefined) {
      byId.set(n.id, out.length);
      out.push(n);
    } else if (n.distance !== null) {
      out[i] = { ...out[i], distance: n.distance, trackId: n.trackId, ...(n.trackVersion !== undefined ? { trackVersion: n.trackVersion } : {}) };
    }
  }
  return out;
}

/**
 * Poda a `max` nodos. Primero entran los protegidos y sus antepasados, por
 * niveles (si no caben todos, los más cercanos ganan); lo que sobra de cupo lo
 * ocupan las generaciones más recientes. Un nodo que pierde padres queda marcado
 * con `prunedParents` y deja de listar los ids que ya no existen.
 */
export function pruneLineage(nodes: LineageNode[], protectedIds: string[], max: number = MAX_LINEAGE_NODES): LineageNode[] {
  if (nodes.length <= max) return nodes.slice();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const keep = new Set<string>();
  let frontier = [...new Set(protectedIds)].filter((id) => byId.has(id));
  while (frontier.length > 0 && keep.size < max) {
    const next: string[] = [];
    for (const id of frontier) {
      if (keep.has(id)) continue;
      if (keep.size >= max) break;
      keep.add(id);
      for (const p of byId.get(id)!.parents) if (byId.has(p) && !keep.has(p)) next.push(p);
    }
    frontier = next;
  }
  if (keep.size < max) {
    // Índice descendente como desempate: a igual generación, el más nuevo.
    const recent = nodes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => !keep.has(n.id))
      .sort((a, b) => b.n.generation - a.n.generation || b.i - a.i);
    for (const { n } of recent) {
      if (keep.size >= max) break;
      keep.add(n.id);
    }
  }
  return nodes
    .filter((n) => keep.has(n.id))
    .map((n) => {
      const parents = n.parents.filter((p) => keep.has(p));
      if (parents.length === n.parents.length) return n;
      return { ...n, parents, prunedParents: true };
    });
}

/**
 * «Diseño» si solo hay mano humana en su historia, «evolución» si no hay
 * ninguna, «mixto» si hay las dos. Un clon no cuenta como evolución: el élite
 * de un diseño sigue siendo el diseño.
 */
export function originOf(id: string, nodes: LineageNode[]): "diseño" | "evolución" | "mixto" {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = [id];
  let human = false;
  let evolved = false;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const node = byId.get(cur);
    if (!node) continue;
    if (node.humanTouched) human = true;
    if (node.op === "mutation" || node.op === "crossover" || node.op === "random") evolved = true;
    stack.push(...node.parents);
  }
  if (human && evolved) return "mixto";
  return human ? "diseño" : "evolución";
}
