import type { CriterioBatalla, ResultadoCrudo } from "./estado";
import type { CarPose, CarResult } from "@/sim/constants";

/** Cada jugador corre con un id propio: dos diseños iguales tendrían el mismo hash y se pisarían en el Worker. */
export const idCocheBatalla = (jugador: number): string => `jugador-${jugador}`;
export const jugadorDeCoche = (carId: string): number => Number(carId.slice("jugador-".length));

export interface FilaMarcador {
  jugador: number;
  distancia: number;
  parado: boolean;
}

/** Marcador en vivo: más lejos primero y, a igual distancia, el orden de la mesa (nunca baila entre frames). */
export function filasMarcador(poses: CarPose[], maximos: Map<number, number>): FilaMarcador[] {
  const filas = poses.map((p) => {
    const jugador = jugadorDeCoche(p.carId);
    const distancia = Math.max(maximos.get(jugador) ?? 0, p.x);
    maximos.set(jugador, distancia);
    return { jugador, distancia, parado: p.finished };
  });
  return filas.sort((a, b) => b.distancia - a.distancia || a.jugador - b.jugador);
}

export interface FlechaBorde {
  jugador: number;
  /** Metros que le saca el líder. */
  falta: number;
}

/** Los coches que quedan detrás del borde izquierdo, con lo que les saca el líder («Bea −34 m»). */
export function flechasBorde(filas: FilaMarcador[], fuera: Set<number>): FlechaBorde[] {
  if (filas.length === 0) return [];
  const lider = filas[0].distancia;
  return filas.filter((f) => fuera.has(f.jugador)).map((f) => ({ jugador: f.jugador, falta: Math.max(0, lider - f.distancia) }));
}

/** El resultado del Worker, con el id del jugador, en la forma que espera la máquina de estados. */
export function resultadoCrudo(r: CarResult): ResultadoCrudo {
  return { jugador: jugadorDeCoche(r.carId), distance: r.distance, bestStep: r.bestStep, piezasPerdidas: r.piezasPerdidas, reason: r.reason };
}

export const TEXTO_CRITERIO: Record<CriterioBatalla, string> = {
  distancia: "por distancia",
  entero: "por coche entero",
  tiempo: "por tiempo",
  empate: "empate",
};

/** Aviso tras «Guardar todos»: cuenta lo que se guardó de verdad, no lo que se pidió. */
export function avisoGuardado(guardados: number, yaEstaban: number, sinSitio: number): string {
  const partes: string[] = [];
  partes.push(guardados === 1 ? "1 coche guardado en el garaje" : `${guardados} coches guardados en el garaje`);
  if (yaEstaban > 0) partes.push(yaEstaban === 1 ? "1 ya estaba" : `${yaEstaban} ya estaban`);
  if (sinSitio > 0) partes.push(sinSitio === 1 ? "1 no cabe: el garaje está lleno" : `${sinSitio} no caben: el garaje está lleno`);
  return partes.join(" · ");
}
