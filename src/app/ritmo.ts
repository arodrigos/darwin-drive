import { MULTIPLIER, type Pace } from "@/worker/protocol";

/** Por debajo de esta fracción del ritmo pedido se considera que el dispositivo no llega. */
export const UMBRAL_RITMO = 0.9;
/** Tiempo seguido por debajo del umbral antes de avisar: un tropiezo suelto no merece rótulo. */
export const ESPERA_AVISO_MS = 2000;

export interface AvisoRitmo {
  /** Instante en que empezó a ir por debajo del umbral, o null si va bien. */
  desde: number | null;
  /** N de «real ×N» mientras haya que enseñarlo. */
  rotulo: number | null;
}

export const SIN_AVISO: AvisoRitmo = { desde: null, rotulo: null };

export const ETIQUETA_RITMO: Record<Pace, string> = { x1: "×1", x2: "×2", x4: "×4", x8: "×8", turbo: "Turbo" };

/**
 * Nuevo estado del aviso «real ×N» tras una medida del motor. Pura: el reloj entra por
 * `ahora`, así la regla de los 2 s se prueba sin esperar.
 */
export function actualizarAviso(prev: AvisoRitmo, pace: Pace, ritmoReal: number | undefined, ahora: number): AvisoRitmo {
  if (pace === "turbo" || ritmoReal === undefined) return pace === "turbo" ? SIN_AVISO : prev;
  if (ritmoReal >= MULTIPLIER[pace] * UMBRAL_RITMO) return SIN_AVISO;
  const desde = prev.desde ?? ahora;
  const n = Math.max(1, Math.round(ritmoReal));
  if (ahora - desde >= ESPERA_AVISO_MS) return { desde, rotulo: n };
  return { desde, rotulo: prev.rotulo };
}
