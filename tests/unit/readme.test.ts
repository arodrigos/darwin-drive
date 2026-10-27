import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";

// Títulos que el traspaso del producto exige que el README conserve tal cual.
const TITULOS_EXIGIDOS = [
  "Cómo jugar",
  "El Taller",
  "Modo batalla",
  "La carrera",
  "Cómo arrancar",
  "Variables de entorno",
  "Pistas y rankings",
  "Clasificación y desempates",
  "Fragilidad",
  "Guardado en el dispositivo",
  "Versiones de pista y migración",
  "Pruebas",
  "Modo pruebas",
];

const RAIZ = process.cwd();

/** Rutas de src/, tests/ o scripts/ citadas entre comillas invertidas; los comodines no son una ruta. */
function rutasCitadas(readme: string): string[] {
  const rutas = new Set<string>();
  for (const m of readme.matchAll(/`((?:src|tests|scripts)\/[^`\s]+)`/g)) {
    if (!/[*<>{}]/.test(m[1])) rutas.add(m[1]);
  }
  return [...rutas];
}

function scriptsCitados(readme: string): string[] {
  return [...new Set([...readme.matchAll(/npm run ([\w:.-]+)/g)].map((m) => m[1]))];
}

function titulos(readme: string): Set<string> {
  return new Set([...readme.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].trim()));
}

/** Devuelve lo que el README cita y no existe; vacío si está al día. */
function desfases(readme: string, scripts: Record<string, string>): string[] {
  const fallos: string[] = [];
  for (const r of rutasCitadas(readme)) {
    if (!existsSync(path.join(RAIZ, r))) fallos.push(`ruta inexistente: ${r}`);
  }
  for (const s of scriptsCitados(readme)) {
    if (!(s in scripts)) fallos.push(`script inexistente: npm run ${s}`);
  }
  const hay = titulos(readme);
  for (const t of TITULOS_EXIGIDOS) {
    if (!hay.has(t)) fallos.push(`falta el título: ${t}`);
  }
  return fallos;
}

const readme = readFileSync(path.join(RAIZ, "README.md"), "utf8");
const scripts = (JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

test("rd-1: el README real no cita rutas, scripts ni títulos que no existan", () => {
  assert.deepEqual(desfases(readme, scripts), []);
});

test("rd-1: cita rutas y scripts de verdad (la prueba no pasa en vacío)", () => {
  assert.ok(rutasCitadas(readme).length >= 10);
  assert.ok(scriptsCitados(readme).length >= 8);
});

test("rd-1: falla si el README cita una ruta inexistente", () => {
  const copia = `${readme}\nVer \`src/game/no-existe.ts\`.\n`;
  assert.deepEqual(desfases(copia, scripts), ["ruta inexistente: src/game/no-existe.ts"]);
});

test("rd-1: falla si el README cita un script inexistente", () => {
  const copia = `${readme}\n\`npm run no-existe:nada\`\n`;
  assert.deepEqual(desfases(copia, scripts), ["script inexistente: npm run no-existe:nada"]);
});

test("rd-1: falla si falta un título exigido", () => {
  const copia = readme.replace("## Fragilidad", "## Otra cosa");
  assert.deepEqual(desfases(copia, scripts), ["falta el título: Fragilidad"]);
});

// Invariante: cualquier ruta que no exista, citada donde sea, se detecta.
test("rd-1 (propiedad): toda ruta citada que no existe se marca", () => {
  const nombre = fc.stringMatching(/^[a-z]{3,12}$/);
  fc.assert(
    fc.property(fc.constantFrom("src", "tests", "scripts"), nombre, nombre, (raiz, a, b) => {
      const ruta = `${raiz}/zz-${a}/${b}-inexistente.ts`;
      assert.ok(desfases(`${readme}\n\`${ruta}\`\n`, scripts).includes(`ruta inexistente: ${ruta}`));
    }),
    { numRuns: 100 },
  );
});

// Invariante: cualquier script citado que no esté en package.json se marca.
test("rd-1 (propiedad): todo npm run citado que no existe se marca", () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[a-z]{3,10}:[a-z]{3,10}$/), (s) => {
      fc.pre(!(s in scripts));
      assert.ok(desfases(`${readme}\nnpm run ${s}\n`, scripts).includes(`script inexistente: npm run ${s}`));
    }),
    { numRuns: 100 },
  );
});
