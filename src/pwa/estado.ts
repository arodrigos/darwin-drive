export interface DatosPwa {
  /** Hay un service worker nuevo instalado y sin activar. */
  readonly esperando: boolean;
  /** El jugador tocó Recargar tras el último aviso: única condición en la que la página puede recargarse. */
  readonly recargaPedida: boolean;
}

export type EventoPwa = "esperando" | "controlando" | "recargar";

export const DATOS_PWA_INICIALES: DatosPwa = { esperando: false, recargaPedida: false };

// Reductor puro: nunca recarga nada, solo anota si el jugador lo pidió.
export function reducirEstadoPwa(datos: DatosPwa, evento: EventoPwa): DatosPwa {
  switch (evento) {
    case "esperando":
      return { esperando: true, recargaPedida: false };
    case "controlando":
      return datos.esperando ? { ...datos, esperando: false } : datos;
    case "recargar":
      return { ...datos, recargaPedida: true };
  }
}

let datos: DatosPwa = DATOS_PWA_INICIALES;
const oyentes = new Set<() => void>();

export function obtenerDatosPwa(): DatosPwa {
  return datos;
}

export function suscribirPwa(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

export function despacharPwa(evento: EventoPwa): void {
  const siguiente = reducirEstadoPwa(datos, evento);
  if (siguiente === datos) return;
  datos = siguiente;
  for (const oyente of [...oyentes]) oyente();
}
