import { STOCK_CAR, normalizeGenome, type Genome } from "../../../src/sim/genome";
import type { Origin } from "../../../src/storage/schema";
import { seededGenomes } from "./rng";

/** Los 12 coches del escenario 'demo': semilla fija, así que el JSON es reproducible. */
export const DEMO_SEED = 4242;
export const DEMO_CARS = 12;
export const DEMO_ORIGINS: Origin[] = ["diseño", "evolución", "mixto"];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** El coche de serie y variantes suyas: un genoma totalmente al azar casi nunca avanza, y un ranking de ceros no enseña nada. */
export function demoGenomes(): Genome[] {
  const otros = seededGenomes(DEMO_SEED, DEMO_CARS - 1);
  const variantes = otros.map((o, i) => {
    const t = 0.15 + 0.03 * i;
    return normalizeGenome({
      body: STOCK_CAR.body.map((v, k) => ({ angle: lerp(v.angle, o.body[k].angle, t), length: lerp(v.length, o.body[k].length, t) })),
      bodyDensity: lerp(STOCK_CAR.bodyDensity, o.bodyDensity, t),
      wheels: STOCK_CAR.wheels.map((w, k) => ({
        vertex: w.vertex,
        radius: lerp(w.radius, o.wheels[k].radius, t),
        density: lerp(w.density, o.wheels[k].density, t),
        axisAngle: lerp(w.axisAngle, o.wheels[k].axisAngle, t),
      })),
    });
  });
  return [STOCK_CAR, ...variantes];
}

/** Fechas fijas y distintas: el escenario no depende del reloj. */
export function demoDate(i: number): string {
  return new Date(Date.UTC(2026, 9, 1 + i, 12, 0, 0)).toISOString();
}
