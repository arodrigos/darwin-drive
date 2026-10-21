import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fc from "fast-check";
import { DEFAULT_TRACK_ID, TRACKS, getTrack } from "../../src/sim/tracks";
import {
  FLAT_START,
  MAX_SLOPE_DEG,
  SEGMENT_LENGTH,
  VERTEX_SPACING,
  segmentVertices,
  trackProfile,
} from "../../src/sim/terrain";
import { enRespiro } from "../../src/sim/dificultad";
import { hashPista } from "./helpers/hash-pistas";

// Hashes fijados de heightAt(x) con x = 0, 0,5 ... 4999,5. Si cambian a
// propósito, hay que subir la versión de la pista (las marcas guardadas se
// vuelven a medir con ella) y actualizar el hash aquí.
const HASH_REFERENCIA: Record<string, string> = {
  cordillera: "fff913b12dc5c24d991cb06c426610a68d5608086fd186164d95b04b91c45ac7",
  rampa: "0e99dc267d9bdd3c91b9349aead2f58e29bfa689ac83d9dd5c5d549e7fafdcd5",
  dunas: "85e9457eda81c71f5977a2bcb7899a4f59f898f55233dc3740661887c876e5c2",
  pedregal: "3ed1e4508f4617ef5a7830e182c1b31a37679971ad2b730ff4925fd1f088029d",
};

const MAX_DY = Math.tan((MAX_SLOPE_DEG * Math.PI) / 180) * VERTEX_SPACING;

test("at-1-hash: las cuatro pistas dan el hash fijado, en dos procesos, y son distintas", () => {
  const otroProceso = JSON.parse(
    execFileSync(process.execPath, ["--import", "tsx", "tests/unit/helpers/hash-pistas.ts", "imprimir"], {
      encoding: "utf8",
    }),
  ) as Record<string, string>;
  const vistos = new Set<string>();
  for (const t of TRACKS) {
    const h = hashPista(t.heightAt);
    assert.equal(h, HASH_REFERENCIA[t.id], `hash de ${t.id}`);
    assert.equal(otroProceso[t.id], h, `${t.id} en un segundo proceso`);
    vistos.add(h);
  }
  assert.equal(vistos.size, 4);
});

test("at-1-hash límites: salida llana, final finito, getTrack desconocido", () => {
  for (const t of TRACKS) {
    assert.equal(t.heightAt(0), 0);
    assert.equal(t.heightAt(10), 0);
    assert.ok(Number.isFinite(t.heightAt(4999.5)), `${t.id} finito en 4999,5`);
  }
  assert.equal(getTrack("volcan"), null);
  assert.equal(getTrack(3), null);
  assert.equal(getTrack(undefined), null);
  assert.equal(DEFAULT_TRACK_ID, "cordillera");
  assert.deepEqual(
    TRACKS.map((t) => t.id),
    ["cordillera", "rampa", "dunas", "pedregal"],
  );
});

test("at-1-costuras: 199 de 199 uniones idénticas y sin paredes", () => {
  for (const t of TRACKS) {
    let uniones = 0;
    let prev = segmentVertices(t, 0);
    for (let i = 1; i < 200; i++) {
      const cur = segmentVertices(t, i);
      assert.ok(prev[prev.length - 1].x === cur[0].x && prev[prev.length - 1].y === cur[0].y, `${t.id} tramo ${i}`);
      uniones++;
      prev = cur;
    }
    assert.equal(uniones, 199);
    for (let i = 0; i < 200; i++) {
      const v = segmentVertices(t, i);
      assert.equal(v.length, SEGMENT_LENGTH / VERTEX_SPACING + 1);
      for (let k = 1; k < v.length; k++) assert.ok(Math.abs(v[k].y - v[k - 1].y) <= MAX_DY + 1e-9);
    }
  }
});

