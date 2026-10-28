import type Phaser from "phaser";
import { createSimRunner } from "@/worker";
import type { SimRunner, ToWorker } from "@/worker/protocol";
import { gestionarLienzo, puedeDibujar } from "./lienzo";

// Este módulo no importa Phaser (solo tipos): lo cargan la Portada y los ganchos antes de que exista el juego.

export interface EstadoMotor {
  /** Game y Worker precalentados. */
  listo: boolean;
  /** Phaser.Game de carrera creados en la sesión (1 + recuperaciones de contexto). */
  juegosCreados: number;
  /** 0 o 1. */
  juegosVivos: number;
  /** Veces que una pantalla lo ha tomado. */
  adquisiciones: number;
  /** 'pista' | 'evolucion' | 'batalla' o null si está soltado. */
  dueno: string | null;
  /** Workers de simulación creados por el motor en la sesión. */
  workersCreados: number;
  /** Suscripciones vivas al runner compartido. */
  oyentesWorker: number;
  /** TrackScene con cfg distinto de null (0 o 1). */
  escenasActivas: number;
}

/** Lo que el motor necesita de una escena; TrackScene lo cumple. */
export interface EscenaMotor {
  /** Deja la escena como recién creada: sin cfg, sin toques, sin fuerzas ni destellos. */
  soltar(): void;
  activa(): boolean;
  traspasar(vieja: EscenaMotor): void;
}

/** Lo que el motor usa de un Phaser.Game (así se prueba con uno falso, sin DOM). */
export interface JuegoMin {
  canvas: Node | null | undefined;
  scale: { resize(ancho: number, alto: number): unknown };
  loop: { sleep(): void; wake(): void; started?: boolean; running?: boolean };
}

export interface Contenedor {
  appendChild(nodo: Node): unknown;
  clientWidth: number;
  clientHeight: number;
}

export interface JuegoMotor<E extends EscenaMotor> {
  game: JuegoMin;
  escena: E;
}

export interface DepsMotor<E extends EscenaMotor> {
  /** Crea el Game con su escena. En una reconstrucción, la escena nueva recibe lo de la vieja. */
  crearJuego(reconstruccion: boolean, anterior: E | null): JuegoMotor<E>;
  /** Arranca el juego; el motor real lo hace por el gestor del lienzo, que rehace el Game al perder el contexto. */
  iniciar(construir: (reconstruccion: boolean) => JuegoMotor<E>): void;
  /** Carga lo que crearJuego necesita (el trozo de Phaser). */
  preparar(): Promise<void>;
  crearRunner(op: { worker: boolean }): SimRunner;
  opcionesRunner(): { worker: boolean };
  /** Contenedor fuera de la vista donde espera el lienzo sin dueño. */
  oculto(): Contenedor;
  /** Avisa al cambiar el tamaño del contenedor; devuelve la función que deja de avisar. */
  observar(parent: Contenedor, alCambiar: () => void): () => void;
  /** Ejecuta algo un instante después (el bucle de Phaser arranca tras crear el juego). */
  despues(fn: () => void): void;
  puedeDibujar(): boolean;
}

export interface Adquisicion {
  readonly pantalla: string;
  soltado: boolean;
  parent: Contenedor;
  desobservar: () => void;
}

export interface Motor<E extends EscenaMotor> {
  precalentar(): Promise<void>;
  estado(): EstadoMotor;
  adquirir(pantalla: string, parent: Contenedor): Adquisicion;
  soltar(adq: Adquisicion): void;
  escena(): E;
  sim(op: { worker: boolean; failFirstStart?: boolean }): SimRunner;
  /** Rehace el Game como al recuperar un contexto perdido. */
  perderContexto(): void;
  /** El gestor del lienzo la llama en cada creación del Game. */
  construir(reconstruccion: boolean): JuegoMotor<E>;
  /** Parent donde está el lienzo ahora: el del dueño o el oculto. */
  parentActual(): Contenedor;
}

