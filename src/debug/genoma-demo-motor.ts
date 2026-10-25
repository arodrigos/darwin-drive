import { GENE_RANGES, normalizeGenome, STOCK_CAR, type Genome } from "@/sim/genome";

/**
 * Coche de «demo-motor-rampa»: el de serie, con el peso mínimo y las dos ruedas grandes.
 * Desde que La Rampa sube hasta los 5 km, el de serie sin tocar se estrella contra un obstáculo;
 * este es el que sigue parándose contra su límite de motor, el caso peor de la tarjeta de fin.
 */
export const GENOMA_DEMO_MOTOR_RAMPA: Genome = normalizeGenome({
  ...STOCK_CAR,
  bodyDensity: GENE_RANGES.bodyDensity[0],
  wheels: STOCK_CAR.wheels.map((w, i) => (i < 2 ? { ...w, radius: 0.9 } : w)),
});
