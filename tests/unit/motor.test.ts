import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { crearMotor, type Contenedor, type DepsMotor, type EscenaMotor } from "../../src/game/motor";
import type { FromWorker, SimRunner, ToWorker } from "../../src/worker/protocol";

class EscenaFalsa implements EscenaMotor {
  cfg: string | null = null;
  pick: (() => void) | null = null;
  fuerzas = false;
  destellos = 0;
  soltadas = 0;
  traspasada = false;
  soltar() {
    this.cfg = null;
    this.pick = null;
    this.fuerzas = false;
    this.destellos = 0;
    this.soltadas++;
  }
  activa() {
    return this.cfg !== null;
  }
  traspasar(vieja: EscenaMotor) {
    this.traspasada = vieja instanceof EscenaFalsa;
  }
}

function falsoContenedor(): Contenedor & { hijos: unknown[] } {
  const c = {
    hijos: [] as unknown[],
    clientWidth: 400,
    clientHeight: 300,
    appendChild(n: unknown) {
      this.hijos.push(n);
    },
  };
  return c as unknown as Contenedor & { hijos: unknown[] };
}

function montar() {
  const medidas = { runners: 0, observadores: 0, posts: [] as ToWorker[], oyentes: new Set<(m: FromWorker) => void>() };
  const deps: DepsMotor<EscenaFalsa> = {
    crearJuego: (_r, anterior) => {
      const escena = new EscenaFalsa();
      if (anterior) escena.traspasar(anterior);
      return {
        escena,
        game: { canvas: {} as Node, scale: { resize() {} }, loop: { sleep() {}, wake() {}, started: true, running: true } },
      };
    },
    iniciar: (construir) => void construir(false),
    preparar: async () => {},
    crearRunner: () => {
      medidas.runners++;
      return {
        kind: "worker",
        post: (m: ToWorker) => void medidas.posts.push(m),
        subscribe: (l: (m: FromWorker) => void) => {
          medidas.oyentes.add(l);
          return () => medidas.oyentes.delete(l);
        },
        terminate() {},
      } as SimRunner;
    },
    opcionesRunner: () => ({ worker: true }),
    oculto: falsoContenedor,
    observar: () => {
      medidas.observadores++;
      return () => {
        medidas.observadores--;
      };
    },
    despues: () => {},
    puedeDibujar: () => true,
  };
  return { motor: crearMotor(deps), medidas };
}

test("mp-2: precalentar es idempotente y deja un juego y un Worker", async () => {
  const { motor, medidas } = montar();
  await Promise.all([motor.precalentar(), motor.precalentar()]);
  await motor.precalentar();
  const e = motor.estado();
  assert.equal(e.listo, true);
  assert.equal(e.juegosCreados, 1);
  assert.equal(e.workersCreados, 1);
  assert.equal(medidas.runners, 1);
});

test("mp-9: sin WebGL no se precalienta nada", async () => {
  const { motor } = montar();
  const sin = crearMotor<EscenaFalsa>({ ...({} as DepsMotor<EscenaFalsa>), puedeDibujar: () => false } as DepsMotor<EscenaFalsa>);
  await sin.precalentar();
  assert.equal(sin.estado().listo, false);
  assert.equal(sin.estado().juegosCreados, 0);
  assert.equal(motor.estado().listo, false);
});

test("mp-2: tras soltar, la escena queda sin cfg, sin toques, sin fuerzas y sin destellos", async () => {
  const { motor } = montar();
  const p = falsoContenedor();
  const adq = motor.adquirir("pista", p);
  const e = motor.escena();
  e.cfg = "x";
  e.pick = () => {};
  e.fuerzas = true;
  e.destellos = 3;
  assert.equal(motor.estado().escenasActivas, 1);
  motor.soltar(adq);
  assert.equal(e.cfg, null);
  assert.equal(e.pick, null);
  assert.equal(e.fuerzas, false);
  assert.equal(e.destellos, 0);
  assert.equal(motor.estado().dueno, null);
  assert.equal(motor.estado().escenasActivas, 0);
});

