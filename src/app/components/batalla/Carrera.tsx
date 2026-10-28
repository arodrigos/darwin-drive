"use client";

import { useEffect, useRef, useState } from "react";
import { formatMeters } from "@/app/format";
import { actualizarAviso, SIN_AVISO } from "@/app/ritmo";
import { aplicarMuestra, publicarFuerzas, reiniciarFuerzasVivo } from "@/app/fuerzas-vivo";
import { filasMarcador, flechasBorde, idCocheBatalla, jugadorDeCoche, type FilaMarcador, type FlechaBorde } from "@/batalla/carrera";
import type { JugadorBatalla } from "@/batalla/estado";
import { runtime } from "@/debug/ganchos";
import { markInput, measureOnNextFrame } from "@/debug/latencias";
import { PALETA_COCHES } from "@/game/colores-coche";
import { puedeDibujar } from "@/game/lienzo";
import type { TrackSceneHandle } from "@/game/track-scene";
import type { CarPose, CarResult } from "@/sim/constants";

import { resolverPista, type TrackId } from "@/sim/tracks";
import type { RitmoRecordado } from "@/storage/meta";
import { createSimRunner } from "@/worker";
import type { FromWorker, Pace, SimRunner } from "@/worker/protocol";
import { ControlRitmo } from "../ControlRitmo";

const SIN_LIENZO = "Tu navegador no puede dibujar el juego. Prueba a actualizarlo o a abrirlo en Safari o Chrome.";
export const MENSAJE_ERROR_BATALLA = "La simulación se ha detenido por un error. Toca Reintentar para volver a empezar la carrera.";
const OBJETIVO_BARRA_M = 5000;

export interface CarreraProps {
  trackId: TrackId;
  jugadores: JugadorBatalla[];
  /** Todos los coches han terminado: la batalla pasa al resultado con estos resultados (uno por jugador). */
  onTerminada: (resultados: CarResult[]) => void;
  /** Salir sin perder la batalla. */
  onSalir: () => void;
  ritmoInicial?: RitmoRecordado;
  onRitmo?: (r: RitmoRecordado) => void;
}

/** Parámetros de prueba: solo valen con ?pruebas=1. */
function parametrosPrueba(): { worker: boolean; fallo: boolean } {
  const q = new URLSearchParams(window.location.search);
  const pruebas = q.get("pruebas") === "1";
  return { worker: !(pruebas && q.get("worker") === "0"), fallo: pruebas && q.get("fallo") === "worker" };
}