export function crearMotor<E extends EscenaMotor>(deps: DepsMotor<E>): Motor<E> {
  const cuenta = { juegosCreados: 0, adquisiciones: 0, workersCreados: 0, oyentesWorker: 0 };
  let juego: JuegoMotor<E> | null = null;
  let runner: SimRunner | null = null;
  let claveRunner = "";
  let dueno: Adquisicion | null = null;
  let precalentando: Promise<void> | null = null;

  const parentActual = (): Contenedor => dueno?.parent ?? deps.oculto();

  const ajustar = () => {
    if (!juego || !dueno) return;
    const { clientWidth: w, clientHeight: h } = dueno.parent;
    // Un hueco sin tamaño aún (pantalla recién montada) no se aplica: dejaría el lienzo en 0x0.
    if (w > 0 && h > 0) juego.game.scale.resize(w, h);
  };

  const dormir = () => {
    const g = juego;
    if (!g) return;
    g.game.loop.sleep();
    // Si el bucle aún no había arrancado, sleep() no hace nada: se repite cuando ya corre.
    deps.despues(() => {
      if (!dueno && juego === g) g.game.loop.sleep();
    });
  };

  const despertar = () => {
    const l = juego?.game.loop;
    if (l && l.started !== false && l.running === false) l.wake();
  };

  // Mover el nodo conserva el contexto WebGL: el lienzo cambia de pantalla sin recrearse.
  const colocar = (g: JuegoMotor<E>, parent: Contenedor) => {
    if (g.game.canvas) parent.appendChild(g.game.canvas);
  };

  const montar = (adq: Adquisicion) => {
    if (!juego) return;
    colocar(juego, adq.parent);
    ajustar();
    adq.desobservar();
    adq.desobservar = deps.observar(adq.parent, ajustar);
    despertar();
  };

  const construir = (reconstruccion: boolean): JuegoMotor<E> => {
    const nuevo = deps.crearJuego(reconstruccion, juego?.escena ?? null);
    juego = nuevo;
    cuenta.juegosCreados++;
    if (dueno) montar(dueno);
    else {
      colocar(nuevo, deps.oculto());
      dormir();
    }
    return nuevo;
  };

  const soltarEscena = (adq: Adquisicion) => {
    adq.soltado = true;
    adq.desobservar();
    adq.desobservar = () => {};
    if (dueno === adq) {
      dueno = null;
      juego?.escena.soltar();
      if (juego) colocar(juego, deps.oculto());
      dormir();
    }
  };

  const nuevoRunner = (op: { worker: boolean }) => {
    runner?.terminate();
    runner = deps.crearRunner(op);
    claveRunner = String(op.worker);
    cuenta.workersCreados++;
    // Un Worker que sigue vivo conserva la capa «Fuerzas» de la pantalla anterior: cada pantalla la parte de apagada.
    runner.post({ type: "setFuerzas", raceId: "", on: false });
    return runner;
  };

  const sim = (op: { worker: boolean; failFirstStart?: boolean }): SimRunner => {
    const compartido = runner && claveRunner === String(op.worker) ? runner : nuevoRunner(op);
    const bajas = new Set<() => void>();
    let falloPendiente = Boolean(op.failFirstStart);
    let ultimaCarrera: string | null = null;
    return {
      get kind() {
        return compartido.kind;
      },
      post(msg: ToWorker) {
        if (msg.type === "startRace") {
          ultimaCarrera = msg.raceId;
          if (falloPendiente) {
            falloPendiente = false;
            // Solo pruebas: la primera carrera de la pantalla falla por el camino real de error.
            msg = { ...msg, trackId: "__fallo__" as typeof msg.trackId };
          }
        }
        compartido.post(msg);
      },
      subscribe(listener) {
        const quitar = compartido.subscribe(listener);
        cuenta.oyentesWorker++;
        let vivo = true;
        const baja = () => {
          if (!vivo) return;
          vivo = false;
          quitar();
          cuenta.oyentesWorker--;
          bajas.delete(baja);
        };
        bajas.add(baja);
        return baja;
      },
      terminate() {
        // El Worker sigue vivo: solo se para la carrera de esta pantalla y se deja de escucharle.
        if (ultimaCarrera !== null) compartido.post({ type: "stop", raceId: ultimaCarrera });
        [...bajas].forEach((b) => b());
      },
    };
  };

  return {
    precalentar() {
      if (!deps.puedeDibujar()) return Promise.resolve();
      precalentando ??= deps
        .preparar()
        .then(() => {
          if (!juego) deps.iniciar(construir);
          if (!runner) nuevoRunner(deps.opcionesRunner());
        })
        .catch((e: unknown) => {
          precalentando = null;
          throw e;
        });
      return precalentando;
    },
    estado(): EstadoMotor {
      return {
        listo: juego !== null && runner !== null,
        juegosCreados: cuenta.juegosCreados,
        juegosVivos: juego ? 1 : 0,
        adquisiciones: cuenta.adquisiciones,
        dueno: dueno?.pantalla ?? null,
        workersCreados: cuenta.workersCreados,
        oyentesWorker: cuenta.oyentesWorker,
        escenasActivas: juego?.escena.activa() ? 1 : 0,
      };
    },
    adquirir(pantalla, parent) {
      // Quien lo tenía y no lo soltó deja de recibir nada: su escena se reinicia aquí.
      if (dueno) soltarEscena(dueno);
      if (!juego) deps.iniciar(construir);
      const adq: Adquisicion = { pantalla, soltado: false, parent, desobservar: () => {} };
      dueno = adq;
      cuenta.adquisiciones++;
      montar(adq);
      return adq;
    },
    soltar: soltarEscena,
    escena() {
      if (!juego) throw new Error("el motor no tiene juego");
      return juego.escena;
    },
    sim,
    perderContexto() {
      construir(true);
    },
    construir,
    parentActual,
  };
}