// Invariantes (P19) como property tests sobre las cuatro pistas.
test("invariante: heightAt es pura y finita en cualquier orden de llamada", () => {
  fc.assert(
    fc.property(fc.double({ min: -50, max: 8000, noNaN: true }), fc.double({ min: -50, max: 8000, noNaN: true }), (a, b) => {
      for (const t of TRACKS) {
        const ya = t.heightAt(a);
        t.heightAt(b);
        assert.equal(t.heightAt(a), ya);
        assert.ok(Number.isFinite(ya));
      }
    }),
    { numRuns: 300 },
  );
});

test("invariante: heightAt = 0 en [0, FLAT_START]", () => {
  fc.assert(
    fc.property(fc.double({ min: 0, max: FLAT_START, noNaN: true }), (x) => {
      for (const t of TRACKS) assert.equal(t.heightAt(x), 0);
    }),
    { numRuns: 200 },
  );
});

test("invariante: el último vértice de un tramo es idéntico al primero del siguiente", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 2000 }), (i) => {
      for (const t of TRACKS) {
        const a = segmentVertices(t, i);
        const b = segmentVertices(t, i + 1);
        assert.ok(a[a.length - 1].x === b[0].x && a[a.length - 1].y === b[0].y);
      }
    }),
    { numRuns: 200 },
  );
});

test("invariante: entre vértices consecutivos |Δy| ≤ tan(70°)·0,5", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 4000 }), (k) => {
      for (const t of TRACKS) {
        const x = k * VERTEX_SPACING;
        assert.ok(Math.abs(t.heightAt(x + VERTEX_SPACING) - t.heightAt(x)) <= MAX_DY + 1e-9, `${t.id} en ${x}`);
      }
    }),
    { numRuns: 300 },
  );
});

test("invariante: ids únicos y getTrack devuelve cada pista, null para el resto", () => {
  assert.equal(new Set(TRACKS.map((t) => t.id)).size, TRACKS.length);
  for (const t of TRACKS) assert.equal(getTrack(t.id), t);
  fc.assert(
    fc.property(fc.anything(), (v) => {
      const esConocido = TRACKS.some((t) => t.id === v);
      assert.equal(getTrack(v) !== null, esConocido);
    }),
    { numRuns: 300 },
  );
});

test("trackProfile devuelve las muestras pedidas, equiespaciadas", () => {
  for (const t of TRACKS) {
    const p = trackProfile(t, 600, 60);
    assert.equal(p.length, 60);
    assert.equal(p[0], 0);
    assert.equal(p[59], t.heightAt(600));
  }
});

// at-2: una tabla por pista en la salida y fallo si falta el carácter.
function crestas(f: (x: number) => number, a: number, b: number): number {
  let n = 0;
  for (let x = a + VERTEX_SPACING; x < b; x += VERTEX_SPACING) {
    if (f(x) > f(x - VERTEX_SPACING) && f(x) >= f(x + VERTEX_SPACING)) n++;
  }
  return n;
}
function gradoMax(f: (x: number) => number, a: number, b: number): number {
  let m = 0;
  for (let x = a; x < b; x += VERTEX_SPACING) {
    m = Math.max(m, (Math.atan(Math.abs(f(x + VERTEX_SPACING) - f(x)) / VERTEX_SPACING) * 180) / Math.PI);
  }
  return m;
}
const pista = (id: string) => {
  const t = getTrack(id);
  assert.ok(t);
  return t.heightAt;
};

test("at-2 La Cordillera: la rugosidad crece en los primeros 900 m, no se hunde después y hay más de 30° desde 1500 m", () => {
  const f = pista("cordillera");
  const filas: { ventana: string; rugosidad: number }[] = [];
  for (let a = 0; a < 1800; a += 300) {
    let s = 0;
    let n = 0;
    for (let x = a; x < a + 300; x += VERTEX_SPACING) {
      s += Math.abs(f(x + VERTEX_SPACING) - f(x));
      n++;
    }
    filas.push({ ventana: `${a}-${a + 300} m`, rugosidad: Number((s / n).toFixed(3)) });
  }
  console.table(filas);
  for (let i = 1; i <= 2; i++) assert.ok(filas[i].rugosidad > filas[i - 1].rugosidad, filas[i].ventana);
  for (let i = 3; i < filas.length; i++) assert.ok(filas[i].rugosidad > filas[2].rugosidad * 0.8, filas[i].ventana);
  assert.ok(gradoMax(f, 1500, 5000) > 30);
});

