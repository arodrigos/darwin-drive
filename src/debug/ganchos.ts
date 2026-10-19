import type { TrackId } from "@/sim/tracks";
import { latencias } from "./latencias";

export type Pantalla = "portada" | "pista" | "taller" | "evolucion" | "garaje" | "rankings" | "linaje" | "especies";

// Estado que la app publica para los ganchos. Se lee, nunca se recalcula aquí.
export const runtime = {
  pantalla: "portada" as Pantalla,
  camaraX: 0,
  tramosGenerados: 0,
  pistaSeleccionada: "cordillera" as TrackId,
  disponible: true,
  persistente: "unknown" as boolean | "unknown",
};

export interface Escenario {
  vacio?: true;
  pista?: TrackId;
  [otro: string]: unknown;
}

interface Manejadores {
  cargarEscenario(e: Escenario): Promise<void>;
}

let manejadores: Manejadores | null = null;

export function registrarManejadores(m: Manejadores): void {
  manejadores = m;
}

export function estado() {
  return {
    pantalla: runtime.pantalla,
    camaraX: runtime.camaraX,
    tramosGenerados: runtime.tramosGenerados,
    pistaSeleccionada: runtime.pistaSeleccionada,
    // Lo que sigue lo rellenan los bloques de carrera, rankings y evolución.
    pistaEnCarrera: null as TrackId | null,
    distanciaLider: null as number | null,
    cochesVivos: 0,
    generacion: null as number | null,
    rankings: { cordillera: [], rampa: [], dunas: [], pedregal: [] } as Record<TrackId, never[]>,
    ultimaInscripcion: null,
    genomaEnPista: null,
    genomaEnTaller: null,
    ultimoResultado: null,
    garaje: 0,
    persistente: runtime.persistente,
    disponible: runtime.disponible,
  };
}

const ESCENARIOS_SOPORTADOS = new Set(["vacio", "pista"]);

export interface Gancho {
  latencias: typeof latencias;
  estado: typeof estado;
  cargarEscenario(e: Escenario): Promise<void>;
  adelantarSimulacion(segundos: number): Promise<void>;
}

declare global {
  interface Window {
    __debug?: Gancho;
  }
}

/** Solo con ?pruebas=1: en el juego normal no existe window.__debug. */
export function instalarGanchos(): void {
  if (typeof window === "undefined") return;
  if (new URLSearchParams(window.location.search).get("pruebas") !== "1") return;
  window.__debug = {
    latencias,
    estado,
    async cargarEscenario(e) {
      const desconocidas = Object.keys(e).filter((k) => !ESCENARIOS_SOPORTADOS.has(k));
      if (desconocidas.length > 0) {
        throw new Error(`escenario no disponible todavía: ${desconocidas.join(", ")}`);
      }
      if (!manejadores) throw new Error("la app aún no ha arrancado");
      await manejadores.cargarEscenario(e);
    },
    // Todavía no hay carreras que adelantar; el bloque de la carrera lo conecta.
    async adelantarSimulacion() {},
  };
}
