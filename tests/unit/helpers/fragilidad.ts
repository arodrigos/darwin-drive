import "../../../src/sim/detmath";
import { World, Vec2 } from "planck";
import { STOCK_CAR } from "../../../src/sim/genome";
import { buildCar } from "../../../src/sim/physics/car";
import { Fragilidad } from "../../../src/sim/physics/rotura-sim";

/** Rompe a mano los triángulos de un coche en un mundo sin suelo y anota lo que el diseño declara invariante. */
export function diagnosticoDeRotura(): {
  parPorKilo: number[];
  ruedaSueltaConUnTrianguloVivo: boolean;
  destrozado: boolean;
  masaRestante: number;
} {
  const world = new World({ gravity: Vec2(0, 0) });
  const car = buildCar(world, STOCK_CAR, 0, 0);
  const frag = new Fragilidad(world, car);
  const parTotal = () => car.wheels.reduce((s, w) => s + (w.joint ? w.joint.getMaxMotorTorque() : 0), 0);
  const parPorKilo = [parTotal() / frag.masaMontada()];
  let ruedaSueltaConUnTrianguloVivo = false;
  const romper = (i: number) => {
    // Un impulso enorme solo sobre ese triángulo, como lo dejaría el solver.
    (frag as unknown as { impulso: Float64Array }).impulso[i] = 1e9;
    frag.aplicar();
    parPorKilo.push(parTotal() / frag.masaMontada());
    for (const w of car.wheels) {
      if (w.suelta && (car.tris[w.vertex].fixture || car.tris[(w.vertex + 7) % 8].fixture)) ruedaSueltaConUnTrianguloVivo = true;
    }
  };
  for (let i = 0; i < 8; i++) romper(i);

  return { parPorKilo, ruedaSueltaConUnTrianguloVivo, destrozado: frag.destrozado(), masaRestante: frag.masaMontada() / car.mass };
}
