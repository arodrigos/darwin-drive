import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PHYSICS_VERSION } from "../../src/sim/constants";
import { validarCopia } from "../../src/storage/copia";
import { KEY_RANKINGS, KEY_SPECIES } from "../../src/storage/schema";

const TEXTO = readFileSync("tests/fixtures/copia-version-anterior.json", "utf8");

test("mig-4 el fixture de copia anterior se valida sin rechazo y conserva su versión antigua", () => {
  const r = validarCopia(TEXTO);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const rankings = r.data[KEY_RANKINGS] as Record<string, { physicsVersion: number; trackVersion: number }[]>;
  assert.equal(rankings.cordillera.length, 5);
  for (const e of rankings.cordillera) assert.ok(e.physicsVersion < PHYSICS_VERSION);
  assert.ok(KEY_SPECIES in r.data);
});

test("mig-4 una copia con un genoma inválido sigue rechazándose entera", () => {
  const c = JSON.parse(TEXTO);
  c.data[KEY_RANKINGS].cordillera[0].genome.body = [];
  assert.equal(validarCopia(JSON.stringify(c)).ok, false);
});
