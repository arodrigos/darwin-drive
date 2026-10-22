"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatMeters } from "@/app/format";
import { formatTiempo } from "@/sim/clasificacion";
import { avisoRanking, textoRanking } from "@/app/ranking-text";
import { runtime } from "@/debug/ganchos";
import { markInput, measureOnNextFrame } from "@/debug/latencias";
import { registrarPoses, reiniciarRendimiento } from "@/debug/rendimiento";
import type { TrackSceneHandle } from "@/game/track-scene";
import type { CarResult, EndReason } from "@/sim/constants";
import { STOCK_CAR, genomeHash, type Genome } from "@/sim/genome";
import { resolverPista, type TrackId } from "@/sim/tracks";
import type { RitmoRecordado } from "@/storage/meta";
import { textoCausa } from "@/app/ayuda/causas";
import { RANKING_SIZE } from "@/storage/schema";
import type { RankingOutcome } from "@/storage/store";
import { createSimRunner } from "@/worker";
import type { FromWorker, Pace, SimRunner } from "@/worker/protocol";
import { actualizarAviso, SIN_AVISO } from "../ritmo";
import { ControlRitmo } from "./ControlRitmo";
import { PanelRendimiento } from "./PanelRendimiento";
import type { RankingsView } from "./TrackPicker";

const SIN_LIENZO = "Tu navegador no puede dibujar el juego. Prueba a actualizarlo o a abrirlo en Safari o Chrome.";
export const MENSAJE_ERROR = "La simulación se ha detenido por un error. Toca Reintentar para volver a empezar esta carrera.";
const MOTIVO: Record<EndReason, string> = { meta: "¡Meta!", stall: "se atascó", timeout: "se acabó el tiempo", anomaly: "descalificado" };
const STOCK_HUE = 28;
const AVISO_RANKING_MS = 2500;
// La barra de «Hasta el final» se llena hasta los 5 km de la meta.
const OBJETIVO_BARRA_M = 5000;

function canDraw(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("2d"));
  } catch {
    return false;
  }
}

/** Los parámetros de prueba solo valen con ?pruebas=1: en el juego normal no existen. */
function parametrosPrueba(): { worker: boolean; fallo: boolean; rendimiento: boolean } {
  const q = new URLSearchParams(window.location.search);
  const pruebas = q.get("pruebas") === "1";
  return {
    worker: !(pruebas && q.get("worker") === "0"),
    fallo: pruebas && q.get("fallo") === "worker",
    rendimiento: q.get("rendimiento") === "1",
  };
}

type Fase = { tipo: "corriendo" } | { tipo: "fin"; result: CarResult } | { tipo: "error" };

export interface PistaProps {
  trackId: TrackId;
  onBack: () => void;
  rankings: RankingsView;
  genome?: Genome;
  /** Con esta función la marca se inscribe en el ranking de la pista; el resultado es el que enseña la tarjeta. */
  onFinish?: (result: CarResult) => Promise<RankingOutcome | null>;
  /** El último de ×1/×2/×4/×8 con el que se corrió; «Hasta el final» no se recuerda. */
  ritmoInicial?: RitmoRecordado;
  onRitmo?: (ritmo: RitmoRecordado) => void;
  /** Hay una migración de marcas en curso: la tarjeta avisa de que el récord se confirma al acabar. */
  migrando?: boolean;
  /** La tarjeta de fin se ve o deja de verse; el aviso final de migración espera a que no haya tarjeta. */
  onTarjeta?: (visible: boolean) => void;
  /** Una capa (ayuda, guía) está encima: la carrera espera. */
  pausaCapa?: boolean;
  /** Abre la guía en «Por qué se para un coche»; la tarjeta sigue debajo y se recupera al cerrar. */
  onPorQue?: () => void;
}

