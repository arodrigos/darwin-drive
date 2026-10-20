import dagre from "@dagrejs/dagre";
import type { LineageNode } from "@/evolution/lineage";

export const NODE_WIDTH = 96;
export const NODE_HEIGHT = 76;
const NODE_SEP = 12;
const RANK_SEP = 20;
const MARGIN = 12;
/** Por encima de esto dagre tarda cientos de ms en un grafo denso: se usa la disposición rápida propia. */
export const DAGRE_MAX_NODES = 30;
const BARRIDOS = 4;

export interface PlacedNode {
  node: LineageNode;
  /** Centro del nodo. */
  x: number;
  y: number;
  /** 0 = la capa de arriba. */
  layer: number;
}

export interface PlacedEdge {
  from: string;
  to: string;
  points: { x: number; y: number }[];
}

export interface LineageLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
  layers: number;
}

/** El nodo `rootId` y todos sus antepasados que siguen en el linaje, sin repetir. */
export function ancestorsOf(rootId: string, nodes: LineageNode[]): LineageNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = [rootId];
  const out: LineageNode[] = [];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue;
    seen.add(id);
    out.push(node);
    stack.push(...node.parents);
  }
  return out;
}

function placeWithDagre(subset: LineageNode[], pares: [string, string][]): LineageLayout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: MARGIN, marginy: MARGIN });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of subset) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const [p, h] of pares) g.setEdge(p, h);
  dagre.layout(g);

  const ys = [...new Set(subset.map((n) => g.node(n.id).y))].sort((a, b) => a - b);
  const layerOf = new Map(ys.map((y, i) => [y, i]));
  const graph = g.graph();
  return {
    nodes: subset.map((node) => {
      const p = g.node(node.id);
      return { node, x: p.x, y: p.y, layer: layerOf.get(p.y)! };
    }),
    edges: pares.map(([from, to]) => ({ from, to, points: g.edge(from, to).points })),
    width: graph.width ?? 0,
    height: graph.height ?? 0,
    layers: ys.length,
  };
}

/**
 * Disposición por capas en tiempo casi lineal para linajes grandes: capa = camino más largo desde las raíces,
 * orden dentro de la capa por baricentro (barridos hacia abajo y hacia arriba) y x pegada a la de los padres
 * sin solapar. Las aristas son rectas: en un árbol así de grande importa más moverlo con el dedo que el pulido.
 */
