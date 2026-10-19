import "./detmath";
import { createNoise2D } from "simplex-noise";
import { FLAT_START } from "./terrain";

export type TrackId = "cordillera" | "rampa" | "dunas" | "pedregal";

export interface Track {
  id: TrackId;
  /** Sube si cambia la geometría: obliga a volver a medir las marcas de la pista. */
  version: number;
  name: string;
  tagline: string;
  /** Pura, en metros y con y hacia arriba; 0 en [0, FLAT_START]. */
  heightAt(x: number): number;
}

// PRNG propio y mínimo: simplex-noise solo necesita una función () => [0,1),
// y así la semilla fija de la pista no depende de ninguna otra librería.
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

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Hash entero de una celda, sin Math.random: la pista sigue siendo función pura de x. */
function cellHash(cell: number, salt: number): number {
  let h = Math.imul(cell | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const cordilleraNoise = createNoise2D(mulberry32(1810));
function cordilleraHeight(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  const progress = Math.min(1, d / 1990);
  const amplitude = lerp(0.5, 14, progress);
  // La rugosidad (peso de las octavas cortas) también crece con la distancia.
  const w1 = lerp(0.25, 0.55, progress);
  const w2 = lerp(0.08, 0.3, progress);
  const n =
    cordilleraNoise(d / 110, 0) + w1 * cordilleraNoise(d / 45, 7.5) + w2 * cordilleraNoise(d / 18, 19.25);
  return smoothstep(d / 30) * amplitude * n;
}

const RAMP_K = (0.1 * Math.PI) / 180; // rad/m: la pendiente crece 0,1° por metro
const RAMP_MAX_ANGLE = (60 * Math.PI) / 180;
const RAMP_CAP_D = RAMP_MAX_ANGLE / RAMP_K;
const RAMP_CAP_Y = -Math.log(Math.cos(RAMP_K * RAMP_CAP_D)) / RAMP_K;
function rampaHeight(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  if (d >= RAMP_CAP_D) return RAMP_CAP_Y + Math.tan(RAMP_MAX_ANGLE) * (d - RAMP_CAP_D);
  return -Math.log(Math.cos(RAMP_K * d)) / RAMP_K;
}

function dunasHeight(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  const amplitude = Math.min(7, 0.012 * d);
  return amplitude * (Math.sin((2 * Math.PI * d) / 38) + 0.35 * Math.sin((2 * Math.PI * d) / 13));
}

const pedregalNoise = createNoise2D(mulberry32(77));
const STONE_CELL = 4;
function pedregalHeight(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  const base = smoothstep(d / 40) * 1.5 * pedregalNoise(d / 70, 3.5);
  const cell = Math.floor(x / STONE_CELL);
  let stone = 0;
  // Solo celdas que empiezan tras la salida llana; 1 de cada 5 queda vacía.
  if (cell * STONE_CELL >= FLAT_START && cellHash(cell, 1) % 5 !== 0) {
    const width = 1.2 + 1.2 * ((cellHash(cell, 2) % 1000) / 999);
    const centre = cell * STONE_CELL + STONE_CELL / 2;
    const dist = Math.abs(x - centre);
    if (dist < width / 2) {
      const height = Math.min(0.9, 0.15 + 0.0009 * d);
      stone = height * 0.5 * (1 + Math.cos((2 * Math.PI * dist) / width));
    }
  }
  return base + stone;
}

export const TRACKS: readonly Track[] = [
  {
    id: "cordillera",
    version: 2,
    name: "La Cordillera",
    tagline: "Montañas al azar, siempre las mismas, cada vez más altas.",
    heightAt: cordilleraHeight,
  },
  {
    id: "rampa",
    version: 2,
    name: "La Rampa",
    tagline: "Una recta que se empina sin parar.",
    heightAt: rampaHeight,
  },
  {
    id: "dunas",
    version: 2,
    name: "Las Dunas",
    tagline: "Olas largas que crecen: con velocidad, se vuela.",
    heightAt: dunasHeight,
  },
  {
    id: "pedregal",
    version: 2,
    name: "El Pedregal",
    tagline: "Llano sembrado de piedras cada vez mayores.",
    heightAt: pedregalHeight,
  },
];

export const DEFAULT_TRACK_ID: TrackId = "cordillera";

export function getTrack(id: unknown): Track | null {
  return TRACKS.find((t) => t.id === id) ?? null;
}
