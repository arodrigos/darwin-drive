import type { CarPose, CarResult, FuerzasMuestra } from "../sim/constants";
import type { Genome } from "../sim/genome";
import type { TrackId } from "../sim/tracks";

export type Pace = "x1" | "x2" | "x4" | "x8" | "turbo";

/** Múltiplo de tiempo real de cada ritmo con reloj; vive aquí para que la interfaz no importe el motor (y con él la física). */
export const MULTIPLIER: Record<Exclude<Pace, "turbo">, number> = { x1: 3, x2: 6, x4: 12, x8: 24 };

export type ToWorker =
  | { type: "startRace"; raceId: string; cars: { carId: string; genome: Genome }[]; trackId: TrackId; pace: Pace; fantasma?: { carId: string; genome: Genome } }
  | { type: "setPace"; raceId: string; pace: Pace }
  /** Capa «Fuerzas»: encendida, las poses llevan la muestra del coche líder; apagada no se calcula nada. Vale para las carreras siguientes. */
  | { type: "setFuerzas"; raceId: string; on: boolean }
  | { type: "pause" | "resume" | "stop"; raceId: string }
  | { type: "advance"; raceId: string; seconds: number }
  /** Solo pruebas: tope de velocidad simulada (en múltiplos de tiempo real) para imitar un dispositivo lento; null lo quita. Vale para todas las carreras. */
  | { type: "limitRate"; max: number | null };

export type FromWorker =
  /** 30 Hz salvo en turbo. `ritmoReal` es el múltiplo de tiempo real que el dispositivo está logrando de verdad. */
  | { type: "poses"; raceId: string; simTime: number; poses: CarPose[]; ritmoReal?: number; fuerzas?: FuerzasMuestra; fantasma?: CarPose }
  | { type: "carFinished"; raceId: string; result: CarResult }
  | { type: "progress"; raceId: string; finished: number; total: number; leaderX?: number; simTime?: number; ritmoReal?: number }
  | { type: "raceDone"; raceId: string; results: CarResult[] }
  /** El coche del récord ha terminado, una sola vez; nunca entra en `results`, `carFinished` ni `progress`. */
  | { type: "fantasmaFin"; raceId: string; result: CarResult }
  | { type: "error"; raceId: string; message: string };

/** Mismo contrato para el Worker real y para la alternativa en línea. */
export interface SimRunner {
  readonly kind: "worker" | "en-linea";
  post(msg: ToWorker): void;
  subscribe(listener: (msg: FromWorker) => void): () => void;
  terminate(): void;
}
