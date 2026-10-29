// Política de sonido: puro, sin DOM ni ZzFX, para que valga la misma prueba en Node y en el navegador.
// Decide si un evento suena; el adaptador (sonido.ts) solo ejecuta la decisión.
export type TipoSonido = "arranque" | "record" | "especie" | "vuelco";
export type RitmoSonido = "x1" | "x2" | "x4" | "x8" | "turbo";

/** Separación mínima entre dos sonidos del mismo tipo: con 32 coches evita ráfagas aunque el evento se repita. */
export const SEPARACION_MS = 1000;

export interface EstadoPolitica {
  ultimo: Partial<Record<TipoSonido, number>>;
  /** Generación de Evolución en la que ya sonó un vuelco. */
  vuelcoGeneracion: number | null;
}

export interface EventoSonido {
  tipo: TipoSonido;
  encendido: boolean;
  ritmo: RitmoSonido;
  /** Reloj monótono en ms. */
  ahora: number;
  /** Solo en Evolución: un vuelco por generación como mucho. */
  generacion?: number;
}

export function estadoInicial(): EstadoPolitica {
  return { ultimo: {}, vuelcoGeneracion: null };
}

export function decidir(estado: EstadoPolitica, e: EventoSonido): { suena: boolean; estado: EstadoPolitica } {
  if (!e.encendido || e.ritmo === "turbo") return { suena: false, estado };
  const previo = estado.ultimo[e.tipo];
  if (previo !== undefined && e.ahora - previo < SEPARACION_MS) return { suena: false, estado };
  if (e.tipo === "vuelco" && e.generacion !== undefined && estado.vuelcoGeneracion === e.generacion) return { suena: false, estado };
  return {
    suena: true,
    estado: {
      ultimo: { ...estado.ultimo, [e.tipo]: e.ahora },
      vuelcoGeneracion: e.tipo === "vuelco" && e.generacion !== undefined ? e.generacion : estado.vuelcoGeneracion,
    },
  };
}
