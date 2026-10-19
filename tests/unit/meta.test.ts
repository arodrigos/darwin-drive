import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { DEFAULT_META, validateMeta } from "../../src/storage/meta";
import { TRACKS } from "../../src/sim/tracks";

test("validateMeta acepta la meta por defecto y cada pista", () => {
  assert.deepEqual(validateMeta(DEFAULT_META), DEFAULT_META);
  for (const t of TRACKS) assert.equal(validateMeta({ ...DEFAULT_META, lastTrack: t.id })?.lastTrack, t.id);
});

test("validateMeta descarta pistas desconocidas y formas inválidas", () => {
  assert.equal(validateMeta({ ...DEFAULT_META, lastTrack: "volcan" }), null);
  assert.equal(validateMeta({ seenHelp: [1], persistRequested: false, lastTrack: "rampa" }), null);
  assert.equal(validateMeta(null), null);
  assert.equal(validateMeta("x"), null);
});

test("invariante: validateMeta nunca lanza y solo devuelve pistas del catálogo", () => {
  fc.assert(
    fc.property(fc.anything(), (v) => {
      const m = validateMeta(v);
      if (m) assert.ok(TRACKS.some((t) => t.id === m.lastTrack));
    }),
    { numRuns: 300 },
  );
});
