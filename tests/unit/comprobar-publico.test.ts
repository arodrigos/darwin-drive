import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";

const SCRIPT = path.resolve("scripts/comprobar-publico.mjs");
// Armado a trozos: este fichero está versionado y la propia comprobación lo vería.
const INFRA = "VP" + "S1";

function repoTemporal(): string {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), "publico-"));
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: dir });
  git("init", "-q");
  writeFileSync(path.join(dir, "a.txt"), "limpio\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "feat: primero");
  writeFileSync(path.join(dir, "b.txt"), "limpio\n");
  git("add", "b.txt");
  git("commit", "-q", "-m", "feat: segundo limpio");
  writeFileSync(path.join(dir, "c.txt"), "limpio\n");
  git("add", "c.txt");
  git("commit", "-q", "-m", `fix: corre en ${INFRA}`);
  return dir;
}

function correr(dir: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("node", [SCRIPT, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, PATRONES_PUBLICO_EXTRA: "", ...env } });
  return { code: r.status, salida: r.stdout + r.stderr };
}

test("rit-9: --commits señala el mensaje con un nombre de infraestructura y deja pasar el rango limpio", () => {
  const dir = repoTemporal();
  const malo = correr(dir, ["--commits", "HEAD~2..HEAD"]);
  assert.equal(malo.code, 1);
  assert.match(malo.salida, /mensaje de commit/);
  const limpio = correr(dir, ["--commits", "HEAD~2..HEAD~1"]);
  assert.equal(limpio.code, 0, limpio.salida);
});

test("rit-9: --texto y PATRONES_PUBLICO_EXTRA", () => {
  const dir = repoTemporal();
  assert.equal(correr(dir, ["--texto", "nada raro"]).code, 0);
  assert.equal(correr(dir, ["--texto", "contiene zz-patron-prueba"]).code, 0);
  const r = correr(dir, ["--texto", "contiene zz-patron-prueba"], { PATRONES_PUBLICO_EXTRA: "zz-patron-prueba" });
  assert.equal(r.code, 1);
  assert.match(r.salida, /texto del PR/);
});

test("rit-9: sin --commits ni --texto se comporta como siempre, y una línea vacía de patrones no casa con todo", () => {
  const dir = repoTemporal();
  assert.equal(correr(dir, []).code, 0);
  assert.equal(correr(dir, ["--texto", "hola"], { PATRONES_PUBLICO_EXTRA: "\n,\n  \n" }).code, 0);
});

test("rit-9 (propiedad): con un patrón dentro del texto sale 1 por cualquier vía, y sin él sale 0", () => {
  const dir = repoTemporal();
  const sinPatron = fc.stringMatching(/^[a-z ]{0,20}$/);
  fc.assert(
    fc.property(sinPatron, sinPatron, fc.constantFrom(INFRA, "tail" + "scale", "/home/" + "claude-user"), (antes, despues, patron) => {
      assert.equal(correr(dir, ["--texto", `${antes}${patron}${despues}`]).code, 1);
      assert.equal(correr(dir, ["--texto", `${antes}${despues}`]).code, 0);
    }),
    { numRuns: 8 },
  );
});
