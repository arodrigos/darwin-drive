#!/usr/bin/env node
// El núcleo (src/sim y src/evolution) se ejecuta entero en Node: si importara
// phaser, react o next, o tocara window/document, un test de Node no probaría
// lo que corre en el navegador.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// FRONTERA_RAICES solo lo usa la prueba del propio script, para comprobar que se pone en rojo con un fixture.
const RAICES = process.env.FRONTERA_RAICES ? process.env.FRONTERA_RAICES.split(",") : ["src/sim", "src/evolution"];
const PROHIBIDO = [
  { nombre: "import de phaser/react/next", re: /from\s+["'](phaser|react|react-dom|next)(\/[^"']*)?["']|require\(["'](phaser|react|next)/ },
  { nombre: "import de audio (zzfx o src/audio)", re: /from\s+["'](zzfx|@\/audio)(\/[^"']*)?["']|import\(["']zzfx["']\)|from\s+["'](\.\.?\/)+audio(\/[^"']*)?["']/ },
  { nombre: "global de navegador", re: /\b(window|document|navigator|localStorage|indexedDB)\b\s*[.[]/ },
];

function ficheros(dir) {
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return [];
  }
  return entradas.flatMap((e) => {
    const ruta = path.join(dir, e);
    return statSync(ruta).isDirectory() ? ficheros(ruta) : /\.(ts|tsx|mjs|js)$/.test(e) ? [ruta] : [];
  });
}

const hallazgos = [];
let total = 0;
for (const raiz of RAICES) {
  for (const f of ficheros(raiz)) {
    total++;
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((linea, i) => {
        if (/^\s*(\/\/|\*)/.test(linea)) return;
        for (const { nombre, re } of PROHIBIDO) if (re.test(linea)) hallazgos.push(`${f}:${i + 1}: ${nombre}`);
      });
  }
}
if (hallazgos.length > 0) {
  console.error("comprobar-frontera-nucleo: el núcleo toca el navegador o la cáscara:");
  for (const h of hallazgos) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`comprobar-frontera-nucleo: OK (${total} ficheros)`);
