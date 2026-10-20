import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { discovered, type SpeciesArchive } from "../../src/evolution/species";
import demoTexto from "../../src/debug/escenarios/especies-demo.texto";
import { validateSpecies } from "../../src/storage/schema";
import { PISTAS_DEMO } from "../../scripts/generar-escenario-especies";
import { explorar } from "./helpers/especies";

const DEMO = JSON.parse(readFileSync(new URL("../../src/debug/escenarios/especies-demo.json", import.meta.url), "utf8"));

test("es-1: el escenario demo de especies es válido, llega como texto y deja casillas vacías", () => {
  assert.deepEqual(JSON.parse(demoTexto), DEMO);
  const avisos: string[] = [];
  const validos = validateSpecies(DEMO, (m) => avisos.push(m));
  assert.equal(avisos.length, 0);
  assert.ok(validos);
  for (const p of PISTAS_DEMO) {
    const a: SpeciesArchive | undefined = validos[p.trackId];
    assert.ok(a, p.trackId);
    assert.equal(a.batch, p.lotes);
    assert.ok(discovered(a) >= 3 && discovered(a) < 16, `${p.trackId}: ${discovered(a)}`);
  }
});

test("es-1: el escenario demo coincide con volver a explorar con el núcleo (misma semilla, misma física)", () => {
  const p = PISTAS_DEMO[1]!; // la pista corta basta para detectar una deriva de física o de algoritmo
  assert.deepEqual(explorar(p.trackId, p.seed, p.lotes), DEMO[p.trackId]);
});
