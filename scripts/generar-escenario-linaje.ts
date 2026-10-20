// Genera src/debug/escenarios/linaje-demo-5.json con el núcleo real: siete generaciones corridas en La Cordillera
// desde el coche de serie (semilla fija). El campeón de la última es el n.º 1 del escenario, con sus antepasados.
import { escribirEscenario } from "./escribir-escenario";
import { DEFAULT_PARAMS } from "../src/evolution/ga";
import { mergeLineage, type LineageNode } from "../src/evolution/lineage";
import { STOCK_CAR } from "../src/sim/genome";
import { evolve } from "../tests/unit/helpers/evolucionar";

export const SEMILLA_LINAJE = 5;
export const GENERACIONES_LINAJE = 7;

export interface EscenarioLinajeDemo {
  trackId: "cordillera";
  campeon: string;
  nodos: LineageNode[];
}

export function construirLinaje(): EscenarioLinajeDemo {
  const e = evolve({ ...DEFAULT_PARAMS, seed: SEMILLA_LINAJE }, "cordillera", GENERACIONES_LINAJE, {
    from: { kind: "genomes", items: [{ genome: STOCK_CAR, op: "design" }] },
  });
  const nodos = e.lineage.reduce<LineageNode[]>((acc, n) => mergeLineage(acc, [n]), []);
  const ultima = e.results[e.results.length - 1];
  const mejor = ultima.reduce((a, b) => (b.distance > a.distance ? b : a));
  return { trackId: "cordillera", campeon: mejor.carId, nodos };
}

if (process.argv[1] && process.argv[1].endsWith("generar-escenario-linaje.ts")) {
  escribirEscenario(new URL("../src/debug/escenarios/linaje-demo-5.json", import.meta.url), construirLinaje());
}
