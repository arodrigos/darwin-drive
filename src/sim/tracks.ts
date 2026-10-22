import "./detmath";
import { createNoise2D } from "simplex-noise";
import { curvaDificultad } from "./dificultad";
import { FLAT_START, VERTEX_SPACING } from "./terrain";

export type TrackId = "cordillera" | "rampa" | "dunas" | "pedregal" | "glaciar" | "trampolines" | "escalera" | "mosaico";

export type TipoSuperficie = "roca" | "hielo" | "elastico";

/** Material de un tramo de 25 m: fricción y rebote del suelo (se combinan con los de las ruedas). */
export interface Superficie {
  tipo: TipoSuperficie;
  friction: number;
  restitution: number;
}

/** Suelo de las cuatro clásicas: es el que había antes de que existieran las superficies. */
export const ROCA: Superficie = { tipo: "roca", friction: 1, restitution: 0 };
export const HIELO: Superficie = { tipo: "hielo", friction: 0.05, restitution: 0 };

export interface Track {
  id: TrackId;
  /** Sube si cambia la geometría: obliga a volver a medir las marcas de la pista. */
  version: number;
  name: string;
  tagline: string;
  /** Pura, en metros y con y hacia arriba; 0 en [0, FLAT_START]. */
  heightAt(x: number): number;
  /** Pura: material del tramo de 25 m con ese índice. Las clásicas devuelven ROCA. */
  surfaceOfSegment(index: number): Superficie;
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

const GLACIAR_TECHO = 5;
function glaciarHeight(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  // Lomas largas y suaves: lo difícil del hielo es frenar y arrancar, no la altura.
  const c = Math.min(1, 1.2 * curvaDificultad(d));
  const n = (glaciarNoise(d / 90, 2.5) + 0.35 * glaciarNoise(d / 35, 11.5)) / 1.35;
  return smoothstep(d / 30) * GLACIAR_TECHO * (0.25 + 0.75 * c) * n;
}
const glaciarNoise = createNoise2D(mulberry32(3301));

const TRAMPOLIN_TECHO = 0.9;
function trampolinesHeight(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  const c = curvaDificultad(d);
  return (smoothstep(d / 20) * TRAMPOLIN_TECHO * (0.3 + 0.7 * c) * (Math.sin((2 * Math.PI * d) / 21) + 0.4 * Math.sin((2 * Math.PI * d) / 8))) / 1.4;
}
/** Rebote 0,5-0,85 por tramo: cada cama elástica tiene el suyo. */
function trampolinesSurface(index: number): Superficie {
  return { tipo: "elastico", friction: 0.4, restitution: 0.5 + 0.35 * ((cellHash(index, 9) % 1000) / 999) };
}

export const ESCALERA_HUELLA = 6;
export const ESCALON_MIN = 0.2;
export const ESCALON_MAX = 1.2;
// Los escalones suben de dos en dos y bajan de dos en dos: la altura total no se dispara.
const ESCALERA_GRUPO = 2;
const ESCALERA_ESCALONES = 2000;
/** Pendiente media de bajada (~6°): sin ella, un coche sin empuje se queda quieto en el primer rellano y no hay nada que medir. */
const ESCALERA_BAJADA = 0.105;
/** Altura de cada escalón; el salto ocupa un intervalo de vértice (0,5 m), de ahí la contrahuella máxima de ~67°. */
const escaleraNiveles: Float64Array = (() => {
  const t = new Float64Array(ESCALERA_ESCALONES + 1);
  for (let n = 0; n < ESCALERA_ESCALONES; n++) {
    // Lineal y lenta: el escalón de 1,2 m llega a los 1500 m, así que mide la rueda y no el ánimo.
    const c = Math.min(1, ((n + 1) * ESCALERA_HUELLA) / 1500);
    const cc = Math.min(1, c * (0.75 + 0.25 * ((cellHash(n, 6) % 1000) / 999)) * 1.15);
    const subida = ESCALON_MIN + (ESCALON_MAX - ESCALON_MIN) * cc;
    t[n + 1] = t[n] + (Math.floor(n / ESCALERA_GRUPO) % 2 === 0 ? subida : -subida);
  }
  return t;
})();
function escaleraHeight(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  const n = Math.floor(d / ESCALERA_HUELLA);
  const bajada = ESCALERA_BAJADA * d;
  if (n >= ESCALERA_ESCALONES) return escaleraNiveles[ESCALERA_ESCALONES] - bajada;
  const t = Math.min(1, (d - n * ESCALERA_HUELLA) / VERTEX_SPACING);
  return lerp(escaleraNiveles[n], escaleraNiveles[n + 1], t) - bajada;
}

// Menos agarre que la roca: con fricción plena los mismos coches pasan o no pasan en la escalera
// que en el Pedregal (Spearman 0,95); con 0,3 el orden cambia de verdad.
const ESCALERA_SUELO: Superficie = { ...ROCA, friction: 0.3 };


/** Plantillas del Mosaico, una por tramo de 25 m. El orden es el del índice de TIPOS_TRAMO. */
export const TIPOS_TRAMO = ["llano", "loma", "ondas", "piedras", "hielo", "elastico"] as const;
export type TipoTramo = (typeof TIPOS_TRAMO)[number];
const SUPERFICIE_TRAMO: Record<TipoTramo, Superficie> = {
  llano: ROCA,
  loma: ROCA,
  ondas: ROCA,
  piedras: ROCA,
  hielo: HIELO,
  elastico: { tipo: "elastico", friction: 0.4, restitution: 0.65 },
};
const TRAMO_LARGO = 25;
const MOSAICO_TABLA = 1000;
// Los tres primeros tramos son fijos (salida llana, una loma, ondas): el jugador ve variedad desde el principio.
const mosaicoTabla: Uint8Array = (() => {
  const t = new Uint8Array(MOSAICO_TABLA);
  for (let i = 0; i < MOSAICO_TABLA; i++) t[i] = i < 3 ? i : siguienteTipo(i, t[i - 1]);
  return t;
})();
// Elige entre los demás tipos: nunca repite el anterior, y sigue siendo función pura del índice.
function siguienteTipo(i: number, anterior: number): number {
  const k = cellHash(i, 31) % (TIPOS_TRAMO.length - 1);
  return k >= anterior ? k + 1 : k;
}
/** Índice en TIPOS_TRAMO del tramo `i` (de 25 m desde x = 0). Para i ≥ 3 nunca coincide con el del tramo anterior. */
export function tipoTramo(i: number): number {
  const n = Math.max(0, Math.floor(i));
  if (n < MOSAICO_TABLA) return mosaicoTabla[n];
  let t = mosaicoTabla[MOSAICO_TABLA - 1];
  for (let k = MOSAICO_TABLA; k <= n; k++) t = siguienteTipo(k, t);
  return t;
}
const MOSAICO_TECHO = 2.4;
function mosaicoHeight(x: number): number {
  const d = x - FLAT_START;
  if (d <= 0) return 0;
  const i = Math.floor(x / TRAMO_LARGO);
  const u = (x - i * TRAMO_LARGO) / TRAMO_LARGO;
  // Ventana sen²: vale 0 con derivada 0 en los dos bordes, así las fronteras entre plantillas quedan fundidas y sin escalón.
  const ventana = Math.sin(Math.PI * u) ** 2;
  // El tamaño sigue la curva de dificultad en el centro del tramo.
  const tam = MOSAICO_TECHO * (0.25 + 0.75 * curvaDificultad((i + 0.5) * TRAMO_LARGO - FLAT_START));
  switch (TIPOS_TRAMO[tipoTramo(i)]) {
    case "loma":
    case "hielo":
      return tam * ventana;
    case "ondas":
      return 0.4 * tam * ventana * Math.sin(4 * Math.PI * u);
    case "piedras": {
      // Dos piedras por tramo, en sitios que cambian con el índice y lejos de los bordes (por eso no necesitan ventana).
      const c1 = 0.25 + 0.15 * ((cellHash(i, 41) % 1000) / 999);
      const c2 = 0.65 + 0.15 * ((cellHash(i, 42) % 1000) / 999);
      const bulto = (c: number) => Math.max(0, 1 - Math.abs(u - c) / 0.08);
      return 0.35 * tam * Math.max(bulto(c1), bulto(c2));
    }
    case "elastico":
      return 0.2 * tam * ventana * Math.sin(2 * Math.PI * u);
    default:
      return 0;
  }
}
function mosaicoSurface(index: number): Superficie {
  return SUPERFICIE_TRAMO[TIPOS_TRAMO[tipoTramo(index)]];
}

const rocaSiempre = (): Superficie => ROCA;

export const TRACKS: readonly Track[] = [
  {
    id: "cordillera",
    version: 4,
    name: "La Cordillera",
    tagline: "Montañas al azar, siempre las mismas, cada vez más altas.",
    heightAt: cordilleraHeight,
    surfaceOfSegment: rocaSiempre,
  },
  {
    id: "rampa",
    version: 3,
    name: "La Rampa",
    tagline: "Una recta que se empina sin parar.",
    heightAt: rampaHeight,
    surfaceOfSegment: rocaSiempre,
  },
  {
    id: "dunas",
    version: 3,
    name: "Las Dunas",
    tagline: "Olas largas que crecen: con velocidad, se vuela.",
    heightAt: dunasHeight,
    surfaceOfSegment: rocaSiempre,
  },
  {
    id: "pedregal",
    version: 3,
    name: "El Pedregal",
    tagline: "Llano sembrado de piedras cada vez mayores.",
    heightAt: pedregalHeight,
    surfaceOfSegment: rocaSiempre,
  },
  {
    id: "glaciar",
    version: 1,
    name: "El Glaciar",
    tagline: "Hielo resbaladizo: arrancar es fácil, frenar no.",
    heightAt: glaciarHeight,
    surfaceOfSegment: () => HIELO,
  },
  {
    id: "trampolines",
    version: 1,
    name: "Los Trampolines",
    tagline: "Suelo elástico que te devuelve el golpe.",
    heightAt: trampolinesHeight,
    surfaceOfSegment: trampolinesSurface,
  },
  {
    id: "escalera",
    version: 1,
    name: "La Escalera",
    tagline: "Escalones de 20 cm a más de un metro, cuesta abajo.",
    heightAt: escaleraHeight,
    surfaceOfSegment: () => ESCALERA_SUELO,
  },
  {
    id: "mosaico",
    version: 1,
    name: "El Mosaico",
    tagline: "Cada 25 metros, un suelo distinto: gana el que sirve para todo.",
    heightAt: mosaicoHeight,
    surfaceOfSegment: mosaicoSurface,
  },
];

export const DEFAULT_TRACK_ID: TrackId = "cordillera";

export const PRUEBAS_LLANA_ID = "pruebas-llana";

// Llana y de roca para llegar a la meta en un recorrido de prueba. Queda fuera de TRACKS a propósito:
// ni selectores, ni Rankings, ni Especies la ven, y getTrack la ignora, así que nada suyo se guarda.
const PRUEBAS_LLANA: Track = {
  id: PRUEBAS_LLANA_ID as TrackId,
  version: 1,
  name: "Llana de pruebas",
  tagline: "Solo para pruebas.",
  heightAt: () => 0,
  surfaceOfSegment: rocaSiempre,
};

/** Como getTrack, pero también resuelve la pista de pruebas: solo la usan la simulación y la escena. */
export function resolverPista(id: unknown): Track | null {
  return getTrack(id) ?? (id === PRUEBAS_LLANA_ID ? PRUEBAS_LLANA : null);
}

export function getTrack(id: unknown): Track | null {
  return TRACKS.find((t) => t.id === id) ?? null;
}
