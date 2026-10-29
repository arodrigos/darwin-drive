import type { CarPose } from "@/sim/constants";
import { STOCK_CAR, type Genome } from "@/sim/genome";
import { createRace } from "@/sim/race";
import type { TrackId } from "@/sim/tracks";

/**
 * Pose t=0 de los coches, calculada en el hilo principal con el mismo núcleo que el Worker (determinista,
 * así su primera pose coincide y no hay salto). Permite dibujar el coche en el primer fotograma tras el
 * toque sin esperar a la ida y vuelta al Worker, cuyo mensaje se queda en cola detrás del pintado.
 */
export function poseSalida(cars: { carId: string; genome: Genome }[], trackId: TrackId): CarPose[] {
  const race = createRace(cars, trackId);
  try {
    return race.poses();
  } finally {
    race.dispose();
  }
}

/** La primera llamada cuesta ~28 ms en frío: se paga en el precalentado y no en la primera «Probar». */
export function calentarPoseSalida(): void {
  poseSalida([{ carId: "calentar", genome: STOCK_CAR }], "cordillera");
}
