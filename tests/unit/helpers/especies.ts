import { integrateBatch, planBatch, emptyArchive, type SpeciesArchive } from "../../../src/evolution/species";
import { createRace } from "../../../src/sim/race";
import type { TrackId } from "../../../src/sim/tracks";

/** Corre de verdad (física real) `lotes` lotes de exploración en una pista y devuelve el archivo resultante. */
export function explorar(trackId: TrackId, seed: number, lotes: number): SpeciesArchive {
  let archive = emptyArchive(trackId, seed);
  for (let i = 0; i < lotes; i++) {
    const plan = planBatch(archive);
    const race = createRace(
      plan.cars.map((c) => ({ carId: c.carId, genome: c.genome })),
      trackId,
    );
    while (!race.done()) race.step(120);
    const results = race.results();
    race.dispose();
    archive = integrateBatch(plan.archive, plan.cars, results);
  }
  return archive;
}
