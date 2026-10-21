import "../detmath";
import { Vec2, World, type Body } from "planck";
import { DT, ANOMALY_HEIGHT, ANOMALY_SPEED, MAX_STEPS, META_DISTANCE, STALL_MIN_PROGRESS, STALL_STEPS, PHYSICS_VERSION } from "../constants";
import type { CarPose, CarResult, EndReason } from "../constants";
import { ALFA_CARGA, BufferParada, clasificarParada, type Diagnostico } from "../diagnostico";
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
  private readonly buffer: BufferParada | null;
  private cargas: number[] = [];
  private diagnostico: Diagnostico | null = null;

  constructor(
    readonly carId: string,
    genome: Genome,
    private readonly track: Track,
    private readonly heightAt: (x: number) => number,
    private readonly maxSteps: number = MAX_STEPS,
    opts: { sinDiagnostico?: boolean; friccionSuelo?: number } = {},
  ) {
    const g = normalizeGenome(genome);
    this.world = new World({ gravity: Vec2(0, -GRAVITY), allowSleep: false, continuousPhysics: false });
    this.ground = createGround(this.world, heightAt, opts.friccionSuelo, (i) => track.surfaceOfSegment(i));
    this.ground.ensure(-10, 10);
    this.car = buildCar(this.world, g, 0, heightAt(0));
    // El muestreo solo lee el mundo: con o sin él el resultado es idéntico (se comprueba en los tests).
    this.buffer = opts.sinDiagnostico ? null : new BufferParada();
    this.cargas = this.car.wheels.map(() => 0);
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
      ...(this.buffer ? { cargas: [...this.cargas] } : {}),
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

  /** Pendiente del suelo en x, en grados; la cuerda de 1 m ignora las piedras pequeñas. */
  private pendienteBajoElCoche(x: number): number {
    return (Math.atan(this.heightAt(x + 0.5) - this.heightAt(x - 0.5)) * 180) / Math.PI;
  }

  /** Solo lectura del mundo: contactos, velocidades y fuerza de reacción de las ruedas. */
  private muestrear(): void {
    const car = this.car!;
    const toca = (b: Body) => {
      for (let ce = b.getContactList(); ce; ce = ce.next) if (ce.contact.isTouching()) return true;
      return false;
    };
    const v = car.chassis.getLinearVelocity();
    const velocidad = Math.hypot(v.x, v.y);
    const pesoPorRueda = (car.mass * GRAVITY) / Math.max(1, car.wheels.length);
    let enContacto = 0;
    let patinaje = 0;
    let carga = 0;
    car.wheels.forEach((w, i) => {
      const f = w.joint.getReactionForce(1 / DT);
      this.cargas[i] += ALFA_CARGA * (Math.min(1, Math.hypot(f.x, f.y) / pesoPorRueda) - this.cargas[i]);
      carga += this.cargas[i];
      if (!toca(w.body)) return;
      enContacto++;
      const llanta = Math.abs(w.body.getAngularVelocity()) * w.radius;
      // Una rueda casi parada no patina: el motor no puede con ella, que es otra causa.
      if (llanta >= 1) patinaje += Math.min(1, Math.max(0, (llanta - velocidad) / llanta));
    });
    this.buffer!.anotar({
      // En el punto más lejano: si el coche resbala cuesta abajo hasta el pie, la media del tramo mentiría sobre la cuesta que no pudo subir.
      pendiente: this.pendienteBajoElCoche(this.maxX),
      patinaje: enContacto > 0 ? patinaje / enContacto : 0,
      ruedasEnContacto: enContacto,
      carroceriaEnContacto: toca(car.chassis),
      angulo: Math.atan2(Math.sin(car.chassis.getAngle()), Math.cos(car.chassis.getAngle())),
      carga: car.wheels.length > 0 ? carga / car.wheels.length : 0,
    });
  }

  /** Un paso fijo de DT. Tras terminar no hace nada. */
  step(): void {
    if (this.end) return;
    const [lo, hi] = this.extents();
    this.ground!.ensure(lo, hi);
    this.world!.step(DT, 8, 3);
    this.stepCount++;
    if (this.buffer) this.muestrear();

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
    if (reason === "stall" && this.buffer) this.diagnostico = clasificarParada(this.buffer.muestras());
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
      causaParada: this.diagnostico?.causa ?? null,
      pendienteParada: this.diagnostico?.pendiente ?? null,
      physicsVersion: PHYSICS_VERSION,
      trackId: this.track.id,
      trackVersion: this.track.version,
    };
  }

  dispose(): void {
    if (this.world) this.release();
  }
}
