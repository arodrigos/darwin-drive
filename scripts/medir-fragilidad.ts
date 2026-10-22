// fra-2: lo ligero rompe antes que lo pesado, y un coche grueso de 70 kg/m² no se rompe por debajo de 3 m.
// Deja caer el coche de serie (con tres densidades) desde 0,5 a 15 m sobre la pista llana de pruebas.
import { createRace } from "../src/sim/race";
import { STOCK_CAR } from "../src/sim/genome";
import type { TrackId } from "../src/sim/tracks";

const ALTURAS = [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15];
const DENSIDADES = { ligero: 20, serie: 70, pesado: 200 } as const;

/** Altura mínima de caída a la que se pierde alguna pieza; Infinity si ninguna rompe. */
function alturaDeRotura(densidad: number): number {
  for (const h of ALTURAS) {
    const race = createRace([{ carId: "caida", genome: { ...STOCK_CAR, bodyDensity: densidad } }], "pruebas-llana" as TrackId, { caida: h, maxSteps: 240 });
    while (!race.done()) race.step(60);
    const r = race.results()[0];
    race.dispose();
    if (r.piezasPerdidas > 0) return h;
  }
  return Infinity;
}

const tabla = Object.fromEntries(Object.entries(DENSIDADES).map(([nombre, d]) => [nombre, alturaDeRotura(d)]));
console.table(tabla);

let fallos = 0;
const falla = (msg: string) => {
  console.error(`FALLO: ${msg}`);
  fallos++;
};
if (!(tabla.ligero < tabla.pesado || tabla.pesado === Infinity)) falla("el coche ligero no rompe antes que el pesado");
if (!(tabla.ligero <= tabla.serie && tabla.serie <= tabla.pesado)) falla("el de 70 no queda entre el ligero y el pesado");
if (tabla.serie < 3) falla("un coche de 70 kg/m² se rompe por debajo de 3 m");
process.exit(fallos > 0 ? 1 : 0);
