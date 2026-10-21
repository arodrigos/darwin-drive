import { STALL_STEPS, type CausaParada } from "./constants";

/** Lo que se mira del coche en cada paso para saber, si se atasca, qué lo paró. */
export interface MuestraParada {
  /** Pendiente del suelo donde el coche llegó más lejos, en grados; positiva cuesta arriba. */
  pendiente: number;
  /** 0..1: cuánto de lo que giran las ruedas apoyadas no se convierte en avance. */
  patinaje: number;
  ruedasEnContacto: number;
  /** La carrocería toca el suelo. */
  carroceriaEnContacto: boolean;
  /** Ángulo de la carrocería en radianes, normalizado a (−π, π]. */
  angulo: number;
  /** Carga media de las ruedas, 0..1. */
  carga: number;
}

export const UMBRAL_VUELCO_GRADOS = 100;
export const UMBRAL_MOTOR_GRADOS = 33;
const UMBRAL_VUELCO_FRACCION = 0.5;
const UMBRAL_SIN_APOYO_FRACCION = 0.8;
const UMBRAL_PANZA_FRACCION = 0.5;
const UMBRAL_PANZA_CARGA = 0.5;
const UMBRAL_AGARRE = 0.5;
/** Suavizado exponencial de la carga de rueda: lo bastante lento para que un bote no parpadee. */
export const ALFA_CARGA = 0.2;

/** Búfer circular de las últimas STALL_STEPS muestras: el tramo en que el coche no avanzó. */
export class BufferParada {
  private readonly datos: MuestraParada[] = Array.from({ length: STALL_STEPS }, () => ({
    pendiente: 0,
    patinaje: 0,
    ruedasEnContacto: 0,
    carroceriaEnContacto: false,
    angulo: 0,
    carga: 0,
  }));
  private siguiente = 0;
  private lleno = 0;

  /** Reutiliza la ranura más antigua para no crear un objeto por paso. */
  anotar(m: MuestraParada): void {
    Object.assign(this.datos[this.siguiente], m);
    this.siguiente = (this.siguiente + 1) % STALL_STEPS;
    if (this.lleno < STALL_STEPS) this.lleno++;
  }

  muestras(): MuestraParada[] {
    return this.datos.slice(0, this.lleno);
  }
}

export interface Diagnostico {
  causa: CausaParada;
  pendiente: number;
}

const fraccion = (m: MuestraParada[], cumple: (x: MuestraParada) => boolean): number => (m.length === 0 ? 0 : m.filter(cumple).length / m.length);
const media = (m: MuestraParada[], f: (x: MuestraParada) => number): number => (m.length === 0 ? 0 : m.reduce((a, x) => a + f(x), 0) / m.length);

/** Prioridad: vuelco > sin-apoyo > panza > motor > agarre > obstáculo. Pura: mismas muestras, misma causa. */
export function clasificarParada(muestras: MuestraParada[]): Diagnostico {
  const pendiente = Math.max(-90, Math.min(90, media(muestras, (x) => x.pendiente)));
  const limite = (UMBRAL_VUELCO_GRADOS * Math.PI) / 180;
  if (fraccion(muestras, (x) => Math.abs(x.angulo) > limite) > UMBRAL_VUELCO_FRACCION) return { causa: "vuelco", pendiente };
  if (fraccion(muestras, (x) => x.ruedasEnContacto === 0) >= UMBRAL_SIN_APOYO_FRACCION) return { causa: "sin-apoyo", pendiente };
  if (fraccion(muestras, (x) => x.carroceriaEnContacto && x.carga < UMBRAL_PANZA_CARGA) >= UMBRAL_PANZA_FRACCION) return { causa: "panza", pendiente };
  if (pendiente >= UMBRAL_MOTOR_GRADOS) return { causa: "motor", pendiente };
  if (media(muestras, (x) => x.patinaje) >= UMBRAL_AGARRE) return { causa: "agarre", pendiente };
  return { causa: "obstaculo", pendiente };
}