export function Carrera(props: CarreraProps) {
  const { trackId, jugadores } = props;
  const track = resolverPista(trackId)!;
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(() => !puedeDibujar());
  const [error, setError] = useState(false);
  const [intento, setIntento] = useState(0);
  const [filas, setFilas] = useState<FilaMarcador[]>(() => jugadores.map((_, i) => ({ jugador: i, distancia: 0, parado: false })));
  const [flechas, setFlechas] = useState<FlechaBorde[]>([]);
  const [ritmo, setRitmo] = useState<RitmoRecordado>(props.ritmoInicial ?? "x1");
  const [final, setFinal] = useState(false);
  const [avance, setAvance] = useState(0);
  const [rotulo, setRotulo] = useState<number | null>(null);
  const [fuerzas, setFuerzas] = useState(false);
  const ritmoRecordado = useRef<RitmoRecordado>(props.ritmoInicial ?? "x1");
  const eligeRitmo = useRef<(p: Pace) => void>(() => {});
  const eligeFuerzas = useRef<(on: boolean) => void>(() => {});
  const alRitmo = useRef(props.onRitmo);
  const alTerminar = useRef(props.onTerminada);
  useEffect(() => {
    alRitmo.current = props.onRitmo;
    alTerminar.current = props.onTerminada;
  });
  // La pista y los coches se fijan al abrir: cambiarlos a media carrera sería correr una cosa y pintar otra.
  const fijo = useRef({ trackId, jugadores });

  useEffect(() => {
    if (failed) return;
    const { trackId: id, jugadores: js } = fijo.current;
    const pista = resolverPista(id)!;
    const prueba = parametrosPrueba();
    const runner: SimRunner = createSimRunner({ worker: prueba.worker, failFirstStart: prueba.fallo && intento === 0 });
    let scene: TrackSceneHandle | null = null;
    let cancelled = false;
    const raceId = `batalla-${intento + 1}`;
    let pace: Pace = ritmoRecordado.current;
    let aviso = SIN_AVISO;
    let ultimaSim = 0;
    let pausaPorVisibilidad = false;
    let esperas: { hasta: number; resolver: () => void }[] = [];
    const maximos = new Map<number, number>();
    let ultimoTexto = "";
    const cars = js.map((j, i) => ({ carId: idCocheBatalla(i), genome: j.coche!.genome }));

    const liberar = () => {
      const pendientes = esperas;
      esperas = [];
      pendientes.forEach((e) => e.resolver());
    };
    const publicar = (poses: CarPose[]) => {
      const f = filasMarcador(poses, maximos);
      const vista = scene?.vistaCoches() ?? [];
      const fuera = new Set(vista.filter((v) => !v.enPantalla).map((v) => jugadorDeCoche(v.carId)));
      const fl = flechasBorde(f, fuera);
      runtime.carreraBatalla = f.map((x) => ({ carId: idCocheBatalla(x.jugador), distancia: x.distancia, enPantalla: !fuera.has(x.jugador) }));
      runtime.distanciaLider = f[0]?.distancia ?? 0;
      // Solo se repinta el marcador si lo visible cambió (décimas): a 30 Hz no hace falta rehacer el árbol cada vez.
      const texto = JSON.stringify([f.map((x) => [x.jugador, Math.round(x.distancia * 10), x.parado]), fl.map((x) => [x.jugador, Math.round(x.falta)])]);
      if (texto === ultimoTexto) return;
      ultimoTexto = texto;
      setFilas(f);
      setFlechas(fl);
    };

    const alMensaje = (m: FromWorker) => {
      if (m.raceId !== raceId || !scene) return;
      if (m.type === "progress") {
        if (m.leaderX !== undefined && m.simTime !== undefined && pace === "turbo") {
          runtime.distanciaLider = Math.max(runtime.distanciaLider ?? 0, m.leaderX);
          runtime.tiempoSim = m.simTime;
          setAvance(m.leaderX);
        }
      } else if (m.type === "poses") {
        const nuevo = actualizarAviso(aviso, pace, m.ritmoReal, performance.now());
        if (nuevo.rotulo !== aviso.rotulo) setRotulo(nuevo.rotulo);
        aviso = nuevo;
        if (m.ritmoReal !== undefined) runtime.ritmoReal = m.ritmoReal;
        aplicarMuestra(scene, m.fuerzas);
        scene.setPoses(m.simTime, m.poses, m.simTime - ultimaSim > 0.5);
        ultimaSim = m.simTime;
        runtime.tiempoSim = m.simTime;
        runtime.cochesVivos = m.poses.filter((p) => !p.finished).length;
        publicar(m.poses);
        if (runtime.cochesVivos > 0) esperas = esperas.filter((e) => (m.simTime >= e.hasta ? (e.resolver(), false) : true));
      } else if (m.type === "carFinished") {
        scene.carFinished(m.result);
      } else if (m.type === "raceDone") {
        runtime.cochesVivos = 0;
        liberar();
        alTerminar.current(m.results);
      } else if (m.type === "error") {
        setError(true);
        liberar();
      }
    };

    eligeRitmo.current = (p) => {
      const evento = p === "turbo" ? "hasta-el-final" : "ritmo";
      markInput(evento);
      pace = p;
      aviso = SIN_AVISO;
      setRotulo(null);
      runtime.ritmo = p;
      runner.post({ type: "setPace", raceId, pace: p });
      if (p === "turbo") {
        setAvance(runtime.distanciaLider ?? 0);
        setFinal(true);
      } else {
        setFinal(false);
        setRitmo(p);
        ritmoRecordado.current = p;
        alRitmo.current?.(p);
      }
      measureOnNextFrame(evento);
    };
    eligeFuerzas.current = (on) => {
      markInput("fuerzas-carrera");
      scene?.activarFuerzas(on);
      publicarFuerzas(on);
      runner.post({ type: "setFuerzas", raceId, on });
    };
    reiniciarFuerzasVivo();
    const unsubscribe = runner.subscribe(alMensaje);
    runtime.pistaEnCarrera = id;
    runtime.ejecutor = runner.kind;
    runtime.ritmo = pace;
    runtime.ritmoReal = null;
    runtime.distanciaLider = 0;
    runtime.cochesVivos = js.length;
    runtime.carreraBatalla = js.map((_, i) => ({ carId: idCocheBatalla(i), distancia: 0, enPantalla: true }));
    runtime.aplicarLimite = (max) => runner.post({ type: "limitRate", max });
    if (runtime.limiteRitmo !== null) runner.post({ type: "limitRate", max: runtime.limiteRitmo });
    runtime.avanzar = (segundos) =>
      new Promise<void>((resolver) => {
        if (!scene) return resolver();
        esperas.push({ hasta: ultimaSim + segundos - 1e-6, resolver });
        runner.post({ type: "advance", raceId, seconds: segundos });
      }).then(() => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))));

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "hidden") {
        pausaPorVisibilidad = true;
        runner.post({ type: "pause", raceId });
      } else if (pausaPorVisibilidad) {
        pausaPorVisibilidad = false;
        runner.post({ type: "resume", raceId });
      }
      aviso = SIN_AVISO;
      setRotulo(null);
    };
    document.addEventListener("visibilitychange", alCambiarVisibilidad);

    import("@/game/track-scene")
      .then(({ startTrackScene }) => {
        if (cancelled || !host.current) return;
        scene = startTrackScene(host.current, pista, { pantalla: "batalla", alSinLienzo: () => setFailed(true) });
        scene.begin({
          track: pista,
          // El color no es el único canal: cada coche lleva su nombre encima.
          cars: js.map((j, i) => ({ carId: idCocheBatalla(i), genome: j.coche!.genome, hue: 28, color: j.color, label: j.nombre })),
          fantasma: null,
        });
        runner.post({ type: "startRace", raceId, cars, trackId: id, pace });
        // La medida llega hasta el primer frame con los coches pintados, no hasta que se encola la carrera.
        measureOnNextFrame("a-correr");
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
      runtime.avanzar = null;
      runtime.aplicarLimite = null;
      runtime.ritmo = null;
      runtime.ritmoReal = null;
      runtime.pistaEnCarrera = null;
      runtime.distanciaLider = null;
      runtime.cochesVivos = 0;
      runtime.tiempoSim = null;
      runtime.carreraBatalla = null;
      runtime.ejecutor = null;
      eligeFuerzas.current = () => {};
      reiniciarFuerzasVivo();
    };
  }, [failed, intento]);

  if (failed) {
    return (
      <div className="sin-lienzo" role="alert" data-testid="sin-lienzo">
        <p>{SIN_LIENZO}</p>
        <button type="button" className="pastilla" onClick={props.onSalir}>
          Volver
        </button>
      </div>
    );
  }

  const nombre = (i: number) => jugadores[i].nombre;
  return (
    <div className="explorar" data-testid="batalla-carrera">
      <div className={final ? "lienzo atenuado" : "lienzo"} ref={host} data-testid="lienzo" />
      <div className="cabecera">
        <button type="button" className="pastilla" onClick={props.onSalir} data-testid="volver">
          ← Salir y continuar luego
        </button>
        <div className="nombre-pista" data-testid="nombre-pista">
          {track.name}
        </div>
      </div>
      <div className="hud-batalla">
      <ol className="marcador-batalla" data-testid="marcador-batalla" aria-label="Marcador en vivo">
        {filas.map((f) => (
          <li key={f.jugador} className="chip-marcador" data-testid={`chip-${f.jugador}`} data-color={jugadores[f.jugador].color}>
            <span className="muestra-color" aria-hidden="true" style={{ background: PALETA_COCHES[jugadores[f.jugador].color].hex }} />
            <span className="chip-nombre">{nombre(f.jugador)}</span>
            <span className="chip-distancia">{f.parado ? `parado · ${formatMeters(f.distancia)}` : formatMeters(f.distancia)}</span>
          </li>
        ))}
      </ol>
      {flechas.length > 0 && (
        <ul className="flechas-borde" data-testid="flechas-borde" aria-label="Coches fuera de pantalla">
          {flechas.map((f) => (
            <li key={f.jugador} className="flecha-borde" data-testid={`flecha-${f.jugador}`} style={{ borderColor: PALETA_COCHES[jugadores[f.jugador].color].hex }}>
              ◀ {nombre(f.jugador)} −{Math.round(f.falta)} m
            </li>
          ))}
        </ul>
      )}
      </div>
      {error ? (
        <div className="tarjeta-fin error" role="alert" data-testid="error-simulacion">
          <p>{MENSAJE_ERROR_BATALLA}</p>
          <div className="acciones">
            <button
              type="button"
              className="pastilla"
              data-testid="reintentar"
              onClick={() => {
                setError(false);
                setFinal(false);
                setIntento((n) => n + 1);
              }}
            >
              Reintentar
            </button>
            <button type="button" className="pastilla" onClick={props.onSalir}>
              Volver
            </button>
          </div>
        </div>
      ) : (
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
            fuerzas={{
              activa: fuerzas,
              onAlternar: () => {
                eligeFuerzas.current(!fuerzas);
                setFuerzas(!fuerzas);
              },
            }}
          />
        </div>
      )}
    </div>
  );
}
