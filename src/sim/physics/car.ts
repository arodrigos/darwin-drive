import "../detmath";
import { Circle, Polygon, Vec2, WheelJoint, type Body, type World } from "planck";
import { TORQUE_SLOPE_DEG } from "../constants";
import { VERTEX_COUNT, type Genome } from "../genome";

export const GRAVITY = 9.81;
export { TORQUE_SLOPE_DEG };
export const MOTOR_SPEED = 25;
export const SUSPENSION_HZ = 4;
export const SUSPENSION_DAMPING = 0.7;
const SPAWN_CLEARANCE = 0.3;

/** Par máximo de una rueda motriz: masa·g·sen 35°·r repartido entre las ruedas motrices. */
export function maxMotorTorque(totalMass: number, radius: number, drivenWheels: number): number {
  return (totalMass * GRAVITY * Math.sin((TORQUE_SLOPE_DEG * Math.PI) / 180) * radius) / Math.max(1, drivenWheels);
}

export interface CarParts {
  chassis: Body;
  wheels: { body: Body; radius: number; joint: WheelJoint }[];
  mass: number;
}

// Mismo grupo negativo en carrocería y ruedas: no chocan entre sí, solo con el suelo.
const GROUP = -1;

/** Altura inicial para que lo más bajo del coche quede a unos centímetros del suelo. */
function spawnHeight(genome: Genome): number {
  let lowest = 0;
  for (const v of genome.body) lowest = Math.min(lowest, Math.sin(v.angle) * v.length);
  for (const w of genome.wheels) {
    if (w.vertex < 0) continue;
    const v = genome.body[w.vertex];
    lowest = Math.min(lowest, Math.sin(v.angle) * v.length - w.radius);
  }
  return SPAWN_CLEARANCE - lowest;
}

/** Carrocería en abanico de 8 triángulos desde el origen y ruedas con WheelJoint. Nunca lanza para un genoma normalizado. */
export function buildCar(world: World, genome: Genome, x: number, groundY: number): CarParts {
  const chassis = world.createBody({
    type: "dynamic",
    position: Vec2(x, groundY + spawnHeight(genome)),
    allowSleep: false,
  });
  const pts = genome.body.map((v) => Vec2(Math.cos(v.angle) * v.length, Math.sin(v.angle) * v.length));
  for (let i = 0; i < VERTEX_COUNT; i++) {
    chassis.createFixture(new Polygon([Vec2(0, 0), pts[i], pts[(i + 1) % VERTEX_COUNT]]), {
      density: genome.bodyDensity,
      friction: 0.3,
      filterGroupIndex: GROUP,
    });
  }

  const active = genome.wheels.filter((w) => w.vertex >= 0);
  const wheels: CarParts["wheels"] = [];
  for (const w of active) {
    const anchor = pts[w.vertex];
    const body = world.createBody({
      type: "dynamic",
      position: Vec2(chassis.getPosition().x + anchor.x, chassis.getPosition().y + anchor.y),
      allowSleep: false,
    });
    body.createFixture(new Circle(w.radius), { density: w.density, friction: 1, filterGroupIndex: GROUP });
    wheels.push({ body, radius: w.radius, joint: null as unknown as WheelJoint });
  }

  let mass = chassis.getMass();
  for (const w of wheels) mass += w.body.getMass();
  active.forEach((w, i) => {
    wheels[i].joint = world.createJoint(
      new WheelJoint({
        bodyA: chassis,
        bodyB: wheels[i].body,
        localAnchorA: pts[w.vertex],
        localAnchorB: Vec2(0, 0),
        localAxisA: Vec2(Math.cos(w.axisAngle), Math.sin(w.axisAngle)),
        enableMotor: true,
        // Giro negativo = avanzar hacia +x.
        motorSpeed: -MOTOR_SPEED,
        maxMotorTorque: maxMotorTorque(mass, w.radius, active.length),
        frequencyHz: SUSPENSION_HZ,
        dampingRatio: SUSPENSION_DAMPING,
      }),
    ) as WheelJoint;
  });
  return { chassis, wheels, mass };
}
