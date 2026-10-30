import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import fc from "fast-check";
import { decodificarCoche, codificarCoche } from "../../src/app/codigo-coche";
import { PHYSICS_VERSION } from "../../src/sim/constants";
import { genomeHash, randomGenome, STOCK_CAR } from "../../src/sim/genome";
import { CAMPEONES_5K } from "../fixtures/campeones-5k";
import { seededRand } from "./helpers/rng";

const MOTIVOS = ["formato-desconocido", "version-formato", "version-fisica", "demasiado-largo", "corrupto", "invalido"];
const COLOR = "#e4572e";
const campeones = Object.values(CAMPEONES_5K).flat();

const b64 = (b: Buffer) => b.toString("base64url");
const codigoDe = (o: unknown) => "DD1." + b64(deflateRawSync(Buffer.from(JSON.stringify(o))));
const sobre = (extra: Record<string, unknown> = {}, g = STOCK_CAR) => ({ v: 1, f: PHYSICS_VERSION, g, n: "Coche", c: COLOR, h: genomeHash(g), ...extra });
const motivoDe = async (t: string) => {
  const r = await decodificarCoche(t);
  assert.equal(r.ok, false);
  return r.ok ? null : r.motivo;
};

test("codigo-1-a: cada campeón vuelve con el mismo hash y cabe en 1200 caracteres", async () => {
  assert.ok(campeones.length > 0);
  for (const g of campeones) {
    const codigo = await codificarCoche({ genome: g!, nombre: "Campeón", color: COLOR });
    assert.match(codigo, /^DD1\.[A-Za-z0-9_-]+$/);
    assert.ok(codigo.length <= 1200, `${codigo.length} caracteres`);
    const r = await decodificarCoche(codigo);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.coche.hash, genomeHash(g!));
      assert.deepEqual(r.coche.genome, g);
      assert.equal(r.coche.nombre, "Campeón");
      assert.equal(r.coche.color, COLOR);
    }
  }
});

// Invariantes 1, 3 y 4 de codigo-coche.
test("codigo-1: ida y vuelta de cualquier coche válido; formato y claves fijos", async () => {
  const nombre = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0);
  const color = fc.integer({ min: 0, max: 0xffffff }).map((n) => "#" + n.toString(16).padStart(6, "0"));
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 1 << 30 }), nombre, color, async (semilla, n, c) => {
      const genome = randomGenome(seededRand(semilla));
      const codigo = await codificarCoche({ genome, nombre: n, color: c });
      assert.match(codigo, /^DD1\.[A-Za-z0-9_-]+$/);
      assert.ok(codigo.length <= 4096);
      const json = JSON.parse(inflateRawSync(Buffer.from(codigo.slice(4), "base64url")).toString());
      assert.deepEqual(Object.keys(json).sort(), ["c", "f", "g", "h", "n", "v"]);
      const r = await decodificarCoche(codigo);
      assert.ok(r.ok);
      if (r.ok) {
        assert.equal(r.coche.hash, genomeHash(genome));
        assert.deepEqual(r.coche.genome, genome);
        assert.equal(r.coche.color, c);
      }
    }),
    { numRuns: 100 },
  );
});

test("codigo-1: nombre de 40 caracteres con tildes y emoji", async () => {
  const nombre = "Ñandú ".repeat(5) + "🚗".repeat(10);
  const limpio = Array.from(nombre).slice(0, 40).join("").trim();
  const r = await decodificarCoche(await codificarCoche({ genome: STOCK_CAR, nombre, color: COLOR }));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.coche.nombre, limpio);
});

