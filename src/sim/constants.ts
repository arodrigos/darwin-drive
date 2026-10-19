import type { TrackId } from "./tracks";

export const PHYSICS_VERSION = 1;
export const DT = 1 / 60;
export const MAX_STEPS = 10800;
export const STALL_STEPS = 300;
export const STALL_MIN_PROGRESS = 0.5;
export const ANOMALY_SPEED = 50;
export const ANOMALY_HEIGHT = 25;

export type EndReason = "stall" | "timeout" | "anomaly";

export interface CarResult {
  carId: string;
  distance: number;
  reason: EndReason;
  steps: number;
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
