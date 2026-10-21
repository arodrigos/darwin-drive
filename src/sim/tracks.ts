import "./detmath";
import { createNoise2D } from "simplex-noise";
import { curvaDificultad } from "./dificultad";
import { FLAT_START, VERTEX_SPACING } from "./terrain";

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
const CORDILLERA_TECHO = 14;
function cordilleraHeight(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  const c = Math.min(1, 1.25 * curvaDificultad(d));
  // La rugosidad crece con la dificultad. Se normaliza por la suma de pesos: el
  // relieve nunca pasa del techo, y sin foso de 60° que pare a todos en el mismo sitio.
  const w1 = lerp(0.25, 0.4, c);
  const w2 = lerp(0.08, 0.16, c);
  const n =
    (cordilleraNoise(d / 110, 0) + w1 * cordilleraNoise(d / 45, 7.5) + w2 * cordilleraNoise(d / 18, 19.25)) /
    (1 + w1 + w2);
  return smoothstep(d / 30) * CORDILLERA_TECHO * c * n;
}

const RAMP_PASO = VERTEX_SPACING;
const RAMP_MAX_ANGLE = (60 * Math.PI) / 180;
const RAMP_TABLA_HASTA = 12000;
// Altura acumulada cada 0,5 m (regla del punto medio). Se calcula una vez al
// cargar: heightAt sigue siendo pura y los vértices caen justo en la tabla.
const rampaTabla: Float64Array = (() => {
  const n = Math.round(RAMP_TABLA_HASTA / RAMP_PASO);
  const t = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const d = (i + 0.5) * RAMP_PASO;
    t[i + 1] = t[i] + RAMP_PASO * Math.tan(RAMP_MAX_ANGLE * curvaDificultad(d));
  }
  return t;
})();
function rampaHeight(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  const pos = d / RAMP_PASO;
  const i = Math.floor(pos);
  if (i >= rampaTabla.length - 1) {
    return rampaTabla[rampaTabla.length - 1] + Math.tan(RAMP_MAX_ANGLE) * (d - RAMP_TABLA_HASTA);
  }
  return lerp(rampaTabla[i], rampaTabla[i + 1], pos - i);
}

const DUNAS_TECHO = 7;
function dunasHeight(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  // Cada ola de 38 m tiene su propio tamaño (cellHash): no todas son iguales.
  const ola = Math.floor(d / 38);
  const variedad = 0.9 + 0.1 * ((cellHash(ola, 5) % 1000) / 999);
  // Las olas llegan a su techo antes que la curva (c·1,6): a 100 m ya miden más de 3 m.
  const amplitude = DUNAS_TECHO * Math.min(1, 1.6 * curvaDificultad(d)) * variedad;
  return (amplitude * (Math.sin((2 * Math.PI * d) / 38) + 0.35 * Math.sin((2 * Math.PI * d) / 13))) / 1.35;
}

const pedregalNoise = createNoise2D(mulberry32(77));
const STONE_CELL = 4;
// 0,7 + hasta 0,2 de la ondulación de base en 4 m: el conjunto no pasa de 0,9 m.
const PIEDRA_TECHO = 0.7;
function pedregalHeight(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  const c = curvaDificultad(d);
  const base = smoothstep(d / 40) * 1.0 * pedregalNoise(d / 70, 3.5) * (0.4 + 0.6 * c);
  const cell = Math.floor(x / STONE_CELL);
  let stone = 0;
  // Solo celdas que empiezan tras la salida llana; 1 de cada 5 queda vacía.
  if (cell * STONE_CELL >= FLAT_START && cellHash(cell, 1) % 5 !== 0) {
    const width = 1.0 + 1.6 * ((cellHash(cell, 2) % 1000) / 999);
    const centre = cell * STONE_CELL + STONE_CELL / 2;
    const dist = Math.abs(x - centre);
    if (dist < width / 2) {
      // Altura y forma varían por celda: unas son lomos redondos y otras picos.
      const tamano = 0.85 + 0.15 * ((cellHash(cell, 3) % 1000) / 999);
      const height = Math.min(PIEDRA_TECHO, (0.12 + 0.78 * c) * tamano * 1.1);
      const t = (2 * dist) / width;
      const perfil = cellHash(cell, 4) % 3 === 0 ? 1 - t : 0.5 * (1 + Math.cos(Math.PI * t));
      stone = height * perfil;
    }
  }
  return base + stone;
}

export const TRACKS: readonly Track[] = [
  {
    id: "cordillera",
    version: 4,
    name: "La Cordillera",
    tagline: "Montañas al azar, siempre las mismas, cada vez más altas.",
    heightAt: cordilleraHeight,
  },
  {
    id: "rampa",
    version: 3,
    name: "La Rampa",
    tagline: "Una recta que se empina sin parar.",
    heightAt: rampaHeight,
  },
  {
    id: "dunas",
    version: 3,
    name: "Las Dunas",
    tagline: "Olas largas que crecen: con velocidad, se vuela.",
    heightAt: dunasHeight,
  },
  {
    id: "pedregal",
    version: 3,
    name: "El Pedregal",
    tagline: "Llano sembrado de piedras cada vez mayores.",
    heightAt: pedregalHeight,
  },
];

export const DEFAULT_TRACK_ID: TrackId = "cordillera";

export function getTrack(id: unknown): Track | null {
  return TRACKS.find((t) => t.id === id) ?? null;
}
