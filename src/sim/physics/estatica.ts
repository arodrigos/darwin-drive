import "../detmath";
import { TORQUE_SLOPE_DEG } from "../constants";
import { VERTEX_COUNT, normalizeGenome, type Genome } from "../genome";

export const GRAVITY = 9.81;

/**
 * Par máximo de una rueda motriz: masa·g·sen 35°·r repartido entre las ruedas motrices.
 * Lo usa la física (car.ts) y lo dibuja el Taller: así lo que se ve es lo que corre.
 */
export function parMaximo(masa: number, radio: number, motrices = 1): number {
  return (masa * GRAVITY * Math.sin((TORQUE_SLOPE_DEG * Math.PI) / 180) * radio) / Math.max(1, motrices);
}

export interface EstaticaRueda {
  slot: number;
  vertex: number;
  parMax: number;
  /** Dirección unidad del eje de la suspensión, en el sistema del coche. */
  eje: { x: number; y: number };
}

export interface Estatica {
  masa: number;
  /** Centro de masas de carrocería y ruedas, en metros desde el origen del coche (y hacia arriba). */
  centroMasas: { x: number; y: number };
  ruedas: EstaticaRueda[];
}

/** Masa, centro de masas y par por rueda de un genoma, con las mismas fórmulas que construye car.ts, sin crear un mundo de Planck. */
export function estatica(genome: Genome): Estatica {
  const g = normalizeGenome(genome);
  const pts = g.body.map((v) => ({ x: Math.cos(v.angle) * v.length, y: Math.sin(v.angle) * v.length }));
  let masa = 0;
  let mx = 0;
  let my = 0;
  // Cada triángulo del abanico (origen, a, b) pesa densidad·área y su centro es la media de sus vértices.
  for (let i = 0; i < VERTEX_COUNT; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % VERTEX_COUNT];
    const m = (g.bodyDensity * Math.abs(a.x * b.y - a.y * b.x)) / 2;
    masa += m;
    mx += (m * (a.x + b.x)) / 3;
    my += (m * (a.y + b.y)) / 3;
  }
  const activas = g.wheels.map((w, slot) => ({ w, slot })).filter(({ w }) => w.vertex >= 0);
  for (const { w } of activas) {
    const m = w.density * Math.PI * w.radius * w.radius;
    masa += m;
    mx += m * pts[w.vertex].x;
    my += m * pts[w.vertex].y;
  }
  return {
    masa,
    centroMasas: masa > 0 ? { x: mx / masa, y: my / masa } : { x: 0, y: 0 },
    ruedas: activas.map(({ w, slot }) => ({
      slot,
      vertex: w.vertex,
      parMax: parMaximo(masa, w.radius, activas.length),
      eje: { x: Math.cos(w.axisAngle), y: Math.sin(w.axisAngle) },
    })),
  };
}