test("mp-2 invariantes: cualquier secuencia de adquirir, soltar, perder contexto y precalentar respeta los límites", async () => {
  const orden = fc.constantFrom("adquirir-pista", "adquirir-evolucion", "soltar", "perder", "precalentar", "sim", "terminar");
  await fc.assert(
    fc.asyncProperty(fc.array(orden, { maxLength: 40 }), async (pasos) => {
      const { motor } = montar();
      const parent = falsoContenedor();
      let adq: ReturnType<typeof motor.adquirir> | null = null;
      const viejas: ReturnType<typeof motor.adquirir>[] = [];
      let recuperaciones = 0;
      let hayJuego = false;
      const runners: SimRunner[] = [];
      for (const paso of pasos) {
        if (paso === "adquirir-pista" || paso === "adquirir-evolucion") {
          if (adq) viejas.push(adq);
          adq = motor.adquirir(paso === "adquirir-pista" ? "pista" : "evolucion", parent);
          hayJuego = true;
          // La escena de la pantalla anterior se reinició: nada que recibir.
          assert.equal(motor.escena().cfg, null);
          motor.escena().cfg = "carrera";
          for (const v of viejas) assert.equal(v.soltado, true);
        } else if (paso === "soltar" && adq) {
          motor.soltar(adq);
          adq = null;
        } else if (paso === "perder" && hayJuego) {
          motor.perderContexto();
          recuperaciones++;
        } else if (paso === "precalentar") {
          await motor.precalentar();
          hayJuego = true;
        } else if (paso === "sim") {
          const r = motor.sim({ worker: true });
          r.subscribe(() => {});
          runners.push(r);
        } else if (paso === "terminar") {
          runners.splice(0).forEach((r) => r.terminate());
        }
        const e = motor.estado();
        assert.ok(e.juegosVivos <= 1);
        assert.ok(e.escenasActivas <= 1);
        assert.ok(e.workersCreados <= 1);
      }
      const e = motor.estado();
      if (hayJuego) assert.equal(e.juegosCreados, 1 + recuperaciones);
      else assert.equal(e.juegosCreados, 0);
      runners.splice(0).forEach((r) => r.terminate());
      assert.equal(motor.estado().oyentesWorker, 0);
    }),
  );
});

test("mp-5: adquirir sin haber soltado reinicia la escena y la pantalla anterior queda soltada", () => {
  const { motor } = montar();
  const a = motor.adquirir("pista", falsoContenedor());
  motor.escena().cfg = "vieja";
  const b = motor.adquirir("evolucion", falsoContenedor());
  assert.equal(a.soltado, true);
  assert.equal(b.soltado, false);
  assert.equal(motor.escena().cfg, null);
  assert.equal(motor.estado().dueno, "evolucion");
  assert.equal(motor.estado().adquisiciones, 2);
  // Soltar la vieja ahora no toca al dueño nuevo.
  motor.soltar(a);
  assert.equal(motor.estado().dueno, "evolucion");
});

test("mp-6: tras perder el contexto se rehace el juego, la escena nueva recibe lo de la vieja y el dueño sigue", () => {
  const { motor } = montar();
  motor.adquirir("pista", falsoContenedor());
  motor.perderContexto();
  const e = motor.estado();
  assert.equal(e.juegosCreados, 2);
  assert.equal(e.juegosVivos, 1);
  assert.equal(e.dueno, "pista");
  assert.equal((motor.escena() as EscenaFalsa).traspasada, true);
});

test("mp-2: el Worker compartido se reutiliza, terminate() suelta la suscripción y para la carrera", () => {
  const { motor, medidas } = montar();
  const a = motor.sim({ worker: true });
  a.subscribe(() => {});
  a.post({ type: "startRace", raceId: "r1", cars: [], trackId: "cordillera" as never, pace: "x1" });
  a.terminate();
  const b = motor.sim({ worker: true });
  b.subscribe(() => {});
  assert.equal(motor.estado().workersCreados, 1);
  assert.equal(motor.estado().oyentesWorker, 1);
  assert.ok(medidas.posts.some((m) => m.type === "stop" && m.raceId === "r1"));
  b.terminate();
  assert.equal(motor.estado().oyentesWorker, 0);
});

test("mp-2: la capa Fuerzas del Worker compartido arranca apagada", () => {
  const { motor, medidas } = montar();
  motor.sim({ worker: true });
  assert.deepEqual(medidas.posts[0], { type: "setFuerzas", raceId: "", on: false });
});

test("fallo de prueba: solo la primera carrera de la pantalla falla", () => {
  const { motor, medidas } = montar();
  const r = motor.sim({ worker: true, failFirstStart: true });
  const msg = { type: "startRace", raceId: "r1", cars: [], trackId: "cordillera", pace: "x1" } as ToWorker;
  r.post(msg);
  r.post({ ...msg, raceId: "r2" } as ToWorker);
  const arranques = medidas.posts.filter((m) => m.type === "startRace") as Extract<ToWorker, { type: "startRace" }>[];
  assert.equal(arranques[0].trackId, "__fallo__");
  assert.equal(arranques[1].trackId, "cordillera");
});
