import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { DT } from "../../src/sim/race";
import { TRACKS, type TrackId } from "../../src/sim/tracks";
import { medallaDe, recuento, siguiente, UMBRALES, type Medalla } from "../../src/app/medallas";

const metros = (distance: number) => ({ distance, bestStep: 0, reason: "stall" as const });
// bestStep entero: el tiempo de la marca es bestStep·DT, así que se pide el paso que da justo `s` segundos.
const conTiempo = (s: number, reason: "meta" | "stall" = "meta") => ({ distance: 5000, bestStep: Math.round(s / DT), reason });
const ORDEN: Medalla[] = ["bronce", "plata", "oro", "autor"];
const rango = (m: Medalla | null) => (m === null ? -1 : ORDEN.indexOf(m));

test("med-1 cada pista, en su versión actual, tiene cuatro umbrales ordenados", () => {
  assert.equal(TRACKS.length, 10);
  for (const t of TRACKS) {
    const u = UMBRALES[t.id]?.[t.version];
    assert.ok(u, `${t.id} v${t.version} sin umbrales`);
    if (u.tipo === "distancia") assert.ok(u.bronce < u.plata && u.plata < u.oro && u.oro <= u.autor, t.id);
    else assert.ok(u.bronce > u.plata && u.plata > u.oro && u.oro >= u.autor, t.id);
  }
});

test("med-1-a Cordillera: bordes de plata y lo que falta para oro", () => {
  const v = TRACKS.find((t) => t.id === "cordillera")!.version;
  const u = UMBRALES.cordillera[v];
  assert.equal(medallaDe("cordillera", v, metros(u.plata - 1)), "bronce");
  assert.equal(medallaDe("cordillera", v, metros(u.plata)), "plata");
  assert.deepEqual(siguiente("cordillera", v, metros(u.plata)), { medalla: "oro", falta: u.oro - u.plata, unidad: "m" });
  assert.equal(medallaDe("cordillera", v, metros(0)), null);
  assert.equal(siguiente("cordillera", v, metros(u.autor)), null);
});

test("med-1-a La Recta: sin meta no hay medalla; en tiempo menos es mejor y falta va en segundos", () => {
  const u = UMBRALES.recta[1];
  assert.equal(medallaDe("recta", 1, conTiempo(100, "stall")), null);
  assert.equal(siguiente("recta", 1, conTiempo(100, "stall")), null);
  assert.equal(medallaDe("recta", 1, conTiempo(u.bronce + 5)), null);
  assert.equal(medallaDe("recta", 1, conTiempo(u.plata)), "plata");
  const s = siguiente("recta", 1, conTiempo(u.plata))!;
  assert.equal(s.medalla, "oro");
  assert.equal(s.unidad, "s");
  assert.ok(Math.abs(s.falta - (u.plata - u.oro)) < DT * 2);
});

test("med-3 una versión desconocida da null sin lanzar", () => {
  for (const t of TRACKS) {
    assert.equal(medallaDe(t.id, t.version + 1, metros(5000)), null);
    assert.equal(siguiente(t.id, t.version + 1, metros(5000)), null);
  }
  assert.equal(medallaDe("inventada" as TrackId, 1, metros(5000)), null);
});

test("recuento cuenta las pistas con medalla", () => {
  const todas = Object.fromEntries(TRACKS.map((t) => [t.id, null])) as Record<TrackId, Medalla | null>;
  assert.deepEqual(recuento(todas), { ganadas: 0, total: 10 });
  assert.deepEqual(recuento({ ...todas, recta: "oro", dunas: "bronce" }), { ganadas: 2, total: 10 });
});

test("invariante: medallaDe es monótona (una marca mejor nunca da menos)", () => {
  fc.assert(
    fc.property(fc.constantFrom(...TRACKS), fc.double({ min: 0, max: 6000, noNaN: true }), fc.double({ min: 0, max: 6000, noNaN: true }), (t, a, b) => {
      const [peor, mejor] = a < b ? [a, b] : [b, a];
      const u = UMBRALES[t.id][t.version];
      // En tiempo, «mejor» es menos segundos.
      const mk = (x: number) => (u.tipo === "distancia" ? metros(x) : conTiempo(Math.max(DT, 600 - x / 10)));
      assert.ok(rango(medallaDe(t.id, t.version, mk(mejor))) >= rango(medallaDe(t.id, t.version, mk(peor))));
    }),
  );
});

test("invariante: siguiente.falta > 0 sin autor, y null con autor", () => {
  fc.assert(
    fc.property(fc.constantFrom(...TRACKS), fc.double({ min: 0, max: 6000, noNaN: true }), (t, x) => {
      const u = UMBRALES[t.id][t.version];
      const r = u.tipo === "distancia" ? metros(x) : conTiempo(Math.max(DT, x / 10));
      const m = medallaDe(t.id, t.version, r);
      const s = siguiente(t.id, t.version, r);
      if (m === "autor") assert.equal(s, null);
      else assert.ok(s !== null && s.falta > 0);
    }),
  );
});
