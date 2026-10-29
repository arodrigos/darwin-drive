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

test("rit-4: una Meta anterior sin ritmo se carga entera y empieza en ×1", () => {
  const antigua = { seenHelp: ["taller"], persistRequested: true, lastTrack: "rampa" };
  assert.deepEqual(validateMeta(antigua), { ...antigua, ritmo: "x1", sonido: false });
});

test("rit-4: x2/x4/x8 se recuerdan; «turbo» o un ritmo desconocido se ignoran sin descartar la Meta", () => {
  for (const r of ["x1", "x2", "x4", "x8"]) assert.equal(validateMeta({ ...DEFAULT_META, ritmo: r })?.ritmo, r);
  for (const r of ["turbo", "x16", 4, null, {}]) assert.equal(validateMeta({ ...DEFAULT_META, ritmo: r })?.ritmo, "x1");
});

test("invariante: validateMeta no devuelve null para ninguna Meta válida anterior, con cualquier ritmo", () => {
  fc.assert(
    fc.property(fc.array(fc.string(), { maxLength: 5 }), fc.boolean(), fc.constantFrom(...TRACKS.map((t) => t.id)), fc.anything(), (seenHelp, persistRequested, lastTrack, ritmo) => {
      const m = validateMeta({ seenHelp, persistRequested, lastTrack, ritmo });
      assert.ok(m);
      assert.ok(["x1", "x2", "x4", "x8"].includes(m.ritmo));
    }),
    { numRuns: 200 },
  );
});
