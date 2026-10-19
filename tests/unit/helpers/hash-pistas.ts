// Lo ejecuta terrain.test.ts en un segundo proceso: la pista tiene que dar los
// mismos números en un proceso nuevo, no solo al repetir el cálculo en el mismo.
import { createHash } from "node:crypto";
import { TRACKS } from "../../../src/sim/tracks";

export function hashPista(heightAt: (x: number) => number): string {
  const a = new Float64Array(10000);
  for (let i = 0; i < 10000; i++) a[i] = heightAt(i * 0.5);
  return createHash("sha256").update(Buffer.from(a.buffer)).digest("hex");
}

if (process.argv[2] === "imprimir") {
  console.log(JSON.stringify(Object.fromEntries(TRACKS.map((t) => [t.id, hashPista(t.heightAt)]))));
}
