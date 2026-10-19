import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