function placeFast(subset: LineageNode[], pares: [string, string][]): LineageLayout {
  const padres = new Map<string, string[]>(subset.map((n) => [n.id, []]));
  const hijos = new Map<string, string[]>(subset.map((n) => [n.id, []]));
  for (const [p, h] of pares) {
    padres.get(h)!.push(p);
    hijos.get(p)!.push(h);
  }
  // Kahn con la capa del camino más largo. Si hubiera un ciclo (datos corruptos), se fuerza el de menor generación.
  const pendientes = new Map(subset.map((n) => [n.id, padres.get(n.id)!.length]));
  const capa = new Map<string, number>();
  const cola = subset.filter((n) => pendientes.get(n.id) === 0).map((n) => n.id);
  const resto = new Set(subset.map((n) => n.id));
  const soltar = (id: string) => {
    resto.delete(id);
    const c = Math.max(-1, ...padres.get(id)!.filter((p) => capa.has(p)).map((p) => capa.get(p)!)) + 1;
    capa.set(id, c);
    for (const h of hijos.get(id)!) {
      const k = pendientes.get(h)! - 1;
      pendientes.set(h, k);
      if (k === 0) cola.push(h);
    }
  };
  while (resto.size > 0) {
    if (cola.length === 0) {
      let forzado = subset.find((n) => resto.has(n.id))!;
      for (const n of subset) if (resto.has(n.id) && n.generation < forzado.generation) forzado = n;
      cola.push(forzado.id);
    }
    const id = cola.shift()!;
    if (resto.has(id)) soltar(id);
  }
  const capas: string[][] = [];
  for (const n of subset) (capas[capa.get(n.id)!] ??= []).push(n.id);

  const rango = new Map<string, number>();
  const reindexar = (l: number) => capas[l].forEach((id, i) => rango.set(id, i));
  capas.forEach((_, l) => reindexar(l));
  const baricentro = (id: string, vecinos: string[]) => (vecinos.length === 0 ? rango.get(id)! : vecinos.reduce((a, v) => a + rango.get(v)!, 0) / vecinos.length);
  for (let b = 0; b < BARRIDOS; b++) {
    for (let l = 1; l < capas.length; l++) {
      const clave = new Map(capas[l].map((id) => [id, baricentro(id, padres.get(id)!)]));
      capas[l].sort((a, c) => clave.get(a)! - clave.get(c)!);
      reindexar(l);
    }
    for (let l = capas.length - 2; l >= 0; l--) {
      const clave = new Map(capas[l].map((id) => [id, baricentro(id, hijos.get(id)!)]));
      capas[l].sort((a, c) => clave.get(a)! - clave.get(c)!);
      reindexar(l);
    }
  }

  // x: cada nodo lo más cerca posible de la media de sus padres, sin pisar a su vecino de capa.
  const paso = NODE_WIDTH + NODE_SEP;
  const x = new Map<string, number>();
  capas.forEach((ids, l) => {
    const deseada = ids.map((id) => {
      const ps = padres.get(id)!;
      return l === 0 || ps.length === 0 ? null : ps.reduce((a, p) => a + x.get(p)!, 0) / ps.length;
    });
    let siguiente = -Infinity;
    ids.forEach((id, i) => {
      const d = deseada[i] ?? (i === 0 ? 0 : siguiente + paso);
      const v = Math.max(d, siguiente);
      x.set(id, v);
      siguiente = v + paso;
    });
  });
  const minX = Math.min(...x.values());
  const maxX = Math.max(...x.values());
  const dx = MARGIN + NODE_WIDTH / 2 - minX;
  const porId = new Map(subset.map((n) => [n.id, n]));
  const yDe = (l: number) => MARGIN + NODE_HEIGHT / 2 + l * (NODE_HEIGHT + RANK_SEP);
  return {
    nodes: subset.map((node) => ({ node, x: x.get(node.id)! + dx, y: yDe(capa.get(node.id)!), layer: capa.get(node.id)! })),
    edges: pares.map(([from, to]) => {
      const a = porId.get(from)!.id;
      const b = porId.get(to)!.id;
      return {
        from,
        to,
        points: [
          { x: x.get(a)! + dx, y: yDe(capa.get(a)!) + NODE_HEIGHT / 2 },
          { x: x.get(b)! + dx, y: yDe(capa.get(b)!) - NODE_HEIGHT / 2 },
        ],
      };
    }),
    width: maxX - minX + NODE_WIDTH + 2 * MARGIN,
    height: 2 * MARGIN + capas.length * NODE_HEIGHT + (capas.length - 1) * RANK_SEP,
    layers: capas.length,
  };
}

/**
 * Dispone por capas los antepasados de `rootId`. La capa sale de la propia disposición, no de la generación:
 * un coche retocado a mano nace con generación 0 siendo hijo de uno de la 5, y aun así tiene que quedar debajo.
 */
export function layoutLineage(rootId: string, nodes: LineageNode[], maxDagre: number = DAGRE_MAX_NODES): LineageLayout {
  const subset = ancestorsOf(rootId, nodes);
  const ids = new Set(subset.map((n) => n.id));
  const pares: [string, string][] = [];
  for (const n of subset) {
    // Un padre repetido o ausente no dibuja una arista de más ni una que apunte al vacío.
    for (const p of new Set(n.parents)) if (ids.has(p) && p !== n.id) pares.push([p, n.id]);
  }
  return subset.length <= maxDagre ? placeWithDagre(subset, pares) : placeFast(subset, pares);
}