// --- Motor real: un Phaser.Game y un Worker para toda la sesión -----------------------------------

type FabricaJuego = (parent: HTMLElement, anterior: EscenaReal | null) => JuegoMotor<EscenaReal>;
type EscenaReal = import("./track-scene").TrackScene;

// track-scene.ts se registra aquí al cargarse: el motor no lo importa de forma estática para no arrastrar Phaser a la Portada.
let fabrica: FabricaJuego | null = null;
let ocultoReal: HTMLElement | null = null;

function contenedorOculto(): HTMLElement {
  // Fuera del documento: el lienzo sin dueño conserva su contexto WebGL pero no cuenta como un <canvas> de la página.
  ocultoReal ??= document.createElement("div");
  return ocultoReal;
}

function opcionesPruebaReal(): { worker: boolean } {
  const q = new URLSearchParams(window.location.search);
  return { worker: !(q.get("pruebas") === "1" && q.get("worker") === "0") };
}

let real: Motor<EscenaReal> | null = null;
let gestorHecho = false;

function motorReal(): Motor<EscenaReal> {
  real ??= crearMotor<EscenaReal>({
    crearJuego: (reconstruccion, anterior) => {
      if (!fabrica) throw new Error("el motor no está preparado");
      return fabrica(contenedorOculto(), reconstruccion ? anterior : null);
    },
    iniciar: (construir) => {
      if (gestorHecho) return;
      // El gestor atiende la pérdida del contexto y rehace el Game con construir(true); el aviso sale sobre quien tenga el motor.
      gestionarLienzo(
        () => (real?.parentActual() as HTMLElement | undefined) ?? contenedorOculto(),
        (reconstruccion) => construir(reconstruccion).game as unknown as Phaser.Game,
        { alSinLienzo: () => alSinLienzoDueno?.() },
      );
      gestorHecho = true;
    },
    preparar: async () => {
      await import("./track-scene");
    },
    crearRunner: (op) => createSimRunner({ worker: op.worker }),
    opcionesRunner: opcionesPruebaReal,
    oculto: contenedorOculto,
    observar: (parent, alCambiar) => {
      if (typeof ResizeObserver === "undefined") return () => {};
      const ro = new ResizeObserver(alCambiar);
      ro.observe(parent as HTMLElement);
      return () => ro.disconnect();
    },
    despues: (fn) => void setTimeout(fn, 60),
    puedeDibujar,
  });
  return real;
}

/** track-scene.ts se registra al cargarse, así crear el juego no espera a nada. */
export function registrarFabrica(f: FabricaJuego): void {
  fabrica = f;
}

let alSinLienzoDueno: (() => void) | null = null;
/** Qué hace la pantalla que tiene el motor si el juego no se puede rehacer. */
export function fijarAlSinLienzo(fn: (() => void) | null): void {
  alSinLienzoDueno = fn;
}

export function motorCarrera(): Motor<EscenaReal> {
  return motorReal();
}

export function precalentarMotor(): Promise<void> {
  return motorReal().precalentar();
}

export function estadoMotor(): EstadoMotor {
  return real
    ? real.estado()
    : { listo: false, juegosCreados: 0, juegosVivos: 0, adquisiciones: 0, dueno: null, workersCreados: 0, oyentesWorker: 0, escenasActivas: 0 };
}

export function simCompartido(op: { worker: boolean; failFirstStart?: boolean }): SimRunner {
  return motorReal().sim(op);
}

/** Pone el precalentado en segundo plano cuando la Portada ya está pintada. */
export function precalentarCuandoLibre(): void {
  const lanzar = () => void precalentarMotor().catch(() => {});
  if (typeof requestIdleCallback === "function") requestIdleCallback(lanzar, { timeout: 3000 });
  else setTimeout(lanzar, 1500);
}
