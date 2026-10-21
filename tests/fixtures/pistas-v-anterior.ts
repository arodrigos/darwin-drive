// Las cuatro clásicas tal como eran antes de curva-dificultad (versiones 3, 2, 2 y 2).
// medir:pistas --umbral las simula con la física actual para tener una referencia
// medida hoy y no una cifra guardada de otra versión de la física.
import "../../src/sim/detmath";
import { createNoise2D } from "simplex-noise";
import { FLAT_START } from "../../src/sim/terrain";
import type { TrackId } from "../../src/sim/tracks";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
function cellHash(cell: number, salt: number): number {
  let h = Math.imul(cell | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const cordilleraNoise = createNoise2D(mulberry32(1810));
function cordillera(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  const progress = Math.min(1, d / 1990);
  const amplitude = lerp(0.5, 14, progress);
  const suavizado = smoothstep((d - 1990) / 400);
  const w1 = lerp(0.25, 0.55, progress) - 0.2 * suavizado;
  const w2 = lerp(0.08, 0.3, progress) - 0.16 * suavizado;
  const n = cordilleraNoise(d / 110, 0) + w1 * cordilleraNoise(d / 45, 7.5) + w2 * cordilleraNoise(d / 18, 19.25);
  return smoothstep(d / 30) * amplitude * n;
}

const RAMP_K = (0.1 * Math.PI) / 180;
const RAMP_MAX_ANGLE = (60 * Math.PI) / 180;
const RAMP_CAP_D = RAMP_MAX_ANGLE / RAMP_K;
const RAMP_CAP_Y = -Math.log(Math.cos(RAMP_K * RAMP_CAP_D)) / RAMP_K;
function rampa(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  if (d >= RAMP_CAP_D) return RAMP_CAP_Y + Math.tan(RAMP_MAX_ANGLE) * (d - RAMP_CAP_D);
  return -Math.log(Math.cos(RAMP_K * d)) / RAMP_K;
}

function dunas(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  const amplitude = Math.min(7, 0.012 * d);
  return amplitude * (Math.sin((2 * Math.PI * d) / 38) + 0.35 * Math.sin((2 * Math.PI * d) / 13));
}

const pedregalNoise = createNoise2D(mulberry32(77));
function pedregal(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  const base = smoothstep(d / 40) * 1.5 * pedregalNoise(d / 70, 3.5);
  const cell = Math.floor(x / 4);
  let stone = 0;
  if (cell * 4 >= FLAT_START && cellHash(cell, 1) % 5 !== 0) {
    const width = 1.2 + 1.2 * ((cellHash(cell, 2) % 1000) / 999);
    const centre = cell * 4 + 2;
    const dist = Math.abs(x - centre);
    if (dist < width / 2) {
      const height = Math.min(0.9, 0.15 + 0.0009 * d);
      stone = height * 0.5 * (1 + Math.cos((2 * Math.PI * dist) / width));
    }
  }
  return base + stone;
}

export const PISTAS_V_ANTERIOR: Record<"cordillera" | "rampa" | "dunas" | "pedregal", (x: number) => number> = {
  cordillera,
  rampa,
  dunas,
  pedregal,
};
export type PistaClasica = keyof typeof PISTAS_V_ANTERIOR;
export const ES_CLASICA = (id: TrackId): id is PistaClasica => id in PISTAS_V_ANTERIOR;
