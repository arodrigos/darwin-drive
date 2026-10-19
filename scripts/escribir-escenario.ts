import { writeFileSync } from "node:fs";

/** Escribe el JSON y su gemelo `.texto.ts`: el bundler lee los números de un .json con un parser que a veces se come el último bit, así que la app carga el texto y hace JSON.parse. */
export function escribirEscenario(rutaJson: URL, datos: unknown): void {
  const json = `${JSON.stringify(datos, null, 1)}\n`;
  writeFileSync(rutaJson, json);
  const texto = new URL(rutaJson.href.replace(/\.json$/, ".texto.ts"));
  writeFileSync(texto, `// Generado por scripts/escribir-escenario.ts: no editar a mano.\nconst texto = ${JSON.stringify(json)};\nexport default texto;\n`);
  console.log(`escrito ${rutaJson.pathname} y ${texto.pathname}`);
}
