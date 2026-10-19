import { GENE_RANGES, VERTEX_COUNT, normalizeGenome, type Genome } from "../sim/genome";

// Lógica pura del editor del Taller: sin Phaser ni DOM, para probarla en Node.
// Todo lo que sale de aquí pasa por normalizeGenome: el editor no puede emitir
// un genoma fuera de GENE_RANGES.

export const MAX_WHEELS = 4;
export const LENGTH_STEP = 0.1;
export const DEFAULT_WHEEL_RADIUS = 0.5;
const TAU = 2 * Math.PI;

const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

/** Lleva un punto (en metros, y hacia arriba, origen en el centro del coche) al vértice i, dentro de su sector. */
export function moveVertex(genome: Genome, index: number, x: number, y: number): Genome {
  if (!Number.isInteger(index) || index < 0 || index >= VERTEX_COUNT || !Number.isFinite(x) || !Number.isFinite(y)) {
    return normalizeGenome(genome);
  }
  const [lo, hi] = GENE_RANGES.angle(index);
  const centre = (lo + hi) / 2;
  const half = (hi - lo) / 2;
  // Distancia angular firmada al centro del sector, en (-π, π]: el punto cae en el borde más cercano.
  let d = wrap(Math.atan2(y, x)) - centre;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  const angle = centre + Math.max(-half, Math.min(half, d));
  const [minLen, maxLen] = GENE_RANGES.length;
  const raw = Math.round(Math.hypot(x, y) / LENGTH_STEP) * LENGTH_STEP;
  const length = Math.max(minLen, Math.min(maxLen, raw));
  const body = genome.body.map((v, i) => (i === index ? { angle, length } : v));
  return normalizeGenome({ ...genome, body });
}

export function wheelAt(genome: Genome, vertex: number): number {
  return genome.wheels.findIndex((w) => w.vertex === vertex);
}

export function wheelCount(genome: Genome): number {
  return genome.wheels.filter((w) => w.vertex >= 0).length;
}

/** Tocar un vértice con rueda la quita; sin rueda, la pone en un hueco libre (hasta 4). */
export function toggleWheel(genome: Genome, vertex: number): { genome: Genome; slot: number | null } {
  const g = normalizeGenome(genome);
  const existing = wheelAt(g, vertex);
  if (existing >= 0) {
    return { genome: normalizeGenome({ ...g, wheels: g.wheels.map((w, i) => (i === existing ? { ...w, vertex: -1 } : w)) }), slot: null };
  }
  const free = g.wheels.findIndex((w) => w.vertex < 0);
  if (free < 0 || vertex < 0 || vertex >= VERTEX_COUNT) return { genome: g, slot: null };
  const wheels = g.wheels.map((w, i) => (i === free ? { ...w, vertex, radius: DEFAULT_WHEEL_RADIUS } : w));
  return { genome: normalizeGenome({ ...g, wheels }), slot: free };
}

export function setWheelRadius(genome: Genome, slot: number, radius: number): Genome {
  return normalizeGenome({ ...genome, wheels: genome.wheels.map((w, i) => (i === slot ? { ...w, radius } : w)) });
}

/** La dirección de la suspensión es el ángulo del eje del amortiguador de esa rueda. */
export function setWheelAxis(genome: Genome, slot: number, axisAngle: number): Genome {
  return normalizeGenome({ ...genome, wheels: genome.wheels.map((w, i) => (i === slot ? { ...w, axisAngle } : w)) });
}

export function setBodyDensity(genome: Genome, density: number): Genome {
  return normalizeGenome({ ...genome, bodyDensity: density });
}
