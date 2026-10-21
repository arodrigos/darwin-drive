import type { TrackId } from "./tracks";

export const PHYSICS_VERSION = 3;
export const DT = 1 / 60;
export const MAX_STEPS = 54000; // «Tiempo máximo (15 min)»
export const META_DISTANCE = 5000;
/** Pendiente que el coche debe poder subir parado: fija el par del motor (y lo que dice la guía sobre el límite). */
export const TORQUE_SLOPE_DEG = 35;
export const STALL_STEPS = 300;
export const STALL_MIN_PROGRESS = 0.5;
export const ANOMALY_SPEED = 50;
export const ANOMALY_HEIGHT = 25;

export type EndReason = "meta" | "stall" | "timeout" | "anomaly";

/** Por qué se paró un coche atascado; «rotura» la pone el bloque de fragilidad, no el diagnóstico de la cuesta. */
export type CausaParada = "motor" | "agarre" | "vuelco" | "panza" | "sin-apoyo" | "obstaculo" | "rotura";

export const CAUSAS_PARADA: readonly CausaParada[] = ["motor", "agarre", "vuelco", "panza", "sin-apoyo", "obstaculo", "rotura"];

export interface CarResult {
  carId: string;
  distance: number;
  reason: EndReason;
  steps: number;
  /** Primer paso en que la distancia visible (décimas) alcanzó la final: el tiempo que cuenta como «hasta la marca». */
  bestStep: number;
  /** Siempre 0 hasta que el bloque de fragilidad rompa piezas; ya forma parte de la marca para ordenar. */
  piezasPerdidas: number;
  /** Solo con reason === "stall": qué paró al coche; null en el resto de finales. */
  causaParada: CausaParada | null;
  /** Pendiente media del suelo bajo el coche mientras estuvo parado, en grados (+ cuesta arriba); null si no se paró. */
  pendienteParada: number | null;
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
  /** Carga suavizada de cada rueda (0..1, 1 = lleva lo que le toca del peso); mismo orden que `wheels`. */
  cargas?: number[];
  finished: boolean;
  reason?: EndReason;
}
