import type { Track } from "./tracks";

export const SEGMENT_LENGTH = 25;
export const VERTEX_SPACING = 0.5;
export const FLAT_START = 10;
export const MAX_SLOPE_DEG = 70;

/**
 * Vértices de [index·25, (index+1)·25] cada 0,5 m. La x se calcula como
 * múltiplo exacto de 0,5 (representable sin error), así que el último vértice
 * de un tramo y el primero del siguiente son idénticos con ===: la ChainShape
 * de la física empalma sin rendijas.
 */
export function segmentVertices(track: Track, index: number): { x: number; y: number }[] {
  const count = Math.round(SEGMENT_LENGTH / VERTEX_SPACING);
  const origin = index * SEGMENT_LENGTH;
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k <= count; k++) {
    const x = origin + k * VERTEX_SPACING;
    out.push({ x, y: track.heightAt(x) });
  }
  return out;
}

/** Alturas equiespaciadas en [0, toX] para la miniatura del selector de pista. */
export function trackProfile(track: Track, toX: number, samples: number): number[] {
  const n = Math.max(2, Math.floor(samples));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(track.heightAt((toX * i) / (n - 1)));
  return out;
}
