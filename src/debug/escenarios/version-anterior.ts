import { PHYSICS_VERSION } from "@/sim/constants";

/** Versión de pista y de física anterior a la vigente: lo que dejaría una copia guardada antes del cambio. */
const ANTIGUA = { trackVersion: 0, physicsVersion: PHYSICS_VERSION - 1 };
const PISTAS = ["cordillera", "rampa"] as const;
const POR_PISTA = 3;

type Mapa = Record<string, unknown>;

/** Tres entradas por pista en cordillera y rampa, con marcas inventadas y versión anterior; la migración las vuelve a medir. */
export async function rankingsVersionAnterior(): Promise<Mapa> {
  const demo = JSON.parse((await import("./rankings-demo.texto")).default) as Record<string, Mapa[]>;
  const out: Mapa = {};
  for (const id of PISTAS) out[id] = demo[id].slice(0, POR_PISTA).map((e) => ({ ...e, ...ANTIGUA }));
  return out;
}

/** Los dos primeros coches del ranking de cordillera, con marca y sin versión (como los guardaba la versión anterior). */
export async function garajeVersionAnterior(): Promise<Mapa[]> {
  const demo = JSON.parse((await import("./rankings-demo.texto")).default) as Record<string, Mapa[]>;
  return demo.cordillera.slice(0, 2).map((e, i) => ({
    id: e.carId,
    name: `Diseño ${i + 1}`,
    genome: e.genome,
    marks: { cordillera: 100 + i * 10 },
    origin: "diseño",
    savedAt: "2026-10-01T10:00:00.000Z",
  }));
}

/** El archivo de rampa de la demo de especies, con la versión anterior. */
export async function especiesVersionAnterior(): Promise<Mapa> {
  const demo = JSON.parse((await import("./especies-demo.texto")).default) as Record<string, Mapa>;
  return { rampa: { ...demo.rampa, ...ANTIGUA } };
}
