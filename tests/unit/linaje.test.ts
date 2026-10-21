import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import demoJson from "../../src/debug/escenarios/linaje-demo-5.json";
import { etiquetaMano, nombreCorto, opcionesLinaje } from "../../src/app/components/Linaje";
import type { LineageNode } from "../../src/evolution/lineage";
import { ancestorsOf, layoutLineage } from "../../src/app/lineage-layout";
import { STOCK_CAR } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";
import { emptyRankings, validateLineage, type Rankings } from "../../src/storage/schema";

function nodo(id: string, parents: string[], generation: number, extra: Partial<LineageNode> = {}): LineageNode {
  return {
    id,
    parents,
    op: parents.length === 2 ? "crossover" : parents.length === 1 ? "mutation" : "random",
    generation,
    distance: generation * 10,
    trackId: "cordillera",
    genome: STOCK_CAR,
    hue: 120,
    humanTouched: false,
    prunedParents: false,
    ...extra,
  };
}

/** Un DAG aleatorio donde cada nodo elige hasta dos padres entre los anteriores (como hace el GA). */
const dagArb = fc
  .array(fc.tuple(fc.nat(1000), fc.nat(1000), fc.constantFrom(0, 1, 2)), { minLength: 1, maxLength: 60 })
  .map((specs) => {
    const nodes: LineageNode[] = [];
    specs.forEach(([a, b, n], i) => {
      const parents = i === 0 || n === 0 ? [] : n === 1 ? [nodes[a % i].id] : [...new Set([nodes[a % i].id, nodes[b % i].id])];
      nodes.push(nodo(`n${i}`, parents, i === 0 ? 0 : 1 + Math.max(0, ...parents.map((p) => nodes.find((x) => x.id === p)!.generation))));
    });
    return nodes;
  });

// maxDagre 0 fuerza la disposición rápida y 1000 la de dagre: el invariante vale para las dos.
test("ln-1 (invariante): todo nodo dibujado queda en una capa estrictamente inferior a la de sus padres dibujados", () => {
  fc.assert(
    fc.property(dagArb, fc.constantFrom(0, 1000), (nodes, maxDagre) => {
      const root = nodes[nodes.length - 1];
      const l = layoutLineage(root.id, nodes, maxDagre);
      const capa = new Map(l.nodes.map((p) => [p.node.id, p.layer]));
      for (const p of l.nodes) {
        for (const padre of p.node.parents) {
          if (capa.has(padre)) assert.ok(capa.get(p.node.id)! > capa.get(padre)!, `${p.node.id} no está debajo de ${padre}`);
        }
      }
      // Solo se dibujan el coche y sus antepasados, y cada uno una vez.
      assert.deepEqual([...capa.keys()].sort(), ancestorsOf(root.id, nodes).map((n) => n.id).sort());
    }),
    { numRuns: 100 },
  );
});

test("ln-1 (invariante): un retoque con generación 0 hijo de un nodo de la 5 sigue dibujándose debajo de su padre", () => {
  const cadena = Array.from({ length: 6 }, (_, g) => nodo(`c${g}`, g === 0 ? [] : [`c${g - 1}`], g));
  const retoque = nodo("r", ["c5"], 0, { op: "retouch", humanTouched: true });
  for (const maxDagre of [0, 1000]) {
    const l = layoutLineage("r", [...cadena, retoque], maxDagre);
    assert.equal(l.layers, 7);
    assert.equal(l.nodes.find((p) => p.node.id === "r")!.layer, 6);
  }
});

test("ln-1: el linaje demo dibuja ≥5 capas, un nodo de la generación 3 con dos aristas de entrada y el diseño como raíz", () => {
  const nodos = validateLineage(demoJson.nodos);
  assert.ok(nodos);
  const l = layoutLineage(demoJson.campeon, nodos);
  assert.ok(l.layers >= 5, `solo ${l.layers} capas`);
  const g3 = l.nodes.find((p) => p.node.generation === 3 && p.node.parents.length === 2);
  assert.ok(g3, "falta un cruce en la generación 3");
  assert.equal(l.edges.filter((e) => e.to === g3.node.id).length, 2);
  const raices = l.nodes.filter((p) => p.node.parents.length === 0);
  assert.equal(raices.length, 1);
  assert.equal(raices[0].node.op, "design");
  assert.equal(etiquetaMano(raices[0].node), "✋ diseño");
  assert.equal(raices[0].layer, 0);
});

