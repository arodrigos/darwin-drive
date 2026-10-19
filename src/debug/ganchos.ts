import type { CarResult } from "@/sim/constants";
import type { Genome } from "@/sim/genome";
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
  rankings: { cordillera: [], rampa: [], dunas: [], pedregal: [] } as Record<TrackId, { carId: string; distance: number; origin: string }[]>,
  // Carrera en pantalla (la rellena Pista).
  pistaEnCarrera: null as TrackId | null,
  distanciaLider: null as number | null,
  cochesVivos: 0,
  genomaEnPista: null as Genome | null,
  ultimoResultado: null as CarResult | null,
  tiempoSim: null as number | null,
  ejecutor: null as "worker" | "en-linea" | null,
  /** Avanza la carrera en curso al instante; resuelve con el efecto ya pintado. Solo existe mientras hay una pista abierta. */
  avanzar: null as ((segundos: number) => Promise<void>) | null,
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
    pistaEnCarrera: runtime.pistaEnCarrera,
    distanciaLider: runtime.distanciaLider,
    cochesVivos: runtime.cochesVivos,
    // Lo que sigue lo rellenan los bloques de taller, rankings y evolución.
    generacion: null as number | null,
    rankings: runtime.rankings,
    ultimaInscripcion: null,
    genomaEnPista: runtime.genomaEnPista,
    genomaEnTaller: null,
    ultimoResultado: runtime.ultimoResultado,
    // Añadidos al contrato por pista-carrera: la pausa de pestaña y el ejecutor activo se prueban con ellos.
    tiempoSim: runtime.tiempoSim,
    ejecutor: runtime.ejecutor,
    garaje: 0,
    persistente: runtime.persistente,
    disponible: runtime.disponible,
  };
}

const ESCENARIOS_SOPORTADOS = new Set(["vacio", "pista", "rankings"]);

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
    async adelantarSimulacion(segundos) {
      await runtime.avanzar?.(segundos);
    },
  };
}