export function Pista(props: PistaProps) {
  const { trackId, genome = STOCK_CAR } = props;
  const track = resolverPista(trackId)!;
  const host = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const iniciar = useRef<() => void>(() => {});
  const [failed, setFailed] = useState(() => !canDraw());
  const [fase, setFase] = useState<Fase>({ tipo: "corriendo" });
  const [inscripcion, setInscripcion] = useState<{ outcome: RankingOutcome; distance: number } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const onTarjeta = props.onTarjeta;
  const hayTarjeta = fase.tipo === "fin";
  useEffect(() => {
    if (!hayTarjeta) return;
    onTarjeta?.(true);
    return () => onTarjeta?.(false);
  }, [hayTarjeta, onTarjeta]);
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alTerminar = useRef(props.onFinish);
  useEffect(() => {
    alTerminar.current = props.onFinish;
  });
  const [ritmo, setRitmo] = useState<RitmoRecordado>(props.ritmoInicial ?? "x1");
  const [final, setFinal] = useState(false);
  const [avance, setAvance] = useState(0);
  const [rotulo, setRotulo] = useState<number | null>(null);
  // Lo que ya sabe el efecto que posee el ejecutor: se escribe aquí y los botones lo leen.
  const ritmoRecordado = useRef<RitmoRecordado>(props.ritmoInicial ?? "x1");
  const eligeRitmo = useRef<(p: Pace) => void>(() => {});
  const alRitmo = useRef(props.onRitmo);
  useEffect(() => {
    alRitmo.current = props.onRitmo;
  });
  const pausarPorCapa = useRef<(on: boolean) => void>(() => {});
  const [rendimiento] = useState(() => parametrosPrueba().rendimiento);
  // La pista y el genoma se fijan al abrir: cambiarlos a media carrera sería correr una cosa y pintar otra.
  const fijo = useRef({ trackId, genome, propio: Boolean(props.genome), marca: props.rankings[trackId]?.[0]?.distance ?? null });

  useEffect(() => {
    if (failed) return;
    const { trackId: id, genome: g, marca, propio } = fijo.current;
    const pista = resolverPista(id)!;
    const prueba = parametrosPrueba();
    const runner: SimRunner = createSimRunner({ worker: prueba.worker, failFirstStart: prueba.fallo });
    let scene: TrackSceneHandle | null = null;
    let cancelled = false;
    let raceId = "";
    let intento = 0;
    let maxX = 0;
    let ultimaSim = 0;
    let pace: Pace = ritmoRecordado.current;
    let aviso = SIN_AVISO;
    // Pausa que pone la pantalla al ocultarse la página; la del jugador (si la hubiera) no se pisa.
    let pausaPorVisibilidad = false;
    // Pausa que pone una capa abierta encima (el panel de ayuda): sobrevive a ocultar y volver la página.
    let pausaPorCapa = false;
    let esperas: { hasta: number; resolver: () => void }[] = [];
    const carId = genomeHash(g);

    const liberar = () => {
      const pendientes = esperas;
      esperas = [];
      pendientes.forEach((e) => e.resolver());
    };

    const medirRitmo = (ritmoReal: number | undefined) => {
      const nuevo = actualizarAviso(aviso, pace, ritmoReal, performance.now());
      if (nuevo.rotulo !== aviso.rotulo) setRotulo(nuevo.rotulo);
      aviso = nuevo;
      if (ritmoReal !== undefined) runtime.ritmoReal = ritmoReal;
    };

    const alMensaje = (m: FromWorker) => {
      if (m.raceId !== raceId || !scene) return;
      if (m.type === "progress") {
        // En «Hasta el final» no hay poses: el contador y la barra siguen al coche por aquí.
        if (m.leaderX !== undefined && m.simTime !== undefined && pace === "turbo") {
          maxX = Math.max(maxX, m.leaderX);
          runtime.distanciaLider = maxX;
          runtime.tiempoSim = m.simTime;
          if (hud.current) hud.current.textContent = formatMeters(maxX);
          setAvance(maxX);
        }
      } else if (m.type === "poses") {
        medirRitmo(m.ritmoReal);
        const lider = m.poses.reduce((a, p) => Math.max(a, p.x), 0);
        maxX = Math.max(maxX, lider);
        scene.setPoses(m.simTime, m.poses, m.simTime - ultimaSim > 0.5);
        ultimaSim = m.simTime;
        runtime.tiempoSim = m.simTime;
        runtime.distanciaLider = maxX;
        runtime.cargas = m.poses[0]?.cargas ?? null;
        runtime.cochesVivos = m.poses.filter((p) => !p.finished).length;
        registrarPoses(m.simTime, runtime.cochesVivos);
        if (hud.current) hud.current.textContent = formatMeters(maxX);
        // Con todos los coches terminados el motor emite raceDone justo después: si la espera se resolviera
        // aquí, adelantarSimulacion podría devolver antes de que exista ultimoResultado (CI lento).
        if (runtime.cochesVivos > 0) esperas = esperas.filter((e) => (m.simTime >= e.hasta ? (e.resolver(), false) : true));
      } else if (m.type === "carFinished") {
        scene.carFinished(m.result);
      } else if (m.type === "raceDone") {
        // La tarjeta enseña el resultado del ejecutor tal cual, sin recalcular nada aquí.
        const result = m.results[0];
        runtime.ultimoResultado = result;
        runtime.cochesVivos = 0;
        if (hud.current) hud.current.textContent = formatMeters(result.distance);
        setFase({ tipo: "fin", result });
        liberar();
        const inscribir = alTerminar.current;
        if (inscribir) {
          void inscribir(result).then((outcome) => {
            if (cancelled || !outcome) return;
            setInscripcion({ outcome, distance: result.distance });
            // Un nuevo n.º 1 clava su bandera en la x donde acabó el coche.
            if (outcome.isRecord) scene?.setFlag(result.distance);
            const texto = avisoRanking(outcome, pista.name, result.distance);
            if (texto) {
              setAviso(texto);
              if (avisoTimer.current) clearTimeout(avisoTimer.current);
              avisoTimer.current = setTimeout(() => setAviso(null), AVISO_RANKING_MS);
            }
          });
        }
      } else if (m.type === "error") {
        setFase({ tipo: "error" });
        liberar();
      }
    };

    const lanzar = () => {
      if (!scene) return;
      raceId = `carrera-${++intento}`;
      // «Repetir» vuelve al ritmo recordado: «Hasta el final» era cosa de la carrera anterior.
      pace = ritmoRecordado.current;
      aviso = SIN_AVISO;
      setRotulo(null);
      setFinal(false);
      setAvance(0);
      runtime.ritmo = pace;
      runtime.ritmoReal = null;
      maxX = 0;
      ultimaSim = 0;
      reiniciarRendimiento();
      runtime.ultimoResultado = null;
      runtime.distanciaLider = 0;
      runtime.cochesVivos = 1;
      runtime.tiempoSim = 0;
      if (hud.current) hud.current.textContent = formatMeters(0);
      scene.begin({ track: pista, cars: [{ carId, genome: g, hue: STOCK_HUE, label: propio ? "Tu coche" : "Coche de serie" }], flag: marca });
      setFase({ tipo: "corriendo" });
      setInscripcion(null);
      measureOnNextFrame("probar");
      runner.post({ type: "startRace", raceId, cars: [{ carId, genome: g }], trackId: id, pace });
      measureOnNextFrame("repetir");
    };
    iniciar.current = lanzar;
    eligeRitmo.current = (p) => {
      const evento = p === "turbo" ? "hasta-el-final" : "ritmo";
      markInput(evento);
      pace = p;
      aviso = SIN_AVISO;
      setRotulo(null);
      runtime.ritmo = p;
      runner.post({ type: "setPace", raceId, pace: p });
      if (p === "turbo") {
        setAvance(maxX);
        setFinal(true);
      } else {
        setFinal(false);
        setRitmo(p);
        ritmoRecordado.current = p;
        alRitmo.current?.(p);
      }
      measureOnNextFrame(evento);
    };

    const unsubscribe = runner.subscribe(alMensaje);
    runtime.pistaEnCarrera = id;
    runtime.genomaEnPista = g;
    runtime.ejecutor = runner.kind;
    runtime.aplicarLimite = (max) => runner.post({ type: "limitRate", max });
    if (runtime.limiteRitmo !== null) runner.post({ type: "limitRate", max: runtime.limiteRitmo });
    runtime.avanzar = (segundos) =>
      new Promise<void>((resolver) => {
        if (!scene) return resolver();
        esperas.push({ hasta: ultimaSim + segundos - 1e-6, resolver });
        runner.post({ type: "advance", raceId, seconds: segundos });
      }).then(
        // Dos frames: el primero aplica el estado a la escena y el segundo lo deja pintado.
        () => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))),
      );

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "hidden") {
        pausaPorVisibilidad = true;
        runner.post({ type: "pause", raceId });
      } else if (pausaPorVisibilidad) {
        pausaPorVisibilidad = false;
        if (!pausaPorCapa) runner.post({ type: "resume", raceId });
      }
      aviso = SIN_AVISO;
      setRotulo(null);
    };
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    pausarPorCapa.current = (on) => {
      if (on === pausaPorCapa) return;
      pausaPorCapa = on;
      runtime.pausada = on;
      if (on) {
        if (!pausaPorVisibilidad) runner.post({ type: "pause", raceId });
      } else if (!pausaPorVisibilidad) {
        runner.post({ type: "resume", raceId });
      }
    };

    import("@/game/track-scene")
      .then(({ startTrackScene }) => {
        if (cancelled || !host.current) return;
        scene = startTrackScene(host.current, pista);
        lanzar();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (avisoTimer.current) clearTimeout(avisoTimer.current);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      pausarPorCapa.current = () => {};
      runtime.pausada = false;
      runner.post({ type: "stop", raceId });
      unsubscribe();
      runner.terminate();
      scene?.destroy();
      liberar();
      iniciar.current = () => {};
      runtime.avanzar = null;
      runtime.aplicarLimite = null;
      runtime.ritmo = null;
      runtime.ritmoReal = null;
      runtime.pistaEnCarrera = null;
      runtime.genomaEnPista = null;
      runtime.distanciaLider = null;
      runtime.cochesVivos = 0;
      runtime.tiempoSim = null;
      runtime.cargas = null;
      runtime.cajaCoche = null;
      runtime.marcador = null;
      runtime.ejecutor = null;
    };
  }, [failed]);

  const repetir = useCallback(() => iniciar.current(), []);
  useEffect(() => {
    pausarPorCapa.current(Boolean(props.pausaCapa));
  }, [props.pausaCapa]);

  if (failed) {
    return (
      <div className="sin-lienzo" role="alert" data-testid="sin-lienzo">
        <p>{SIN_LIENZO}</p>
        <button type="button" className="pastilla" onClick={props.onBack}>
          Volver
        </button>
      </div>
    );
  }

  return (
    <div className="explorar" data-testid="pista">
      <div className={final ? "lienzo atenuado" : "lienzo"} ref={host} data-testid="lienzo" />
      <div className="cabecera">
        <button type="button" className="pastilla" onClick={props.onBack} data-testid="volver">
          ← Volver
        </button>
        <div className="nombre-pista" data-testid="nombre-pista">
          {track.name}
        </div>
      </div>
      <div className="hud-distancia" ref={hud} data-testid="hud-distancia" aria-live="off">
        0,0 m
      </div>
      {rendimiento && <PanelRendimiento />}
      {aviso && (
        <div className="aviso-ranking" role="status" data-testid="aviso-ranking">
          {aviso}
        </div>
      )}
      {fase.tipo === "corriendo" && (
        <div className="pie-pista">
          {final && (
            <div className="banda-final" role="status" data-testid="banda-final">
              <span>Simulando hasta el final…</span>
              <progress max={OBJETIVO_BARRA_M} value={avance} data-testid="barra-final" />
            </div>
          )}
          <ControlRitmo
            prefijo="ritmo"
            activo={final ? "turbo" : ritmo}
            onElegir={(p) => eligeRitmo.current(p)}
            ritmoReal={rotulo}
            etiquetaFinal="Hasta el final"
          />
        </div>
      )}
      {fase.tipo === "fin" && (
        <div className="tarjeta-fin" role="dialog" aria-label="Fin de la carrera" data-testid="tarjeta-fin">
          <div className="cuerpo-fin">
          <h2>Fin de la carrera · {track.name}</h2>
          <p className="cifra" data-testid="fin-marca">
            <span data-testid="fin-distancia">{formatMeters(fase.result.distance)}</span> en <span data-testid="fin-tiempo">{formatTiempo(fase.result.bestStep)}</span>
          </p>
          <p data-testid="fin-motivo">{fase.result.reason === "meta" ? MOTIVO.meta : `Motivo: ${MOTIVO[fase.result.reason]}`}</p>
          {fase.result.reason === "stall" && (
            <>
              <p data-testid="fin-causa">{textoCausa(fase.result.causaParada, fase.result.pendienteParada)}</p>
              {props.onPorQue && (
                <button type="button" className="pastilla" onClick={props.onPorQue} data-testid="fin-porque">
                  ¿Por qué?
                </button>
              )}
            </>
          )}
          {inscripcion && (
            <>
              <p className="resultado-ranking" data-testid="tarjeta-ranking">
                {textoRanking(inscripcion.outcome, track.name, inscripcion.distance)}
              </p>
              {inscripcion.outcome.entered && (
                <p data-testid="tarjeta-puesto">
                  Puesto {inscripcion.outcome.position} de {RANKING_SIZE} en {track.name}
                </p>
              )}
            </>
          )}
          {props.migrando && (
            <p className="nota-migracion" data-testid="fin-record-pendiente">
              Récord pendiente: se confirma al terminar de actualizar las marcas.
            </p>
          )}
          </div>
          <div className="acciones">
            <button type="button" className="pastilla" onClick={() => {
                markInput("repetir");
                repetir();
              }}
              data-testid="repetir"
            >
              Repetir
            </button>
            <button type="button" className="pastilla" onClick={props.onBack} data-testid="volver-fin">
              Volver
            </button>
          </div>
        </div>
      )}
      {fase.tipo === "error" && (
        <div className="tarjeta-fin error" role="alert" data-testid="error-simulacion">
          <p>{MENSAJE_ERROR}</p>
          <div className="acciones">
            <button type="button" className="pastilla" onClick={repetir} data-testid="reintentar">
              Reintentar
            </button>
            <button type="button" className="pastilla" onClick={props.onBack}>
              Volver
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
