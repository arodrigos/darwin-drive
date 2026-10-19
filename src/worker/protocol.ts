import type { CarPose, CarResult } from "../sim/constants";
import type { Genome } from "../sim/genome";
import type { TrackId } from "../sim/tracks";

export type Pace = "x1" | "x4" | "turbo";

export type ToWorker =
  | { type: "startRace"; raceId: string; cars: { carId: string; genome: Genome }[]; trackId: TrackId; pace: Pace }
  | { type: "setPace"; raceId: string; pace: Pace }
  | { type: "pause" | "resume" | "stop"; raceId: string }
  | { type: "advance"; raceId: string; seconds: number };

export type FromWorker =
  /** 30 Hz salvo en turbo. */
  | { type: "poses"; raceId: string; simTime: number; poses: CarPose[] }
  | { type: "carFinished"; raceId: string; result: CarResult }
  | { type: "progress"; raceId: string; finished: number; total: number }
  | { type: "raceDone"; raceId: string; results: CarResult[] }
  | { type: "error"; raceId: string; message: string };

/** Mismo contrato para el Worker real y para la alternativa en línea. */
export interface SimRunner {
  readonly kind: "worker" | "en-linea";
  post(msg: ToWorker): void;
  subscribe(listener: (msg: FromWorker) => void): () => void;
  terminate(): void;
}
