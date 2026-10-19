import { createRace, DT, type Race } from "../sim/race";
import type { FromWorker, Pace, ToWorker } from "./protocol";

const POSE_INTERVAL_MS = 33;
const PROGRESS_INTERVAL_MS = 100;
// Tras una pausa larga del hilo no se recupera todo de golpe: la carrera sigue desde donde está.
const MAX_ELAPSED_MS = 100;
const MULTIPLIER: Record<Exclude<Pace, "turbo">, number> = { x1: 1, x4: 4 };

/**
 * Lleva una carrera y la avanza según el reloj. No sabe si vive en un Worker o en
 * el hilo principal: el resultado de cada coche solo depende de sus pasos de DT,
 * así que cómo se troceen no puede cambiarlo.
 */
export class RaceEngine {
  private race: Race | null = null;
  private raceId = "";
  private total = 0;
  private pace: Pace = "x1";
  private paused = false;
  private lastTick: number | null = null;
  private owedSteps = 0;
  private lastPoseAt = 0;
  private lastProgressAt = 0;
  private reported = 0;

  constructor(private readonly emit: (m: FromWorker) => void) {}

  /** Hay algo que hacer en el próximo tick. */
  active(): boolean {
    return this.race !== null && !this.paused;
  }

  handle(msg: ToWorker): void {
    try {
      this.dispatch(msg);
    } catch (e) {
      this.fail(msg.raceId, e);
    }
  }

  private dispatch(msg: ToWorker): void {
    if (msg.type === "startRace") {
      this.release();
      this.raceId = msg.raceId;
      this.total = msg.cars.length;
      this.pace = msg.pace;
      this.paused = false;
      this.lastTick = null;
      this.owedSteps = 0;
      this.reported = 0;
      this.race = createRace(msg.cars, msg.trackId);
      this.emitPoses();
      return;
    }
    if (msg.raceId !== this.raceId || !this.race) return;
    switch (msg.type) {
      case "setPace":
        this.pace = msg.pace;
        break;
      case "pause":
        this.paused = true;
        break;
      case "resume":
        this.paused = false;
        this.lastTick = null;
        break;
      case "stop":
        this.release();
        break;
      case "advance":
        this.advance(msg.seconds);
        break;
    }
  }

  private fail(raceId: string, e: unknown): void {
    this.release();
    this.emit({ type: "error", raceId, message: e instanceof Error ? e.message : String(e) });
  }

  private release(): void {
    this.race?.dispose();
    this.race = null;
  }

  /** Avanza sin reloj los segundos simulados indicados (o hasta el final) y publica el estado resultante. */
  private advance(seconds: number): void {
    const race = this.race!;
    let steps = Math.max(0, Math.round(seconds / DT));
    while (steps > 0 && !race.done()) {
      const n = Math.min(steps, 60);
      race.step(n);
      steps -= n;
    }
    this.flush(true);
  }

  /** Un trozo de trabajo: lo que el ritmo pide desde el último tick, con tope de `budgetMs` en turbo. */
  tick(budgetMs: number): void {
    const race = this.race;
    if (!race || this.paused) return;
    try {
      const now = performance.now();
      const elapsed = this.lastTick === null ? 0 : Math.min(now - this.lastTick, MAX_ELAPSED_MS);
      this.lastTick = now;
      if (this.pace === "turbo") {
        while (!race.done() && performance.now() - now < budgetMs) race.step(4);
      } else {
        this.owedSteps += (elapsed / 1000) * (1 / DT) * MULTIPLIER[this.pace];
        const n = Math.floor(this.owedSteps);
        this.owedSteps -= n;
        race.step(n);
      }
      this.flush(false);
    } catch (e) {
      this.fail(this.raceId, e);
    }
  }

  private flush(force: boolean): void {
    const race = this.race!;
    const results = race.results();
    for (; this.reported < results.length; this.reported++) {
      this.emit({ type: "carFinished", raceId: this.raceId, result: results[this.reported] });
    }
    const now = performance.now();
    if (race.done()) {
      this.emitPoses();
      this.emit({ type: "progress", raceId: this.raceId, finished: results.length, total: this.total });
      this.emit({ type: "raceDone", raceId: this.raceId, results });
      this.release();
      return;
    }
    if (this.pace !== "turbo" || force) {
      if (force || now - this.lastPoseAt >= POSE_INTERVAL_MS) this.emitPoses();
    }
    if (force || now - this.lastProgressAt >= PROGRESS_INTERVAL_MS) {
      this.lastProgressAt = now;
      this.emit({ type: "progress", raceId: this.raceId, finished: results.length, total: this.total });
    }
  }

  private emitPoses(): void {
    this.lastPoseAt = performance.now();
    this.emit({ type: "poses", raceId: this.raceId, simTime: this.race!.simTime(), poses: this.race!.poses() });
  }
}
