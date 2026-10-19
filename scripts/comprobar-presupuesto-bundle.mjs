#!/usr/bin/env node
// at-4: el JS que llega al navegador en el primer arranque del
// juego no puede superar el presupuesto comprimido. La app tiene una sola
// ruta ("/"), así que todos los chunks bajo .next/static/chunks/ son, sin
// excepción, JS que esa ruta necesita para arrancar (el runtime de Next, la página y -- vía import() dinámico -- Phaser y
// el propio juego). Si en el futuro aparecen más rutas que no sean el juego, este
// script habrá que ajustarlo para filtrar por los chunks reales de "/".
//
import { readdir, readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const PRESUPUESTO_BYTES = 1.3 * 1024 * 1024;
const DIRECTORIO_CHUNKS = path.join(process.cwd(), ".next/static/chunks");

async function main() {
  let entradas;
  try {
    entradas = await readdir(DIRECTORIO_CHUNKS);
  } catch {
    console.error(
      `No se encuentra ${DIRECTORIO_CHUNKS}. Ejecuta "npm run build" antes de comprobar el presupuesto.`,
    );
    process.exit(1);
  }

  const ficherosJs = entradas.filter((nombre) => nombre.endsWith(".js"));
  const medidas = [];
  let totalGzip = 0;

  for (const nombre of ficherosJs) {
    const ruta = path.join(DIRECTORIO_CHUNKS, nombre);
    if (!(await stat(ruta)).isFile()) continue;
    const contenido = await readFile(ruta);
    const gzip = gzipSync(contenido).length;
    totalGzip += gzip;
    medidas.push({ nombre, gzip });
  }

  medidas.sort((a, b) => b.gzip - a.gzip);
  for (const { nombre, gzip } of medidas) {
    console.log(`${(gzip / 1024).toFixed(1).padStart(8)} KB  ${nombre}`);
  }
  console.log("---");
  console.log(
    `Total: ${(totalGzip / 1024).toFixed(1)} KB gzip (presupuesto: ${(PRESUPUESTO_BYTES / 1024).toFixed(0)} KB)`,
  );

  if (totalGzip > PRESUPUESTO_BYTES) {
    console.error(
      `Presupuesto de bundle excedido: ${(totalGzip / 1024).toFixed(1)} KB > ${(PRESUPUESTO_BYTES / 1024).toFixed(0)} KB`,
    );
    process.exit(1);
  }
}

main();
