import type { EntradaClip } from "./nucleo";

export type HaciaClip = { tipo: "generar"; entrada: EntradaClip };

export type MotivoClip = "no-coincide" | "sin-soporte" | "fallo";

export interface ClipListo {
  mp4: ArrayBuffer;
  codec: string;
  fotogramas: number;
  duracionS: number;
  factor: number;
  distanciaFinal: number;
  /** PNG del fotograma central. */
  muestra: ArrayBuffer;
}

export type DesdeClip =
  | { tipo: "progreso"; fraccion: number }
  | ({ tipo: "listo" } & ClipListo)
  | { tipo: "error"; motivo: MotivoClip; detalle: string };
