export const GENOME_VERSION = 1;
export const VERTEX_COUNT = 8;
export const WHEEL_SLOTS = 4;

export interface BodyVertex {
  /** rad, dentro del sector del vértice: así los ángulos crecen siempre con el índice. */
  angle: number;
  /** m */
  length: number;
}

export interface WheelGene {
  /** -1 = apagada, 0..7 */
  vertex: number;
  /** m */
  radius: number;
  /** kg/m² */
  density: number;
  /** rad, [0, 2π) */
  axisAngle: number;
}

export interface Genome {
  v: 1;
  body: BodyVertex[];
  bodyDensity: number;
  wheels: WheelGene[];
}

const SECTOR = Math.PI / 4;
const SECTOR_MARGIN = 0.087;
const TAU = 2 * Math.PI;

export const GENE_RANGES = {
  /** Rango del ángulo del vértice i. */
  angle: (i: number): readonly [number, number] => [i * SECTOR + SECTOR_MARGIN, (i + 1) * SECTOR - SECTOR_MARGIN],
  length: [0.2, 2.5],
  bodyDensity: [20, 200],
  radius: [0.2, 1.2],
  wheelDensity: [20, 120],
  axisAngle: [0, TAU],
} as const;

type Range = readonly [number, number];

function centre([lo, hi]: Range): number {
  return (lo + hi) / 2;
}

function clamp(value: unknown, range: Range): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return centre(range);
  return Math.min(range[1], Math.max(range[0], value));
}

function wrapAngle(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return Math.PI;
  let r = value % TAU;
  if (r < 0) r += TAU;
  // Un valor negativo diminuto suma TAU y se redondea a TAU exacto.
  return r >= TAU ? 0 : r;
}

function field(obj: unknown, key: string): unknown {
  return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>)[key] : undefined;
}

function at(arr: unknown, i: number): unknown {
  return Array.isArray(arr) ? arr[i] : undefined;
}

function normalizeVertex(raw: unknown): number {
  // El vértice «no numérico» apaga la rueda; un decimal se redondea al más cercano.
  if (typeof raw !== "number" || !Number.isFinite(raw)) return -1;
  return Math.min(VERTEX_COUNT - 1, Math.max(-1, Math.round(raw)));
}

function doNormalize(input: unknown): Genome {
  const bodyRaw = field(input, "body");
  const body: BodyVertex[] = [];
  for (let i = 0; i < VERTEX_COUNT; i++) {
    const v = at(bodyRaw, i);
    body.push({
      angle: clamp(field(v, "angle"), GENE_RANGES.angle(i)),
      length: clamp(field(v, "length"), GENE_RANGES.length),
    });
  }
  const wheelsRaw = field(input, "wheels");
  const used = new Set<number>();
  const wheels: WheelGene[] = [];
  for (let i = 0; i < WHEEL_SLOTS; i++) {
    const w = at(wheelsRaw, i);
    let vertex = normalizeVertex(field(w, "vertex"));
    // Vértice repetido: se apaga la rueda de índice mayor.
    if (vertex >= 0) {
      if (used.has(vertex)) vertex = -1;
      else used.add(vertex);
    }
    wheels.push({
      vertex,
      radius: clamp(field(w, "radius"), GENE_RANGES.radius),
      density: clamp(field(w, "density"), GENE_RANGES.wheelDensity),
      axisAngle: wrapAngle(field(w, "axisAngle")),
    });
  }
  return { v: 1, body, bodyDensity: clamp(field(input, "bodyDensity"), GENE_RANGES.bodyDensity), wheels };
}

/** Nunca lanza: recorta a rango, NaN/∞ van al centro del rango y es idempotente. */
export function normalizeGenome(input: unknown): Genome {
  try {
    return doNormalize(input);
  } catch {
    // Proxies o getters hostiles: se parte de cero.
    return doNormalize(null);
  }
}

/** Genoma aleatorio válido a partir de una fuente en [0, 1); la inyecta quien llama para que sea reproducible. */
export function randomGenome(rand: () => number): Genome {
  const between = ([lo, hi]: Range) => lo + (hi - lo) * rand();
  const raw = {
    body: Array.from({ length: VERTEX_COUNT }, (_, i) => ({
      angle: between(GENE_RANGES.angle(i)),
      length: between(GENE_RANGES.length),
    })),
    bodyDensity: between(GENE_RANGES.bodyDensity),
    wheels: Array.from({ length: WHEEL_SLOTS }, () => ({
      vertex: rand() < 0.2 ? -1 : Math.floor(rand() * VERTEX_COUNT),
      radius: between(GENE_RANGES.radius),
      density: between(GENE_RANGES.wheelDensity),
      axisAngle: between(GENE_RANGES.axisAngle),
    })),
  };
  return normalizeGenome(raw);
}

function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Estable entre procesos: depende solo de los números del genoma normalizado. */
export function genomeHash(g: Genome): string {
  const text = JSON.stringify(normalizeGenome(g));
  const a = fnv1a(text, 0x811c9dc5).toString(16).padStart(8, "0");
  const b = fnv1a(text, 0x9747b28c).toString(16).padStart(8, "0");
  return a + b;
}

const deg = (d: number) => (d * Math.PI) / 180;

/** «Coche de serie»: dos ruedas, en los vértices 5 (trasera) y 7 (delantera). */
export const STOCK_CAR: Genome = normalizeGenome({
  body: [
    { angle: deg(25), length: 1.0 },
    { angle: deg(70), length: 0.9 },
    { angle: deg(115), length: 0.9 },
    { angle: deg(160), length: 1.1 },
    { angle: deg(205), length: 1.1 },
    { angle: 4.16, length: 1.53 },
    { angle: deg(300), length: 0.9 },
    { angle: 5.73, length: 1.65 },
  ],
  bodyDensity: 70,
  wheels: [
    { vertex: 5, radius: 0.66, density: 60, axisAngle: Math.PI / 2 },
    { vertex: 7, radius: 0.55, density: 60, axisAngle: Math.PI / 2 },
    { vertex: -1, radius: 0.4, density: 60, axisAngle: Math.PI / 2 },
    { vertex: -1, radius: 0.4, density: 60, axisAngle: Math.PI / 2 },
  ],
});