test("ln-2: la distancia anotada del campeón demo es la que da el núcleo al correr su genoma en su pista", () => {
  const campeon = demoJson.nodos.find((n) => n.id === demoJson.campeon)!;
  const r = simulateCar(campeon.genome as never, campeon.trackId as "cordillera");
  assert.equal(r.distance, campeon.distance);
});

test("ln-4: 300 nodos se disponen rápido, sin solapes en una capa y con las aristas hacia capas inferiores", () => {
  const nodes: LineageNode[] = [];
  for (let i = 0; i < 300; i++) {
    const g = Math.floor(i / 10);
    const parents = g === 0 ? [] : [`n${(g - 1) * 10 + (i % 10)}`, `n${(g - 1) * 10 + ((i * 7 + 3) % 10)}`].filter((p, k, a) => a.indexOf(p) === k);
    nodes.push(nodo(`n${i}`, parents, g));
  }
  const t0 = performance.now();
  const l = layoutLineage("n299", nodes);
  const ms = performance.now() - t0;
  assert.ok(l.nodes.length >= 100);
  // Con holgura: el límite de 300 ms con CPU ×4 se mide en el navegador (e2e).
  assert.ok(ms < 500, `${ms} ms`);
  const capa = new Map(l.nodes.map((p) => [p.node.id, p.layer]));
  for (const e of l.edges) assert.ok(capa.get(e.to)! > capa.get(e.from)!);
  const porCapa = new Map<number, number[]>();
  for (const p of l.nodes) porCapa.set(p.layer, [...(porCapa.get(p.layer) ?? []), p.x]);
  for (const xs of porCapa.values()) {
    xs.sort((a, b) => a - b);
    xs.slice(1).forEach((x, i) => assert.ok(x - xs[i] >= 96, "dos nodos se pisan"));
  }
});

test("ln-1: el selector ofrece n.º 1 de cada pista con linaje, el campeón actual y los coches del garaje que siguen en el árbol", () => {
  const nodes = [nodo("a", [], 0), nodo("b", ["a"], 1), nodo("c", ["b"], 2)];
  const rankings: Rankings = emptyRankings();
  rankings.cordillera = [{ carId: "c", genome: STOCK_CAR, genomeHash: "h", distance: 5, origin: "mixto", date: "2026-01-01T00:00:00Z", trackId: "cordillera", trackVersion: 3, physicsVersion: 2, lineageId: "c" }];
  rankings.rampa = [{ ...rankings.cordillera[0], trackId: "rampa", lineageId: "podado" }];
  const garaje = [
    { id: "g1", name: "Mi coche", genome: STOCK_CAR, marks: {}, origin: "diseño" as const, savedAt: "2026-01-01T00:00:00Z", lineageId: "b" },
    { id: "g2", name: "Sin árbol", genome: STOCK_CAR, marks: {}, origin: "diseño" as const, savedAt: "2026-01-01T00:00:00Z" },
  ];
  const evolucion = { history: [{ generation: 1, best: 1, topQuarterMean: 1, mean: 1, bestId: "b" }] } as never;
  const ops = opcionesLinaje(nodes, rankings, garaje, evolucion);
  assert.deepEqual(
    ops.map((o) => [o.label, o.rootId]),
    [
      ["n.º 1 de La Cordillera", "c"],
      ["campeón actual", "b"],
      ["coche del garaje: Mi coche", "b"],
    ],
  );
  assert.deepEqual(opcionesLinaje([], rankings, garaje, null), []);
});

test("ln-1: nombres cortos de pista y marca de la mano humana", () => {
  assert.equal(nombreCorto("cordillera"), "Cordillera");
  assert.equal(nombreCorto("dunas"), "Dunas");
  assert.equal(nombreCorto(null), "sin medir");
  assert.equal(etiquetaMano(nodo("x", [], 0, { op: "retouch" })), "✋ retoque");
  assert.equal(etiquetaMano(nodo("x", [], 0, { op: "clone" })), null);
});

test("mig-6: validateLineage conserva trackVersion entero y lo deja sin definir si falta o no es entero", () => {
  const base = demoJson.nodos[0];
  const [con, sin, malo] = validateLineage([{ ...base, trackVersion: 1 }, { ...base, id: "sin", trackVersion: undefined }, { ...base, id: "malo", trackVersion: "1" }]) ?? [];
  assert.equal(con.trackVersion, 1);
  assert.equal(sin.trackVersion, undefined);
  assert.equal(malo.trackVersion, undefined);
});
