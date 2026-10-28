import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { decidir, estadoInicial, SEPARACION_MS, type EventoSonido, type RitmoSonido, type TipoSonido } from "../../src/audio/politica";

const tipo = fc.constantFrom<TipoSonido>("arranque", "record", "especie", "vuelco");
const ritmo = fc.constantFrom<RitmoSonido>("x1", "x2", "x4", "x8", "turbo");
/** generacion como incremento: las generaciones de una Evolución solo avanzan. */
const secuencia = (conRitmo = ritmo, conEncendido = fc.boolean()) =>
  fc.array(fc.record({ tipo, ritmo: conRitmo, encendido: conEncendido, paso: fc.integer({ min: 0, max: 1500 }), salto: fc.integer({ min: 0, max: 1 }) }), { maxLength: 80 });

function correr(eventos: { tipo: TipoSonido; ritmo: RitmoSonido; encendido: boolean; paso: number; salto?: number }[]) {
  let estado = estadoInicial();
  let ahora = 0;
  let generacion = 0;
  return eventos.map((e) => {
    ahora += e.paso;
    generacion += e.salto ?? 0;
    const ev: EventoSonido = { tipo: e.tipo, ritmo: e.ritmo, encendido: e.encendido, ahora, generacion };
    const d = decidir(estado, ev);
    estado = d.estado;
    return { ev, suena: d.suena };
  });
}

test("invariante: nunca suena dos veces el mismo tipo con menos de 1000 ms entre medias", () => {
  fc.assert(
    fc.property(secuencia(), (eventos) => {
      const ultimo: Partial<Record<TipoSonido, number>> = {};
      for (const { ev, suena } of correr(eventos)) {
        if (!suena) continue;
        const previo = ultimo[ev.tipo];
        if (previo !== undefined) assert.ok(ev.ahora - previo >= SEPARACION_MS);
        ultimo[ev.tipo] = ev.ahora;
      }
    }),
    { numRuns: 300 },
  );
});

test("invariante: apagado o en turbo no suena nada", () => {
  fc.assert(
    fc.property(secuencia(), (eventos) => {
      for (const { ev, suena } of correr(eventos)) if (!ev.encendido || ev.ritmo === "turbo") assert.equal(suena, false);
    }),
    { numRuns: 300 },
  );
  // Un ritmo en turbo en medio de una secuencia no gasta la separación de los demás eventos.
  const r = correr([
    { tipo: "arranque", ritmo: "turbo", encendido: true, paso: 0 },
    { tipo: "arranque", ritmo: "x1", encendido: true, paso: 1 },
  ]);
  assert.deepEqual(r.map((x) => x.suena), [false, true]);
});

test("invariante: en Evolución suena como mucho un vuelco por generación", () => {
  fc.assert(
    fc.property(secuencia(fc.constantFrom<RitmoSonido>("x1", "x2", "x4", "x8"), fc.constant(true)), (eventos) => {
      const porGeneracion = new Map<number, number>();
      for (const { ev, suena } of correr(eventos)) {
        if (suena && ev.tipo === "vuelco" && ev.generacion !== undefined) porGeneracion.set(ev.generacion, (porGeneracion.get(ev.generacion) ?? 0) + 1);
      }
      for (const n of porGeneracion.values()) assert.ok(n <= 1);
    }),
    { numRuns: 300 },
  );
});

test("tipos distintos no se pisan entre sí y el mismo vuelve a sonar pasado el segundo", () => {
  const r = correr([
    { tipo: "arranque", ritmo: "x1", encendido: true, paso: 0 },
    { tipo: "record", ritmo: "x1", encendido: true, paso: 10 },
    { tipo: "arranque", ritmo: "x1", encendido: true, paso: 500 },
    { tipo: "arranque", ritmo: "x1", encendido: true, paso: 600 },
  ]);
  assert.deepEqual(r.map((x) => x.suena), [true, true, false, true]);
});
