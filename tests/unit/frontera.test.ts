import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const RAICES = ["src/sim", "src/evolution"];
const PERMITIDOS = new Set(["planck", "simplex-noise", "pure-rand/generator/xoroshiro128plus", "pure-rand/distribution/uniformInt"]);

function ficheros(dir: string): string[] {
  let entradas: string[];
  try {
    entradas = readdirSync(dir);
  } catch {
    return [];
  }
  return entradas.flatMap((e) => {
    const ruta = path.join(dir, e);
    return statSync(ruta).isDirectory() ? ficheros(ruta) : /\.tsx?$/.test(e) ? [ruta] : [];
  });
}

test("nf-8: el núcleo solo importa módulos relativos, planck o simplex-noise y no usa window ni document", () => {
  const todos = RAICES.flatMap(ficheros);
  assert.ok(todos.length >= 8, `se esperaban los ficheros del núcleo, hay ${todos.length}`);
  for (const f of todos) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = m[1];
      if (spec.startsWith(".")) continue;
      assert.ok(PERMITIDOS.has(spec), `${f} importa «${spec}»`);
    }
    assert.ok(!/\b(window|document|navigator|localStorage|indexedDB)\b\s*[.[]/.test(src.replace(/^\s*(\/\/|\*).*$/gm, "")), `${f} toca el navegador`);
  }
});

test("so-7: verificar:frontera-nucleo da verde con el núcleo real y rojo si importa zzfx o src/audio", () => {
  const correr = (raices?: string) => spawnSync("node", ["scripts/comprobar-frontera-nucleo.mjs"], { encoding: "utf8", env: { ...process.env, ...(raices ? { FRONTERA_RAICES: raices } : {}) } });
  assert.equal(correr().status, 0);
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), "frontera-"));
  try {
    for (const [nombre, linea] of [
      ["zzfx", 'import { zzfx } from "zzfx";'],
      ["dinamico", 'const m = import("zzfx");'],
      ["alias", 'import { sonar } from "@/audio/sonido";'],
      ["relativo", 'import { sonar } from "../audio/sonido";'],
    ]) {
      const sub = path.join(dir, nombre);
      mkdirSync(sub);
      writeFileSync(path.join(sub, "x.ts"), `${linea}\nexport const x = 1;\n`);
      const r = correr(sub);
      assert.equal(r.status, 1, `${nombre}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /audio/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
