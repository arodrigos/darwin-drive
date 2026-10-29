import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { DEFAULT_META, validateMeta } from "../../src/storage/meta";

type Oyente = () => void;
const oyentes = new Map<string, Oyente[]>();
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    visibilityState: "visible",
    addEventListener: (n: string, f: Oyente) => oyentes.set(n, [...(oyentes.get(n) ?? []), f]),
    removeEventListener: () => {},
  },
});

function navegador(audioSession?: { type: string }) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: audioSession ? { audioSession } : {} });
}

function zzfxFalso(estado = "suspended") {
  const jugadas: number[][][] = [];
  const ctx = { state: estado, resume: async () => void (ctx.state = "running"), suspend: async () => void (ctx.state = "suspended") };
  const modulo = { ZZFX: { volume: 0.3, audioContext: ctx as unknown as AudioContext, buildSamples: (...p: number[]) => p, playSamples: (c: number[][]) => (jugadas.push(c), {} as AudioBufferSourceNode) } };
  return { modulo, jugadas, ctx };
}

// El adaptador guarda estado de módulo: inyectarCargadorZzfx lo deja de cero en cada prueba.
async function cargarAdaptador() {
  return import("../../src/audio/sonido");
}

beforeEach(() => oyentes.clear());

test("al encender, la sesión de audio queda en 'ambient' y nunca en 'playback'", async () => {
  const sesion = { type: "auto" };
  navegador(sesion);
  const a = await cargarAdaptador();
  const { modulo } = zzfxFalso();
  a.inyectarCargadorZzfx(async () => modulo);
  a.iniciarSonido(false, () => {});
  a.alternarSonido();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sesion.type, "ambient");
  assert.equal(a.sonidos().sesion, "ambient");
  assert.equal(a.sonidos().contexto, "running");
  assert.equal(a.sonidos().cargado, true);
});

test("sin audioSession no hay error y la sesión es null", async () => {
  navegador();
  const a = await cargarAdaptador();
  const { modulo } = zzfxFalso();
  a.inyectarCargadorZzfx(async () => modulo);
  a.iniciarSonido(false, () => {});
  a.alternarSonido();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(a.sonidos().sesion, null);
  assert.equal(a.sonidos().error, null);
  assert.equal(a.sonidos().cargado, true);
});

test("con el sonido encendido en la Meta no se carga nada hasta el primer gesto", async () => {
  navegador();
  const a = await cargarAdaptador();
  const { modulo, jugadas } = zzfxFalso();
  let cargas = 0;
  a.inyectarCargadorZzfx(async () => (cargas++, modulo));
  a.iniciarSonido(true, () => {});
  a.sonar("arranque", { ritmo: "x1" });
  assert.equal(cargas, 0);
  assert.equal(a.sonidos().cargado, false);
  assert.equal(jugadas.length, 0);
  oyentes.get("pointerdown")![0]();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(cargas, 1);
  a.sonar("arranque", { ritmo: "x1" });
  assert.equal(a.sonidos().arranque, 1);
  assert.equal(jugadas.length, 1);
});

test("apagado no suena, y alternar avisa para guardar el ajuste", async () => {
  navegador();
  const a = await cargarAdaptador();
  const { modulo } = zzfxFalso();
  a.inyectarCargadorZzfx(async () => modulo);
  const guardados: boolean[] = [];
  a.iniciarSonido(false, (v) => guardados.push(v));
  a.sonar("record", { ritmo: "x1" });
  assert.equal(a.sonidos().record, 0);
  a.alternarSonido();
  await new Promise((r) => setTimeout(r, 10));
  a.sonar("record", { ritmo: "turbo" });
  assert.equal(a.sonidos().record, 0);
  a.sonar("record", { ritmo: "x1" });
  assert.equal(a.sonidos().record, 1);
  a.alternarSonido();
  assert.deepEqual(guardados, [true, false]);
});

test("si ZzFX no carga el juego sigue mudo y el error queda registrado", async () => {
  navegador();
  const a = await cargarAdaptador();
  a.inyectarCargadorZzfx(async () => {
    throw new Error("sin AudioContext");
  });
  a.iniciarSonido(false, () => {});
  a.alternarSonido();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(a.sonidos().encendido, true);
  assert.equal(a.sonidos().cargado, false);
  assert.equal(a.sonidos().error, "sin AudioContext");
  a.sonar("arranque", { ritmo: "x1" });
  assert.equal(a.sonidos().arranque, 0);
});

test("Meta: sonido apagado por defecto, tolerante si falta y true solo con true (invariante)", () => {
  assert.equal(DEFAULT_META.sonido, false);
  const { sonido: _sin, ...antigua } = DEFAULT_META;
  assert.equal(validateMeta(antigua)?.sonido, false);
  assert.equal(validateMeta({ ...DEFAULT_META, sonido: "sí" })?.sonido, false);
  assert.equal(validateMeta({ ...DEFAULT_META, sonido: true })?.sonido, true);
  fc.assert(
    fc.property(fc.anything(), (v) => {
      const m = validateMeta({ ...DEFAULT_META, lastTrack: "rampa", ritmo: "x4", sonido: v });
      assert.ok(m, "un valor cualquiera en sonido no invalida la Meta");
      assert.equal(m.sonido, v === true);
      assert.equal(m.ritmo, "x4");
      assert.equal(m.lastTrack, "rampa");
    }),
    { numRuns: 300 },
  );
});

test("zzfx solo se importa de forma dinámica desde src/audio/sonido.ts", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const path = await import("node:path");
  const ficheros = (d: string): string[] => readdirSync(d).flatMap((e) => (statSync(path.join(d, e)).isDirectory() ? ficheros(path.join(d, e)) : /\.(ts|tsx)$/.test(e) ? [path.join(d, e)] : []));
  for (const f of ficheros("src")) {
    const t = readFileSync(f, "utf8");
    assert.ok(!/(from|import)\s+["']zzfx["']/.test(t), `${f}: import estático de zzfx`);
    if (/import\(\s*["']zzfx["']\s*\)/.test(t)) assert.equal(f, path.join("src", "audio", "sonido.ts"));
  }
});
