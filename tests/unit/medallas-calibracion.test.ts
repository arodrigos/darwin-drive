import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Genome } from "../../src/sim/genome";
import { DT, simulateCar } from "../../src/sim/race";
import { TRACKS, type TrackId } from "../../src/sim/tracks";
import { medallaDe, UMBRALES } from "../../src/app/medallas";

interface Fila {
  trackId: TrackId;
  version: number;
  tipo: "distancia" | "tiempo";
  semilla: number;
  n: number;
  p90: number;
  autor: number;
  campeon: Genome;
}
const FIXTURE: Fila[] = JSON.parse(readFileSync("tests/fixtures/medallas-calibracion.json", "utf8"));

test("med-2 el fixture cubre las diez pistas en su versión actual", () => {
  assert.deepEqual(FIXTURE.map((f) => [f.trackId, f.version]), TRACKS.map((t) => [t.id, t.version]));
});

test("med-2 bronce supera el p90 de los aleatorios y autor es la marca del campeón de referencia", () => {
  for (const f of FIXTURE) {
    const u = UMBRALES[f.trackId][f.version];
    assert.equal(u.tipo, f.tipo, f.trackId);
    if (f.tipo === "distancia") {
      assert.ok(u.bronce > f.p90, `${f.trackId}: bronce ${u.bronce} ≤ p90 ${f.p90}`);
      assert.ok(u.autor <= Math.min(f.autor, 5000), `${f.trackId}: autor ${u.autor} por encima del campeón ${f.autor}`);
    } else {
      assert.ok(u.bronce < f.p90, `${f.trackId}: bronce ${u.bronce} ≥ p90 ${f.p90}`);
      assert.ok(u.autor >= f.autor, `${f.trackId}: autor ${u.autor} por debajo del campeón ${f.autor}`);
    }
  }
});

test("med-2-a re-simular el campeón de cada pista da autor", () => {
  for (const f of FIXTURE) {
    const r = simulateCar(f.campeon, f.trackId);
    if (f.tipo === "tiempo") assert.ok(Math.abs(r.bestStep * DT - f.autor) < 1e-9, `${f.trackId}: el campeón ya no da ${f.autor} s`);
    else assert.ok(Math.abs(r.distance - f.autor) < 1e-6, `${f.trackId}: el campeón ya no da ${f.autor} m`);
    assert.equal(medallaDe(f.trackId, f.version, r), "autor", f.trackId);
  }
});
