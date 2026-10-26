import { crearBatalla, transicion, type EstadoBatalla } from "@/batalla/estado";
import type { ColorCoche } from "@/game/colores-coche";
import { randomGenome } from "@/sim/genome";
import type { TrackId } from "@/sim/tracks";

export interface EscenarioBatalla {
  jugadores: 2 | 3 | 4;
  fase: "elegir-pista" | "carrera";
  pista?: TrackId;
}

const NOMBRES = ["Ana", "Bea", "Carlos", "Diana"];
const COLORES: ColorCoche[] = ["naranja", "azul", "verde", "purpura"];

/** Semilla fija: dos cargas del escenario dan los mismos coches y, por tanto, la misma carrera. */
function mulberry32(semilla: number): () => number {
  let a = semilla;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Una batalla con N jugadores de nombre y color fijos y coches aleatorios, llevada por las mismas transiciones que la real. */
export function batallaDeEscenario(e: EscenarioBatalla): EstadoBatalla {
  if (![2, 3, 4].includes(e.jugadores)) throw new Error("escenario batalla: de 2 a 4 jugadores");
  const rand = mulberry32(20261026);
  let b = crearBatalla(
    Array.from({ length: e.jugadores }, (_, i) => ({ nombre: NOMBRES[i], color: COLORES[i] })),
    "escenario-batalla",
    "2026-01-01T00:00:00.000Z",
  );
  b = transicion(b, { tipo: "empezar" });
  for (let i = 0; i < e.jugadores; i++) {
    b = transicion(b, { tipo: "comenzar-turno" });
    b = transicion(b, { tipo: "terminar-coche", genome: randomGenome(rand), nombre: `Coche de ${NOMBRES[i]}` });
  }
  if (e.fase === "carrera") {
    b = transicion(b, { tipo: "elegir-pista", pista: e.pista ?? "rampa" });
    b = transicion(b, { tipo: "correr" });
  } else if (e.pista) {
    b = transicion(b, { tipo: "elegir-pista", pista: e.pista });
  }
  return b;
}
