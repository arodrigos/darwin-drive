import { createRace, DT, type Race } from "../sim/race";
import { MULTIPLIER, type FromWorker, type ToWorker, type Pace } from "./protocol";

const POSE_INTERVAL_MS = 33;
const PROGRESS_INTERVAL_MS = 100;
// Tras una pausa larga del hilo no se recupera todo de golpe: la carrera sigue desde donde está.
const MAX_ELAPSED_MS = 100;
/** Presupuesto de CPU por tick: el resto del tiempo es del hilo que pinta. */
export const BUDGET_MS = 8;
// La deuda de pasos no pasa de lo que cabe en un tick de referencia: si el dispositivo no llega,
// la carrera va más lenta que lo pedido en vez de acumular trabajo que bloquearía la interfaz.
const TICK_REF_MS = 16;
// Ventana en la que se mide el ritmo real; más corta sería ruido, más larga tardaría en avisar.
const VENTANA_RITMO_MS = 500;

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
  private limite: number | null = null;
  private fuerzasOn = false;
  private ritmoReal: number | undefined;
  private ventana = { pasos: 0, ms: 0 };

  /** `reloj` solo se sustituye en tests, para dar un coste fijo a cada paso. */
  constructor(
    private readonly emit: (m: FromWorker) => void,
    private readonly reloj: () => number = () => performance.now(),
  ) {}

  /** Hay algo que hacer en el próximo tick. */
  active(): boolean {
    return this.race !== null && !this.paused;
  }

  handle(msg: ToWorker): void {
    try {
      this.dispatch(msg);
    } catch (e) {
      this.fail(msg.type === "limitRate" ? this.raceId : msg.raceId, e);
    }
  }

  private dispatch(msg: ToWorker): void {
    if (msg.type === "limitRate") {
      this.limite = msg.max !== null && msg.max > 0 ? msg.max : null;
      return;
    }
    if (msg.type === "setFuerzas") {
      this.fuerzasOn = msg.on;
      // La muestra llega ya, sin esperar al próximo tick: con la carrera en pausa también se ve.
      if (msg.on && this.race && msg.raceId === this.raceId) this.emitPoses();
      return;
    }
    if (msg.type === "startRace") {
      this.release();
      this.raceId = msg.raceId;
      this.total = msg.cars.length;
      this.pace = msg.pace;
      this.paused = false;
      this.lastTick = null;
      this.owedSteps = 0;
      this.reported = 0;
      this.reiniciarVentana();
      this.race = createRace(msg.cars, msg.trackId);
      this.emitPoses();
      return;
    }
    if (msg.raceId !== this.raceId || !this.race) return;
    switch (msg.type) {
      case "setPace":
        this.pace = msg.pace;
        this.owedSteps = 0;
        this.reiniciarVentana();
        break;
      case "pause":
        this.paused = true;
        break;
      case "resume":
        // Tras una pausa (también la de ocultar la página) no se recupera nada: la deuda empieza a cero.
        this.paused = false;
        this.lastTick = null;
        this.owedSteps = 0;
        this.reiniciarVentana();
        break;
      case "stop":
        this.release();
        break;
      case "advance":
        this.advance(msg.seconds);
        break;
    }
  }

  private reiniciarVentana(): void {
    this.ventana = { pasos: 0, ms: 0 };
    this.ritmoReal = undefined;
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

  /** Un trozo de trabajo: lo que el ritmo pide desde el último tick, sin pasar de `budgetMs` simulando. */
  tick(budgetMs: number = BUDGET_MS): void {
    const race = this.race;
    if (!race || this.paused) return;
    try {
      const inicio = this.reloj();
      const elapsed = this.lastTick === null ? 0 : Math.min(inicio - this.lastTick, MAX_ELAPSED_MS);
      this.lastTick = inicio;
      if (this.pace === "turbo") {
        while (!race.done() && this.reloj() - inicio < budgetMs) race.step(4);
      } else {
        const mult = Math.min(MULTIPLIER[this.pace], this.limite ?? Infinity);
        this.owedSteps += (elapsed / 1000) * (1 / DT) * mult;
        const antes = race.simTime();
        // Paso a paso y mirando el reloj: un coste alto por paso no puede dejar la interfaz sin hilo.
        while (this.owedSteps >= 1 && !race.done() && this.reloj() - inicio < budgetMs) {
          race.step(1);
          this.owedSteps -= 1;
        }
        const tope = (TICK_REF_MS / 1000) * (1 / DT) * mult;
        if (this.owedSteps > tope) this.owedSteps = tope;
        this.medirRitmo(Math.round((race.simTime() - antes) / DT), elapsed);
      }
      this.flush(false);
    } catch (e) {
      this.fail(this.raceId, e);
    }
  }

  private medirRitmo(pasos: number, ms: number): void {
    this.ventana.pasos += pasos;
    this.ventana.ms += ms;
    if (this.ventana.ms >= VENTANA_RITMO_MS) {
      this.ritmoReal = (this.ventana.pasos * DT) / (this.ventana.ms / 1000);
      this.ventana = { pasos: 0, ms: 0 };
    }
  }

  private flush(force: boolean): void {
    const race = this.race!;
    const results = race.results();
    for (; this.reported < results.length; this.reported++) {
      this.emit({ type: "carFinished", raceId: this.raceId, result: results[this.reported] });
    }
    const now = this.reloj();
    if (race.done()) {
      this.emitPoses();
      this.emit(this.progreso(results.length));
      this.emit({ type: "raceDone", raceId: this.raceId, results });
      this.release();
      return;
    }
    if (this.pace !== "turbo" || force) {
      if (force || now - this.lastPoseAt >= POSE_INTERVAL_MS) this.emitPoses();
    }
    if (force || now - this.lastProgressAt >= PROGRESS_INTERVAL_MS) {
      this.lastProgressAt = now;
      this.emit(this.progreso(results.length));
    }
  }

  /** En turbo no hay poses: el contador de la pantalla sigue al líder por aquí. */
  private progreso(finished: number): FromWorker {
    const race = this.race!;
    const leaderX = race.poses().reduce((a, p) => Math.max(a, p.x), 0);
    return { type: "progress", raceId: this.raceId, finished, total: this.total, leaderX, simTime: race.simTime(), ritmoReal: this.ritmoReal };
  }

  private emitPoses(): void {
    this.lastPoseAt = this.reloj();
    const race = this.race!;
    const poses = race.poses();
    const msg: FromWorker = { type: "poses", raceId: this.raceId, simTime: race.simTime(), poses, ritmoReal: this.ritmoReal };
    if (this.fuerzasOn) {
      // La cámara sigue al coche vivo más adelantado: es el único del que se pregunta.
      const vivos = poses.filter((p) => !p.finished);
      const lider = vivos.reduce<(typeof poses)[number] | null>((a, p) => (a === null || p.x > a.x ? p : a), null);
      const muestra = lider ? race.fuerzas(lider.carId) : null;
      if (muestra) msg.fuerzas = muestra;
    }
    this.emit(msg);
  }
}
