// Genera los escenarios de demostración con el propio núcleo: marcas reales, no inventadas.
// Uso: npm run generar:escenarios (y el test de Node los vuelve a simular y comprueba que coinciden).
import { escribirEscenario } from "./escribir-escenario";
import { PHYSICS_VERSION } from "../src/sim/constants";
import { genomeHash } from "../src/sim/genome";
import { simulateCar } from "../src/sim/race";
import { TRACKS } from "../src/sim/tracks";
import type { RankingEntry } from "../src/storage/schema";
import { normalizeRanking, RANKING_SIZE } from "../src/storage/schema";
import { demoGenomes, DEMO_ORIGINS, demoDate } from "../tests/unit/helpers/demo-rankings";

const rankings: Record<string, RankingEntry[]> = {};
const genomes = demoGenomes();
for (const t of TRACKS) {
  const entries: RankingEntry[] = [];
  genomes.forEach((genome, i) => {
    const r = simulateCar(genome, t.id);
    if (r.reason === "anomaly") return;
    entries.push({
      carId: genomeHash(genome),
      genome,
      genomeHash: genomeHash(genome),
      distance: r.distance,
      bestStep: r.bestStep,
      piezasPerdidas: r.piezasPerdidas,
      origin: DEMO_ORIGINS[i % DEMO_ORIGINS.length],
      date: demoDate(i),
      trackId: t.id,
      trackVersion: t.version,
      physicsVersion: PHYSICS_VERSION,
    });
  });
  // El orden único del juego (compararMarcas): sin empates posibles.
  rankings[t.id] = normalizeRanking(entries);
  if (rankings[t.id].length < RANKING_SIZE) throw new Error(`${t.id}: solo ${rankings[t.id].length} marcas válidas`);
}
escribirEscenario(new URL("../src/debug/escenarios/rankings-demo.json", import.meta.url), rankings);
