#!/usr/bin/env node
// at-8: el repo es público y lo ya borrado sigue en el historial, así que
// lo que no debe salir de la casa se frena antes de entrar: ids de run,
// nombres de infraestructura y rutas de máquina. Mira solo lo versionado
// (git ls-files) para que node_modules o .next no den falsos positivos.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATRONES = [
  { nombre: "id de run", re: /[0-9]{8}-[0-9]{6}-[0-9a-f]{4}/ },
  { nombre: "nombre de infraestructura", re: /VPS[12]|claude-fleet|tailscale/i },
  { nombre: "ruta de máquina", re: /\/home\/claude-user/ },
];
// Este fichero declara los patrones, así que se describe a sí mismo.
const EXCLUIDOS = new Set(["package-lock.json", "scripts/comprobar-publico.mjs"]);

// Los ficheros extra permiten probar el caso negativo con uno temporal sin
// versionar: `node scripts/comprobar-publico.mjs /tmp/fichero`.
const versionados = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\0")
  .filter((f) => f && !EXCLUIDOS.has(f));
const ficheros = [...versionados, ...process.argv.slice(2)];

const hallazgos = [];
for (const fichero of ficheros) {
  let texto;
  try {
    texto = readFileSync(fichero, "utf8");
  } catch {
    continue;
  }
  if (texto.includes("\0")) continue;
  texto.split("\n").forEach((linea, i) => {
    for (const { nombre, re } of PATRONES) {
      if (re.test(linea)) hallazgos.push(`${fichero}:${i + 1}: ${nombre}`);
    }
  });
}

if (hallazgos.length > 0) {
  console.error(`comprobar-publico: ${hallazgos.length} hallazgo(s) que no deben estar en un repo público:`);
  for (const h of hallazgos) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`comprobar-publico: OK (${ficheros.length} ficheros)`);
