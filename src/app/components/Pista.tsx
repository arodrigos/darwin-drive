"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatMeters } from "@/app/format";
import { runtime } from "@/debug/ganchos";
import { registrarPoses, reiniciarRendimiento } from "@/debug/rendimiento";
import type { TrackSceneHandle } from "@/game/track-scene";
import type { CarResult, EndReason } from "@/sim/constants";
import { STOCK_CAR, genomeHash, type Genome } from "@/sim/genome";
import { getTrack, type TrackId } from "@/sim/tracks";
import { createSimRunner } from "@/worker";
import type { FromWorker, SimRunner } from "@/worker/protocol";
import { PanelRendimiento } from "./PanelRendimiento";
import type { RankingsView } from "./TrackPicker";

const SIN_LIENZO = "Tu navegador no puede dibujar el juego. Prueba a actualizarlo o a abrirlo en Safari o Chrome.";
export const MENSAJE_ERROR = "La simulación se ha detenido por un error. Toca Reintentar para volver a empezar esta carrera.";
const MOTIVO: Record<EndReason, string> = { stall: "se atascó", timeout: "se acabó el tiempo", anomaly: "descalificado" };
const STOCK_HUE = 28;

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

export function Pista(props: { trackId: TrackId; onBack: () => void; rankings: RankingsView; genome?: Genome }) {
  const { trackId, genome = STOCK_CAR } = props;
  const track = getTrack(trackId)!;
  const host = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const iniciar = useRef<() => void>(() => {});
  const [failed, setFailed] = useState(() => !canDraw());
  const [fase, setFase] = useState<Fase>({ tipo: "corriendo" });
  const [rendimiento] = useState(() => parametrosPrueba().rendimiento);
  // La pista y el genoma se fijan al abrir: cambiarlos a media carrera sería correr una cosa y pintar otra.
  const fijo = useRef({ trackId, genome, marca: props.rankings[trackId][0]?.distance ?? null });

  useEffect(() => {
    if (failed) return;
    const { trackId: id, genome: g, marca } = fijo.current;
    const pista = getTrack(id)!;
    const prueba = parametrosPrueba();
    const runner: SimRunner = createSimRunner({ worker: prueba.worker, failFirstStart: prueba.fallo });
    let scene: TrackSceneHandle | null = null;
    let cancelled = false;
    let raceId = "";
    let intento = 0;
    let maxX = 0;
    let ultimaSim = 0;
    let esperas: { hasta: number; resolver: () => void }[] = [];
    const carId = genomeHash(g);

    const liberar = () => {
      const pendientes = esperas;
      esperas = [];
      pendientes.forEach((e) => e.resolver());
    };

    const alMensaje = (m: FromWorker) => {
      if (m.raceId !== raceId || !scene) return;
      if (m.type === "poses") {
        const lider = m.poses.reduce((a, p) => Math.max(a, p.x), 0);
        maxX = Math.max(maxX, lider);
        scene.setPoses(m.simTime, m.poses, m.simTime - ultimaSim > 0.5);
        ultimaSim = m.simTime;
        runtime.tiempoSim = m.simTime;
        runtime.distanciaLider = maxX;
        runtime.cochesVivos = m.poses.filter((p) => !p.finished).length;
        registrarPoses(m.simTime, runtime.cochesVivos);
        if (hud.current) hud.current.textContent = formatMeters(maxX);
        esperas = esperas.filter((e) => (m.simTime >= e.hasta ? (e.resolver(), false) : true));
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
      } else if (m.type === "error") {
        setFase({ tipo: "error" });
        liberar();
      }
    };

    const lanzar = () => {
      if (!scene) return;
      raceId = `carrera-${++intento}`;
      maxX = 0;
      ultimaSim = 0;
      reiniciarRendimiento();
      runtime.ultimoResultado = null;
      runtime.distanciaLider = 0;
      runtime.cochesVivos = 1;
      runtime.tiempoSim = 0;
      if (hud.current) hud.current.textContent = formatMeters(0);
      scene.begin({ track: pista, cars: [{ carId, genome: g, hue: STOCK_HUE, label: "Coche de serie" }], flag: marca });
      setFase({ tipo: "corriendo" });
      runner.post({ type: "startRace", raceId, cars: [{ carId, genome: g }], trackId: id, pace: "x1" });
    };
    iniciar.current = lanzar;

    const unsubscribe = runner.subscribe(alMensaje);
    runtime.pistaEnCarrera = id;
    runtime.genomaEnPista = g;
    runtime.ejecutor = runner.kind;
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
      runner.post({ type: document.visibilityState === "hidden" ? "pause" : "resume", raceId });
    };
    document.addEventListener("visibilitychange", alCambiarVisibilidad);

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
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      runner.post({ type: "stop", raceId });
      unsubscribe();
      runner.terminate();
      scene?.destroy();
      liberar();
      iniciar.current = () => {};
      runtime.avanzar = null;
      runtime.pistaEnCarrera = null;
      runtime.genomaEnPista = null;
      runtime.distanciaLider = null;
      runtime.cochesVivos = 0;
      runtime.tiempoSim = null;
      runtime.ejecutor = null;
    };
  }, [failed]);

  const repetir = useCallback(() => iniciar.current(), []);

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
      <div className="lienzo" ref={host} data-testid="lienzo" />
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
      {fase.tipo === "fin" && (
        <div className="tarjeta-fin" role="dialog" aria-label="Fin de la carrera" data-testid="tarjeta-fin">
          <h2>Fin de la carrera · {track.name}</h2>
          <p className="cifra" data-testid="fin-distancia">
            {formatMeters(fase.result.distance)}
          </p>
          <p data-testid="fin-motivo">Motivo: {MOTIVO[fase.result.reason]}</p>
          <div className="acciones">
            <button type="button" className="pastilla" onClick={repetir} data-testid="repetir">
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