test("at-2 La Rampa: la pendiente no decrece fuera de los respiros y llega a 45° a los 500 m", () => {
  const f = pista("rampa");
  const filas: { x: number; grados: number }[] = [];
  let previo = -1;
  for (let x = 0; x <= 1000; x += VERTEX_SPACING) {
    const g = (Math.atan((f(x + VERTEX_SPACING) - f(x)) / VERTEX_SPACING) * 180) / Math.PI;
    // Los respiros bajan la pendiente a propósito: se reinicia la comparación al salir.
    if (enRespiro(x - FLAT_START) || enRespiro(x - FLAT_START - VERTEX_SPACING)) previo = -1;
    else assert.ok(g >= previo - 1e-6, `la pendiente decrece en ${x}`);
    previo = Math.max(previo, g);
    if (x % 100 === 0) filas.push({ x, grados: Number(g.toFixed(1)) });
  }
  console.table(filas);
  const en500 = (Math.atan((f(500.5) - f(500)) / VERTEX_SPACING) * 180) / Math.PI;
  assert.ok(en500 >= 45, `pendiente a 500 m: ${en500}`);
});

test("at-2 Las Dunas: la amplitud por ventana de 100 m sube en la primera y se mantiene bajo el tope; ≥2 crestas cada 50 m", () => {
  const f = pista("dunas");
  const amps: number[] = [];
  const filas: { ventana: string; amplitud: number }[] = [];
  for (let a = 10; a < 910; a += 100) {
    let mn = Infinity;
    let mx = -Infinity;
    for (let x = a; x < a + 100; x += VERTEX_SPACING) {
      mn = Math.min(mn, f(x));
      mx = Math.max(mx, f(x));
    }
    amps.push((mx - mn) / 2);
    filas.push({ ventana: `${a}-${a + 100} m`, amplitud: Number(((mx - mn) / 2).toFixed(2)) });
  }
  console.table(filas);
  // La curva llega pronto a su techo: la primera ventana es la más pequeña y el resto oscila bajo 7 m.
  assert.ok(amps[1] > amps[0] * 1.4);
  for (let i = 1; i < amps.length; i++) assert.ok(amps[i] > 4 && amps[i] <= 7 + 1e-9, `ventana ${i}`);
  for (let a = 10; a < 4000; a += 50) assert.ok(crestas(f, a, a + 50) >= 2, `crestas en ${a}`);
});

test("at-2 El Pedregal: ≥15 máximos cada 100 m desde 500 m y piedras mayores lejos", () => {
  const f = pista("pedregal");
  const altura = (a: number, b: number) => {
    let s = 0;
    let n = 0;
    for (let c = a; c < b; c += 4) {
      let mn = Infinity;
      let mx = -Infinity;
      for (let x = c; x < c + 4; x += VERTEX_SPACING) {
        mn = Math.min(mn, f(x));
        mx = Math.max(mx, f(x));
      }
      s += mx - mn;
      n++;
    }
    return s / n;
  };
  const cerca = altura(100, 200);
  const lejos = altura(1500, 1600);
  console.table([
    { ventana: "100-200 m", alturaMediaPiedra: Number(cerca.toFixed(3)) },
    { ventana: "1500-1600 m", alturaMediaPiedra: Number(lejos.toFixed(3)) },
  ]);
  assert.ok(lejos > cerca);
  for (let a = 500; a < 4900; a += 100) assert.ok(crestas(f, a, a + 100) >= 15, `máximos en ${a}`);
});
