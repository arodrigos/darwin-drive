import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Los tokens de color de los controles salen del propio globals.css: si alguien los cambia, el contraste se vuelve a medir.
const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
const token = (n: string) => {
  const m = css.match(new RegExp(`--${n}:\\s*#([0-9a-fA-F]{6})`));
  assert.ok(m, `falta el token --${n}`);
  return parseInt(m[1], 16);
};

function luminancia(c: number): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f((c >> 16) & 255) + 0.7152 * f((c >> 8) & 255) + 0.0722 * f(c & 255);
}
const contraste = (a: number, b: number) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("por-4: texto del primario ≥ 4,5:1 con su fondo", () => {
  assert.ok(contraste(token("texto"), token("primario")) >= 4.5);
});
test("por-4: texto de secundarios y terciarios ≥ 4,5:1 y borde del secundario ≥ 3:1 con el panel de la zona", () => {
  assert.ok(contraste(token("texto"), token("panel")) >= 4.5);
  assert.ok(contraste(token("borde-control"), token("panel")) >= 3);
});
