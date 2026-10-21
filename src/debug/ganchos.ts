import type { CarResult } from "@/sim/constants";
import type { Genome } from "@/sim/genome";
import type { TrackId } from "@/sim/tracks";
import { latencias } from "./latencias";

export type Pantalla = "portada" | "explorar" | "evolucion-inicio" | "pista" | "taller" | "evolucion" | "garaje" | "rankings" | "linaje" | "especies";

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
  // Taller, garaje e inscripción (los publica App).
  genomaEnTaller: null as Genome | null,
  garaje: 0,
  ultimaInscripcion: null as { trackId: TrackId; position: number | null; alreadyAt: number | null; isRecord: boolean } | null,
  // Evolución en curso (la rellena Evolucion).
  generacion: null as number | null,
  poblacion: null as { carId: string; genome: Genome }[] | null,
  distanciasGeneracion: null as Record<string, number> | null,
  favoritos: null as string[] | null,
  // Ritmo de la pantalla con carrera (Pista o Evolución) y el que logra de verdad el dispositivo.
  ritmo: null as string | null,
  ritmoReal: null as number | null,
  pausada: false,
  /** Pantalla cuyo panel de ayuda está abierto; null si ninguno. */
  ayudaAbierta: null as string | null,
  guia: { abierta: false, seccion: null as string | null, origen: null as string | null },
  /** Tope de velocidad simulada de pruebas; lo reaplican los ejecutores nuevos. */
  limiteRitmo: null as number | null,
  /** La pantalla con carrera lo registra para que el tope llegue a su ejecutor. */
  aplicarLimite: null as ((max: number | null) => void) | null,
  /** Avanza la carrera en curso al instante; resuelve con el efecto ya pintado. Solo existe mientras hay una pista abierta. */
  avanzar: null as ((segundos: number) => Promise<void>) | null,
  /** Migración de marcas: la publica el hook; `frenada` retiene la cola entre un elemento y el siguiente. */
  migracion: null as { enCurso: boolean; hechos: number; total: number; enVuelo: string | null; intentos: Record<string, number> } | null,
  migracionFrenada: false,
  /** Solo pruebas (?pestanas=antiguas): finge que hay una pestaña de versión anterior abierta. */
  pestanasAntiguasFingidas: false,
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
    generacion: runtime.generacion,
    // Añadidos al contrato por evolucion-ui: la población que corre y las distancias de la generación que acaba de terminar.
    poblacion: runtime.poblacion,
    distanciasGeneracion: runtime.distanciasGeneracion,
    favoritos: runtime.favoritos,
    rankings: runtime.rankings,
    ultimaInscripcion: runtime.ultimaInscripcion,
    genomaEnPista: runtime.genomaEnPista,
    genomaEnTaller: runtime.genomaEnTaller,
    ultimoResultado: runtime.ultimoResultado,
    // Añadidos al contrato por pista-carrera: la pausa de pestaña y el ejecutor activo se prueban con ellos.
    tiempoSim: runtime.tiempoSim,
    ritmo: runtime.ritmo,
    ritmoReal: runtime.ritmoReal,
    pausada: runtime.pausada,
    ayudaAbierta: runtime.ayudaAbierta,
    guia: runtime.guia,
    ejecutor: runtime.ejecutor,
    garaje: runtime.garaje,
    persistente: runtime.persistente,
    disponible: runtime.disponible,
    migracion: {
      enCurso: runtime.migracion?.enCurso ?? false,
      hechos: runtime.migracion?.hechos ?? 0,
      total: runtime.migracion?.total ?? 0,
      enVuelo: runtime.migracion?.enVuelo ?? null,
      intentos: runtime.migracion?.intentos ?? {},
    },
  };
}

const ESCENARIOS_SOPORTADOS = new Set(["vacio", "pista", "rankings", "garaje", "genoma", "evolucion", "linaje", "especies", "migracion"]);

export interface Gancho {
  latencias: typeof latencias;
  estado: typeof estado;
  cargarEscenario(e: Escenario): Promise<void>;
  adelantarSimulacion(segundos: number): Promise<void>;
  /** Acota la velocidad simulada a N veces el tiempo real para imitar un dispositivo lento (null lo quita). No cambia ningún CarResult. */
  limitarRitmo(max: number | null): void;
  /** true retiene la cola de migración antes de la siguiente medida; false la suelta. */
  frenarMigracion(frenar: boolean): void;
  /** pw-4 y pw-5: el service worker real, sin esperar a un despliegue. */
  pwa: { readonly controlado: boolean; forzarVersionNueva(): Promise<void> };
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
  // Para ver la banda a medias sin carreras: la cola arranca retenida hasta frenarMigracion(false).
  runtime.migracionFrenada = new URLSearchParams(window.location.search).get("migracion") === "frenada";
  runtime.pestanasAntiguasFingidas = new URLSearchParams(window.location.search).get("pestanas") === "antiguas";
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
    limitarRitmo(max) {
      runtime.limiteRitmo = max;
      runtime.aplicarLimite?.(max);
    },
    frenarMigracion(frenar) {
      runtime.migracionFrenada = frenar;
    },
    pwa: {
      get controlado() {
        return "serviceWorker" in navigator && navigator.serviceWorker.controller !== null;
      },
      async forzarVersionNueva() {
        await (await import("@/pwa/ganchos")).forzarVersionNueva();
      },
    },
  };
}
