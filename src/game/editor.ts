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

export const ANGLE_STEP = Math.PI / 180;
export const TAMANO_STEP = 0.1;

const redondear = (v: number, decimales: number) => Math.round(v * 10 ** decimales) / 10 ** decimales;

/** Ruedas encendidas: las apagadas no cuentan para el tamaño. */
function ruedasActivas(g: Genome) {
  return g.wheels.filter((w) => w.vertex >= 0);
}

/** Rango [fmin, fmax] del factor de escala que deja todas las longitudes y radios dentro de GENE_RANGES. */
export function factorPermitido(genome: Genome): [number, number] {
  const g = normalizeGenome(genome);
  const [minLen, maxLen] = GENE_RANGES.length;
  const [minR, maxR] = GENE_RANGES.radius;
  const largos = g.body.map((v) => v.length);
  const radios = ruedasActivas(g).map((w) => w.radius);
  let fmin = minLen / Math.min(...largos);
  let fmax = maxLen / Math.max(...largos);
  if (radios.length > 0) {
    fmin = Math.max(fmin, minR / Math.min(...radios));
    fmax = Math.min(fmax, maxR / Math.max(...radios));
  }
  // Un genoma recién normalizado cumple fmin ≤ 1 ≤ fmax; el máx/mín protege del redondeo de la división.
  return [Math.min(fmin, 1), Math.max(fmax, 1)];
}

/** Multiplica todas las longitudes y los radios de las ruedas encendidas: la forma (los ángulos) no cambia. */
export function escalarCoche(genome: Genome, factor: number): Genome {
  const g = normalizeGenome(genome);
  const [fmin, fmax] = factorPermitido(g);
  if (!Number.isFinite(factor) || factor < fmin || factor > fmax) return g;
  return normalizeGenome({
    ...g,
    body: g.body.map((v) => ({ angle: v.angle, length: v.length * factor })),
    wheels: g.wheels.map((w) => (w.vertex >= 0 ? { ...w, radius: w.radius * factor } : w)),
  });
}

/** La pieza que impide seguir creciendo (+1) o encogiendo (−1), para explicárselo al jugador. */
export function piezaLimitante(
  genome: Genome,
  sentido: 1 | -1,
  paso: number,
): { tipo: "punto" | "rueda"; indice: number; medida: number } | null {
  const g = normalizeGenome(genome);
  const [fmin, fmax] = factorPermitido(g);
  const f = sentido === 1 ? 1 + paso : 1 - paso;
  if (f >= fmin && f <= fmax) return null;
  const [minLen, maxLen] = GENE_RANGES.length;
  const [minR, maxR] = GENE_RANGES.radius;
  let mejor: { tipo: "punto" | "rueda"; indice: number; medida: number; holgura: number } | null = null;
  const probar = (tipo: "punto" | "rueda", indice: number, medida: number, lo: number, hi: number) => {
    const holgura = sentido === 1 ? hi / medida : lo / medida;
    if (!mejor || (sentido === 1 ? holgura < mejor.holgura : holgura > mejor.holgura)) mejor = { tipo, indice, medida, holgura };
  };
  g.body.forEach((v, i) => probar("punto", i, v.length, minLen, maxLen));
  g.wheels.forEach((w, i) => w.vertex >= 0 && probar("rueda", i, w.radius, minR, maxR));
  if (!mejor) return null;
  const { tipo, indice, medida } = mejor as { tipo: "punto" | "rueda"; indice: number; medida: number };
  return { tipo, indice, medida };
}

/** Mueve el ángulo del punto i; normalizeGenome lo deja dentro de su sector. */
export function ajustarAngulo(genome: Genome, index: number, deltaRad: number): Genome {
  const g = normalizeGenome(genome);
  if (!Number.isInteger(index) || index < 0 || index >= VERTEX_COUNT || !Number.isFinite(deltaRad)) return g;
  return normalizeGenome({ ...g, body: g.body.map((v, i) => (i === index ? { ...v, angle: v.angle + deltaRad } : v)) });
}

export function ajustarLongitud(genome: Genome, index: number, deltaM: number): Genome {
  const g = normalizeGenome(genome);
  if (!Number.isInteger(index) || index < 0 || index >= VERTEX_COUNT || !Number.isFinite(deltaM)) return g;
  return normalizeGenome({ ...g, body: g.body.map((v, i) => (i === index ? { ...v, length: redondear(v.length + deltaM, 4) } : v)) });
}

/** Pone una rueda en el vértice si no la tiene y queda hueco; si no, devuelve el genoma tal cual. */
export function ponerRueda(genome: Genome, vertex: number): Genome {
  const g = normalizeGenome(genome);
  if (!Number.isInteger(vertex) || vertex < 0 || vertex >= VERTEX_COUNT || wheelAt(g, vertex) >= 0) return g;
  return toggleWheel(g, vertex).genome;
}

export function quitarRueda(genome: Genome, vertex: number): Genome {
  const g = normalizeGenome(genome);
  return wheelAt(g, vertex) >= 0 ? toggleWheel(g, vertex).genome : g;
}

/** Caja que ocupa el coche, ruedas incluidas, en metros. */
export function dimensiones(genome: Genome): { largo: number; alto: number } {
  const g = normalizeGenome(genome);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const v of g.body) {
    xs.push(Math.cos(v.angle) * v.length);
    ys.push(Math.sin(v.angle) * v.length);
  }
  for (const w of ruedasActivas(g)) {
    const v = g.body[w.vertex];
    const x = Math.cos(v.angle) * v.length;
    const y = Math.sin(v.angle) * v.length;
    xs.push(x - w.radius, x + w.radius);
    ys.push(y - w.radius, y + w.radius);
  }
  return { largo: Math.max(...xs) - Math.min(...xs), alto: Math.max(...ys) - Math.min(...ys) };
}
