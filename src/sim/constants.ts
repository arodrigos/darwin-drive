import type { TrackId } from "./tracks";

export const PHYSICS_VERSION = 3;
export const DT = 1 / 60;
export const MAX_STEPS = 54000; // «Tiempo máximo (15 min)»
export const META_DISTANCE = 5000;
export const STALL_STEPS = 300;
export const STALL_MIN_PROGRESS = 0.5;
export const ANOMALY_SPEED = 50;
export const ANOMALY_HEIGHT = 25;

export type EndReason = "meta" | "stall" | "timeout" | "anomaly";

export interface CarResult {
  carId: string;
  distance: number;
  reason: EndReason;
  steps: number;
  /** Primer paso en que la distancia visible (décimas) alcanzó la final: el tiempo que cuenta como «hasta la marca». */
  bestStep: number;
  /** Siempre 0 hasta que el bloque de fragilidad rompa piezas; ya forma parte de la marca para ordenar. */
  piezasPerdidas: number;
  physicsVersion: number;
  trackId: TrackId;
  trackVersion: number;
}

export interface CarPose {
  carId: string;
  x: number;
  y: number;
  angle: number;
  wheels: { x: number; y: number; angle: number; radius: number }[];
  finished: boolean;
  reason?: EndReason;
}
