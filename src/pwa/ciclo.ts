import { despacharPwa, obtenerDatosPwa } from "./estado";

// Lo mínimo que se usa de @serwist/window, para probar el ciclo con un doble.
export interface SerwistVentana {
  addEventListener(tipo: "waiting", oyente: () => void): void;
  addEventListener(tipo: "controlling", oyente: () => void): void;
  register(): Promise<unknown>;
  messageSkipWaiting(): void;
}

// forzarVersionNueva (y cualquier segundo registro) deja más de una instancia
// escuchando «controlling»: sin este cerrojo cada una pediría su recarga.
let recargando = false;

// skipWaiting está a false en el worker: una versión nueva solo toma el mando
// cuando el jugador pulsa Recargar, nunca a mitad de una evolución.
export function conectarCiclo(sw: SerwistVentana, recargar: () => void): void {
  sw.addEventListener("waiting", () => despacharPwa("esperando"));
  sw.addEventListener("controlling", () => {
    despacharPwa("controlando");
    if (!recargando && obtenerDatosPwa().recargaPedida) {
      recargando = true;
      recargar();
    }
  });
}

export function pulsarRecargar(sw: SerwistVentana): void {
  despacharPwa("recargar");
  sw.messageSkipWaiting();
}