test("codigo-2-a: motivos en orden", async () => {
  const codigo = await codificarCoche({ genome: STOCK_CAR, nombre: "Coche", color: COLOR });
  assert.equal(await motivoDe(codigo.slice(0, Math.floor(codigo.length / 2))), "corrupto");
  const m = Math.floor(codigo.length / 2);
  const roto = codigo.slice(0, m) + (codigo[m] === "A" ? "B" : "A") + codigo.slice(m + 1);
  assert.equal(await motivoDe(roto), "corrupto");
  assert.equal(await motivoDe("DD2." + codigo.slice(4)), "version-formato");
  assert.equal(await motivoDe(codigoDe(sobre({ f: PHYSICS_VERSION + 1 }))), "version-fisica");
  const nan = { ...STOCK_CAR, body: STOCK_CAR.body.map((b, i) => (i === 0 ? { ...b, angle: NaN } : b)) };
  assert.equal(await motivoDe(codigoDe(sobre({}, nan))), "invalido");
});

test("codigo-2: cada motivo restante", async () => {
  assert.equal(await motivoDe("hola mundo"), "formato-desconocido");
  assert.equal(await motivoDe(""), "formato-desconocido");
  assert.equal(await motivoDe(codigoDe(sobre({ v: 2 }))), "version-formato");
  assert.equal(await motivoDe(codigoDe(sobre({ h: "0000000000000000" }))), "corrupto");
  assert.equal(await motivoDe(codigoDe(sobre({ extra: 1 }))), "corrupto");
  assert.equal(await motivoDe(codigoDe(sobre({ n: "" }))), "invalido");
  assert.equal(await motivoDe(codigoDe(sobre({ n: "x".repeat(41) }))), "invalido");
  assert.equal(await motivoDe(codigoDe(sobre({ c: "rojo" }))), "invalido");
  assert.equal(await motivoDe(codigoDe(sobre({ g: { v: 1 } }))), "invalido");
  assert.equal(await motivoDe("DD1.!!!"), "corrupto");
});

test("codigo-2: f anterior se acepta; espacios y saltos de línea de los extremos se ignoran", async () => {
  const r = await decodificarCoche("\n  " + codigoDe(sobre({ f: 1 })) + " \n");
  assert.ok(r.ok);
});

test("codigo-2: largo y bomba de deflate", async () => {
  assert.equal(await motivoDe("DD1." + "A".repeat(5000)), "demasiado-largo");
  const bomba = "DD1." + b64(deflateRawSync(Buffer.alloc(1 << 20)));
  assert.ok(bomba.length < 4096);
  const t0 = performance.now();
  assert.equal(await motivoDe(bomba), "demasiado-largo");
  assert.ok(performance.now() - t0 < 200, `${performance.now() - t0} ms`);
});

// Invariante 2: nunca lanza, aunque la entrada sea basura.
test("codigo-2: strings arbitrarios resuelven siempre en ok o en un motivo", async () => {
  const valido = await codificarCoche({ genome: STOCK_CAR, nombre: "Coche", color: COLOR });
  const entrada = fc.oneof(
    fc.string({ maxLength: 300 }),
    fc.string({ maxLength: 300 }).map((s) => "DD1." + s),
    fc.stringMatching(/^[A-Za-z0-9_-]{0,300}$/).map((s) => "DD1." + s),
    fc.tuple(fc.nat(valido.length), fc.constantFrom("A", "-", "_", "9")).map(([i, c]) => valido.slice(0, i) + c + valido.slice(i + 1)),
  );
  await fc.assert(
    fc.asyncProperty(entrada, async (t) => {
      const r = await decodificarCoche(t);
      assert.ok(r.ok || MOTIVOS.includes(r.motivo));
    }),
    { numRuns: 200 },
  );
});

test("codigo-3: el código lleva solo diseño, nombre y color", async () => {
  const sucio = { genome: STOCK_CAR, nombre: "Coche", color: COLOR, marks: { acantilado: 1 }, parents: ["a"], jugador: "Ana" };
  const codigo = await codificarCoche(sucio);
  const json = JSON.parse(inflateRawSync(Buffer.from(codigo.slice(4), "base64url")).toString());
  assert.deepEqual(Object.keys(json), ["v", "f", "g", "n", "c", "h"]);
});
