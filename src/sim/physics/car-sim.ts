import "../detmath";
import { Vec2, World } from "planck";
import { DT, ANOMALY_HEIGHT, ANOMALY_SPEED, MAX_STEPS, META_DISTANCE, STALL_MIN_PROGRESS, STALL_STEPS, PHYSICS_VERSION } from "../constants";
import type { CarPose, CarResult, EndReason } from "../constants";
import { normalizeGenome, type Genome } from "../genome";
import type { Track } from "../tracks";
import { buildCar, GRAVITY, type CarParts } from "./car";
import { createGround, type Ground } from "./ground";

/** Un coche en su propio mundo: lo que le pasa a otros coches no puede alterarlo. */
export class CarSim {
  private world: World | null;
  private ground: Ground | null;
  private car: CarParts | null;
  private maxX = 0;
  private bestStep = 0;
  private bestDecimas = 0;
  private stepCount = 0;
  private refX = 0;
  private refStep = 0;
  private end: EndReason | null = null;
  private lastPose: CarPose;

  constructor(
    readonly carId: string,
    genome: Genome,
    private readonly track: Track,
    private readonly heightAt: (x: number) => number,
    private readonly maxSteps: number = MAX_STEPS,
  ) {
    const g = normalizeGenome(genome);
    this.world = new World({ gravity: Vec2(0, -GRAVITY), allowSleep: false, continuousPhysics: false });
    this.ground = createGround(this.world, heightAt);
    this.ground.ensure(-10, 10);
    this.car = buildCar(this.world, g, 0, heightAt(0));
    this.lastPose = this.readPose(false);
  }

  get bodyCount(): number {
    return this.world ? this.world.getBodyCount() : 0;
  }

  isDone(): boolean {
    return this.end !== null;
  }

  private extents(): [number, number] {
    const car = this.car!;
    let lo = car.chassis.getPosition().x;
    let hi = lo;
    for (const w of car.wheels) {
      const x = w.body.getPosition().x;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    return [lo, hi];
  }

  private readPose(finished: boolean): CarPose {
    const car = this.car!;
    const p = car.chassis.getPosition();
    return {
      carId: this.carId,
      x: p.x,
      y: p.y,
      angle: car.chassis.getAngle(),
      wheels: car.wheels.map((w) => ({
        x: w.body.getPosition().x,
        y: w.body.getPosition().y,
        angle: w.body.getAngle(),
        radius: w.radius,
      })),
      finished,
      ...(this.end ? { reason: this.end } : {}),
    };
  }

  private isAnomaly(): boolean {
    const car = this.car!;
    const p = car.chassis.getPosition();
    const v = car.chassis.getLinearVelocity();
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return true;
    if (Math.hypot(v.x, v.y) > ANOMALY_SPEED) return true;
    return Math.abs(p.y - this.heightAt(p.x)) > ANOMALY_HEIGHT;
  }

  /** Un paso fijo de DT. Tras terminar no hace nada. */
  step(): void {
    if (this.end) return;
    const [lo, hi] = this.extents();
    this.ground!.ensure(lo, hi);
    this.world!.step(DT, 8, 3);
    this.stepCount++;

    // La distancia se congela en el último paso sano: el paso anómalo no la toca.
    if (this.isAnomaly()) {
      this.finish("anomaly");
      return;
    }
    const x = this.car!.chassis.getPosition().x;
    if (x > this.maxX) {
      this.maxX = Math.min(x, META_DISTANCE);
      // Se mide en décimas porque es lo que ve el jugador: dos coches a la misma décima empatan en distancia.
      const d = Math.round(this.maxX * 10);
      if (d > this.bestDecimas) {
        this.bestDecimas = d;
        this.bestStep = this.stepCount;
      }
    }
    if (this.maxX >= META_DISTANCE) {
      this.finish("meta");
      return;
    }
    if (this.maxX >= this.refX + STALL_MIN_PROGRESS) {
      this.refX = this.maxX;
      this.refStep = this.stepCount;
    }
    if (this.stepCount >= this.maxSteps) this.finish("timeout");
    else if (this.stepCount - this.refStep >= STALL_STEPS) this.finish("stall");
  }

  private finish(reason: EndReason): void {
    this.end = reason;
    this.lastPose = this.readPose(true);
    this.release();
  }

  private release(): void {
    this.ground?.dispose();
    if (this.world && this.car) {
      for (const w of this.car.wheels) this.world.destroyBody(w.body);
      this.world.destroyBody(this.car.chassis);
    }
    this.world = null;
    this.ground = null;
    this.car = null;
  }

  pose(): CarPose {
    if (this.car && !this.end) this.lastPose = this.readPose(false);
    return this.lastPose;
  }

  result(): CarResult | null {
    if (!this.end) return null;
    return {
      carId: this.carId,
      distance: this.maxX,
      reason: this.end,
      steps: this.stepCount,
      bestStep: this.bestStep,
      piezasPerdidas: 0,
      physicsVersion: PHYSICS_VERSION,
      trackId: this.track.id,
      trackVersion: this.track.version,
    };
  }

  dispose(): void {
    if (this.world) this.release();
  }
}
