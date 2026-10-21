import { PHYSICS_VERSION } from "@/sim/constants";
import { getTrack } from "@/sim/tracks";

type Mapa = Record<string, unknown>;

interface Fila {
  distance: number;
  bestStep: number;
  piezasPerdidas?: number;
  date: string;
  name?: string;
  /** Sin tiempo ni piezas: una entrada pendiente de volver a medir. */
  pendiente?: boolean;
}

/** Los genomas del ranking de demostración dan coches distintos sin inventar ninguno. */
async function filasConGenoma(filas: Fila[]): Promise<Mapa[]> {
  const demo = JSON.parse((await import("./rankings-demo.texto")).default) as Record<string, Mapa[]>;
  const pista = getTrack("cordillera")!;
  return filas.map((f, i) => {
    const base = demo.cordillera[i];
    const e: Mapa = {
      carId: base.carId,
      genome: base.genome,
      distance: f.distance,
      origin: "evolución",
      date: f.date,
      trackId: "cordillera",
      trackVersion: pista.version,
      physicsVersion: PHYSICS_VERSION,
    };
    if (!f.pendiente) {
      e.bestStep = f.bestStep;
      e.piezasPerdidas = f.piezasPerdidas ?? 0;
    }
    if (f.name) e.name = f.name;
    return e;
  });
}

/** Seis filas que empatan de tres en tres en distancia visible y se desempatan cada una por una clave distinta. */
export async function rankingsEmpates(): Promise<Mapa> {
  return {
    cordillera: await filasConGenoma([
      { distance: 812.34, bestStep: 3000, date: "2026-10-19T12:00:00.000Z" },
      { distance: 812.26, bestStep: 2500, piezasPerdidas: 1, date: "2026-10-18T12:00:00.000Z" },
      { distance: 640.0, bestStep: 2400, date: "2026-10-19T12:00:00.000Z" },
      { distance: 640.0, bestStep: 2700, date: "2026-10-17T12:00:00.000Z" },
      { distance: 500.0, bestStep: 3000, date: "2026-10-16T12:00:00.000Z" },
      { distance: 500.0, bestStep: 3000, date: "2026-10-20T12:00:00.000Z" },
    ]),
  };
}

/** Los extremos que la tabla tiene que aguantar: meta, tope de tiempo, 8 piezas, nombre de 40 caracteres y una fila pendiente. */
export async function rankingsLimites(): Promise<Mapa> {
  return {
    cordillera: await filasConGenoma([
      { distance: 5000, bestStep: 53994, date: "2026-10-15T12:00:00.000Z", name: "Nombre larguísimo de cuarenta caracteres!" },
      { distance: 5000, bestStep: 53994, date: "2026-10-16T12:00:00.000Z" },
      { distance: 4999.9, bestStep: 54000, piezasPerdidas: 8, date: "2026-10-17T12:00:00.000Z" },
      { distance: 120, bestStep: 0, date: "2026-10-18T12:00:00.000Z", pendiente: true },
    ]),
  };
}
