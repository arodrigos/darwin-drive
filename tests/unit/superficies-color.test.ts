import { test } from "node:test";
import assert from "node:assert/strict";
import { ASPECTO, contraste } from "../../src/game/superficies";
import { PALETTES } from "../../src/game/palette";
import { TRACKS } from "../../src/sim/tracks";

test("pn-4 invariante: toda superficie distinta de roca tiene patrón y contraste ≥ 3:1 con el suelo y con el cielo", () => {
  for (const t of TRACKS) {
    const pal = PALETTES[t.id];
    for (let i = 0; i < 50; i++) {
      const tipo = t.surfaceOfSegment(i).tipo;
      const a = ASPECTO[tipo];
      if (tipo === "roca") {
        assert.equal(a.color, null);
        continue;
      }
      assert.notEqual(a.patron, "ninguno", `${t.id}/${tipo} sin patrón`);
      assert.ok(contraste(a.color!, pal.earth) >= 3, `${t.id}: franja contra la tierra`);
      assert.ok(contraste(a.contorno, pal.skyBottom) >= 3, `${t.id}: contorno contra el cielo`);
      assert.ok(contraste(a.contorno, a.color!) >= 3, `${t.id}: contorno contra la franja`);
    }
  }
});

test("pn-4: hielo y elástico tienen patrones distintos", () => {
  assert.equal(ASPECTO.hielo.patron, "brillos");
  assert.equal(ASPECTO.elastico.patron, "zigzag");
});
