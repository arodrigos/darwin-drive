import type { TrackId } from "./tracks";

export const PHYSICS_VERSION = 4;
export const DT = 1 / 60;
export const MAX_STEPS = 54000; // «Tiempo máximo (15 min)»
export const META_DISTANCE = 5000;
/** Pendiente que el coche debe poder subir parado: fija el par del motor (y lo que dice la guía sobre el límite). */
export const TORQUE_SLOPE_DEG = 35;
export const STALL_STEPS = 300;
export const STALL_MIN_PROGRESS = 0.5;
export const ANOMALY_SPEED = 50;
export const ANOMALY_HEIGHT = 25;

export type EndReason = "meta" | "stall" | "timeout" | "anomaly" | "destrozado";

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
  /** Triángulos de la carrocería que se rompieron (0..8); forma parte de la marca para ordenar. */
  piezasPerdidas: number;
  /** Distancia alcanzada cuando se rompió la primera pieza; null si no se rompió ninguna. */
  metroRotura: number | null;
  /** Con «stall» (y «destrozado», que es «rotura»): qué paró al coche; null en el resto de finales. */
  causaParada: CausaParada | null;
  /** Pendiente media del suelo bajo el coche mientras estuvo parado, en grados (+ cuesta arriba); null si no se paró. */
  pendienteParada: number | null;
  physicsVersion: number;
  trackId: TrackId;
  trackVersion: number;
}

/** Lo que sienten las ruedas de un coche en un instante (solo lectura del mundo; mismo orden que `CarPose.wheels`). */
export interface FuerzasMuestra {
  carId: string;
  ruedas: {
    /** Fuerza de reacción de la articulación de la rueda, en N (ejes del mundo: x hacia delante, y hacia arriba). */
    fx: number;
    fy: number;
    /** Par de reacción y par del motor, en N·m. */
    par: number;
    parMotor: number;
    /** false si la rueda ya no está unida al coche. */
    activa: boolean;
  }[];
}

export interface CarPose {
  carId: string;
  x: number;
  y: number;
  angle: number;
  wheels: { x: number; y: number; angle: number; radius: number; suelta?: boolean; fuera?: boolean }[];
  /** Máscara de 8 bits: bit i a 1 mientras el triángulo i sigue en la carrocería. */
  piezas?: number;
  /** Triángulos sueltos que aún existen. */
  sueltas?: { i: number; x: number; y: number; angle: number }[];
  /** Roturas ocurridas desde la última pose leída (para el destello). */
  roturas?: { i: number; x: number; y: number }[];
  /** Carga suavizada de cada rueda (0..1, 1 = lleva lo que le toca del peso); mismo orden que `wheels`. */
  cargas?: number[];
  finished: boolean;
  reason?: EndReason;
}
