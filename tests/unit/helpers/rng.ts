import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import { uniformInt } from "pure-rand/distribution/uniformInt";
import { randomGenome, type Genome } from "../../../src/sim/genome";

/** Fuente reproducible en [0, 1) a partir de una semilla entera. */
export function seededRand(seed: number): () => number {
  const gen = xoroshiro128plus(seed);
  return () => uniformInt(gen, 0, 0xffffff) / 0x1000000;
}

export function seededGenomes(seed: number, count: number): Genome[] {
  const rand = seededRand(seed);
  return Array.from({ length: count }, () => randomGenome(rand));
}
