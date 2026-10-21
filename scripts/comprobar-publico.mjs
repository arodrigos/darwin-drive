#!/usr/bin/env node
// Uso: node scripts/comprobar-publico.mjs [--commits <rango>] [--texto <texto>] [fichero...]
//   --commits  mira también los mensajes de commit del rango (p. ej. base..head de un PR).
//   --texto    mira también ese texto (título y cuerpo del PR).
//   PATRONES_PUBLICO_EXTRA: más patrones literales, separados por comas o saltos de línea.
// at-8: el repo es público y lo ya borrado sigue en el historial, así que
// lo que no debe salir de la casa se frena antes de entrar: ids de run,
// nombres de infraestructura y rutas de máquina. Mira solo lo versionado
// (git ls-files) para que node_modules o .next no den falsos positivos.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Una línea vacía no es un patrón: casaría con todo.
const EXTRA = (process.env.PATRONES_PUBLICO_EXTRA ?? "")
  .split(/[,\n]/)
  .map((t) => t.trim())
  .filter(Boolean)
  .map((t) => ({ nombre: "patrón extra", re: new RegExp(escapar(t), "i") }));
const PATRONES = [
  { nombre: "id de run", re: /[0-9]{8}-[0-9]{6}-[0-9a-f]{4}/ },
  { nombre: "nombre de infraestructura", re: /VPS[12]|claude-fleet|tailscale/i },
  { nombre: "ruta de máquina", re: /\/home\/claude-user/ },
  ...EXTRA,
];
// Este fichero declara los patrones, así que se describe a sí mismo.
const EXCLUIDOS = new Set(["package-lock.json", "scripts/comprobar-publico.mjs"]);

// Los ficheros extra permiten probar el caso negativo con uno temporal sin
// versionar: `node scripts/comprobar-publico.mjs /tmp/fichero`.
const versionados = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\0")
  .filter((f) => f && !EXCLUIDOS.has(f));

let rango = null;
let texto = null;
const extras = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--commits") rango = args[++i];
  else if (args[i] === "--texto") texto = args[++i] ?? "";
  else extras.push(args[i]);
}
const ficheros = [...versionados, ...extras];

const hallazgos = [];
const revisarTexto = (origen, contenido) => {
  contenido.split("\n").forEach((linea, i) => {
    for (const { nombre, re } of PATRONES) {
      if (re.test(linea)) hallazgos.push(`${origen}:${i + 1}: ${nombre}`);
    }
  });
};
if (rango) {
  // Lo ya borrado de un PR sigue en el historial público, así que también los mensajes cuentan.
  const log = execFileSync("git", ["log", "--format=%H%x00%B%x00", rango], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const partes = log.split("\0");
  for (let i = 0; i + 1 < partes.length; i += 2) revisarTexto(`mensaje de commit ${partes[i].trim().slice(0, 7)}`, partes[i + 1]);
}
if (texto !== null) revisarTexto("texto del PR", texto);
for (const fichero of ficheros) {
  let contenido;
  try {
    contenido = readFileSync(fichero, "utf8");
  } catch {
    continue;
  }
  if (contenido.includes("\0")) continue;
  revisarTexto(fichero, contenido);
}

if (hallazgos.length > 0) {
  console.error(`comprobar-publico: ${hallazgos.length} hallazgo(s) que no deben estar en un repo público:`);
  for (const h of hallazgos) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`comprobar-publico: OK (${ficheros.length} ficheros${rango ? ", commits " + rango : ""}${texto !== null ? ", texto del PR" : ""})`);
