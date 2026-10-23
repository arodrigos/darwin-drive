"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { formatMeters } from "@/app/format";
import { avisoRanking } from "@/app/ranking-text";
import { runtime } from "@/debug/ganchos";
import { markInput, measureOnNextFrame } from "@/debug/latencias";
import { registrarPoses, reiniciarRendimiento } from "@/debug/rendimiento";
import { nextGeneration, setFavorite, type EvolutionState, type GenerationStats, type Individual } from "@/evolution/ga";
import type { LineageNode } from "@/evolution/lineage";
import type { TrackSceneHandle } from "@/game/track-scene";
import type { CarResult } from "@/sim/constants";
import { getTrack } from "@/sim/tracks";
import type { RankingOutcome } from "@/storage/store";
import { createSimRunner } from "@/worker";
import type { FromWorker, Pace, SimRunner } from "@/worker/protocol";
import { actualizarAviso, SIN_AVISO } from "../ritmo";
import { ControlRitmo } from "./ControlRitmo";
import { PanelRendimiento } from "./PanelRendimiento";
import type { RankingsView } from "./TrackPicker";
import { puedeDibujar } from "@/game/lienzo";

const SIN_LIENZO = "Tu navegador no puede dibujar el juego. Prueba a actualizarlo o a abrirlo en Safari o Chrome.";
export const MENSAJE_ERROR_EVOLUCION = "La simulación se ha detenido por un error. Toca Reintentar para volver a lanzar esta generación.";
export const GRAFICA_VACIA = "Aún no ha terminado ninguna generación";
export const AVISO_FAVORITO = "Favorito: tendrá hijos seguro";
export const AVISO_ESTANCADA = "Estancada: subo la mutación para buscar ideas nuevas";
const AVISO_MS = 2000;
const AVISO_RANKING_MS = 2500;
const ESTANCAMIENTO_AVISO = 5;

export interface Campeon {
  individual: Individual;
  result: CarResult;
  generation: number;
}

export interface EvolucionProps {
  initial: EvolutionState;
  rankings: RankingsView;
  /** Guarda el estado y el linaje; inscribe al campeón en el ranking de la pista y devuelve el resultado. */
  onGeneracion: (state: EvolutionState, lineageAdded: LineageNode[], campeon: Campeon | null) => Promise<RankingOutcome | null>;
  /** Pide el nombre y lleva al campeón al garaje; devuelve el texto del aviso, o null si se canceló. */
  onGuardarCampeon: (campeon: Campeon) => Promise<string | null>;
  onBack: () => void;
}

function mostrarRendimiento(): boolean {
  return new URLSearchParams(window.location.search).get("rendimiento") === "1";
}

function parametrosPrueba(): { worker: boolean } {
  const q = new URLSearchParams(window.location.search);
  return { worker: !(q.get("pruebas") === "1" && q.get("worker") === "0") };
}

/** «+12,1 m» o «−3,0 m»: el signo siempre se ve. */
export function formatDelta(delta: number): string {
  return `${delta >= 0 ? "+" : "−"}${formatMeters(Math.abs(delta))}`;
}

export function textoGeneracion(generation: number, best: number, previous: number | null): string {
  const base = `Gen ${generation}: mejor ${formatMeters(best)}`;
  return previous === null ? base : `${base} (${formatDelta(best - previous)})`;
}

const LINEAS: { key: keyof Pick<GenerationStats, "best" | "topQuarterMean" | "mean">; nombre: string; color: string }[] = [
  { key: "best", nombre: "Mejor", color: "#ffd23f" },
  { key: "topQuarterMean", nombre: "Top 25 %", color: "#7bd88f" },
  { key: "mean", nombre: "Media", color: "#6ab0ff" },
];

export function Grafica({ history, grande = false }: { history: GenerationStats[]; grande?: boolean }) {
  const W = 320;
  const H = grande ? 200 : 120;
  const L = 44;
  const B = 18;
  if (history.length === 0) {
    return (
      <p className="grafica-vacia" data-testid="grafica-vacia">
        {GRAFICA_VACIA}
      </p>
    );
  }
  const max = Math.max(10, ...history.map((h) => h.best));
  const x = (i: number) => L + (history.length === 1 ? (W - L - 8) / 2 : (i / (history.length - 1)) * (W - L - 8));
  const y = (m: number) => H - B - (m / max) * (H - B - 8);
  return (
    <div className="grafica" data-testid="grafica">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Distancia por generación" data-puntos={history.length}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - 4} y1={y(max * f)} y2={y(max * f)} stroke="rgba(255,255,255,.25)" strokeWidth="1" />
            <text x={L - 4} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="#fff">
              {Math.round(max * f)} m
            </text>
          </g>
        ))}
        <text x={L} y={H - 3} fontSize="11" fill="#fff">
          Gen {history[0].generation}
        </text>
        <text x={W - 4} y={H - 3} textAnchor="end" fontSize="11" fill="#fff">
          Gen {history[history.length - 1].generation}
        </text>
        {LINEAS.map((l) => (
          <g key={l.key}>
            <polyline
              fill="none"
              stroke={l.color}
              strokeWidth="2.5"
              strokeLinejoin="round"
              points={history.map((h, i) => `${x(i).toFixed(1)},${y(h[l.key]).toFixed(1)}`).join(" ")}
            />
            {history.map((h, i) => (
              <circle key={i} cx={x(i)} cy={y(h[l.key])} r={3} fill={l.color} data-testid="punto-grafica" />
            ))}
          </g>
        ))}
      </svg>
      <ul className="leyenda" data-testid="leyenda-grafica">
        {LINEAS.map((l) => (
          <li key={l.key}>
            <span className="muestra" style={{ background: l.color }} aria-hidden="true" />
            {l.nombre}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Evolucion(props: EvolucionProps) {
  const track = getTrack(props.initial.trackId)!;
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(() => !puedeDibujar());
  const [, forzar] = useReducer((n: number) => n + 1, 0);
  const stateRef = useRef(props.initial);
  const latest = useRef(props);
  const pace = useRef<Pace>("x1");
  const pausa = useRef(false);
  const pendiente = useRef<string | null>(null);
  const contador = useRef<HTMLDivElement>(null);
  const relanzar = useRef<() => void>(() => {});
  // El ritmo y la pausa los ejecuta el efecto que posee el ejecutor; los botones los llaman por aquí.
  const ritmoRef = useRef<(p: Pace) => void>(() => {});
  const pausaRef = useRef<(on: boolean) => void>(() => {});
  const [rotulo, setRotulo] = useState<number | null>(null);
  const [generation, setGeneration] = useState(props.initial.generation);
  const [history, setHistory] = useState(props.initial.history);
  const [stagnant, setStagnant] = useState(props.initial.stagnantFor >= ESTANCAMIENTO_AVISO);
  const [progreso, setProgreso] = useState({ finished: 0, total: props.initial.population.length });
  const [campeon, setCampeon] = useState<Campeon | null>(null);
  const [error, setError] = useState(false);
  const [avisoGen, setAvisoGen] = useState<string | null>(null);
  const [avisoRank, setAvisoRank] = useState<string | null>(null);
  const [avisoFav, setAvisoFav] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [rendimiento] = useState(mostrarRendimiento);

  useEffect(() => {
    latest.current = props;
  });
  // La latencia se mide cuando React ya ha aplicado el efecto: justo después de este render.
  useEffect(() => {
    if (pendiente.current) {
      measureOnNextFrame(pendiente.current);
      pendiente.current = null;
    }
  });

  const medir = useCallback((evento: string) => {
    markInput(evento);
    pendiente.current = evento;
    forzar();
  }, []);

  const mostrar = useCallback((poner: (t: string | null) => void, texto: string, ms: number) => {
    poner(texto);
    const t = setTimeout(() => poner(null), ms);
    timers.current.push(t);
  }, []);

  useEffect(() => {
    if (failed) return;
    const prueba = parametrosPrueba();
    const runner: SimRunner = createSimRunner({ worker: prueba.worker });
    let scene: TrackSceneHandle | null = null;
    let cancelled = false;
    let raceId = "";
    let intento = 0;
    let ultimaSim = 0;
    let esperas: { hasta: number; resolver: () => void }[] = [];
    let primera = true;

    const liberar = () => {
      const pendientes = esperas;
      esperas = [];
      pendientes.forEach((e) => e.resolver());
    };
    const pintarContador = (vivos: number) => {
      if (contador.current) contador.current.textContent = `Gen ${stateRef.current.generation} · ${vivos} vivos · ${track.name}`;
    };

    const lanzar = () => {
      if (!scene) return;
      const st = stateRef.current;
      raceId = `gen-${st.generation}-${++intento}`;
      ultimaSim = 0;
      reiniciarRendimiento();
      const total = st.population.length;
      setGeneration(st.generation);
      setProgreso({ finished: 0, total });
      setError(false);
      setStagnant(st.stagnantFor >= ESTANCAMIENTO_AVISO);
      runtime.generacion = st.generation;
      runtime.poblacion = st.population.map((p) => ({ carId: p.id, genome: p.genome }));
      runtime.favoritos = [...st.favorites];
      runtime.pistaEnCarrera = st.trackId;
      runtime.cochesVivos = total;
      runtime.distanciaLider = 0;
      runtime.tiempoSim = 0;
      pintarContador(total);
      const marca = latest.current.rankings[st.trackId][0]?.distance ?? null;
      scene.begin({
        track,
        cars: st.population.map((p) => ({
          carId: p.id,
          genome: p.genome,
          hue: p.hue,
          label: p.generation === 0 ? "✋ tu coche" : undefined,
        })),
        flag: marca,
      });
      scene.setFavorites(st.favorites);
      if (primera) {
        primera = false;
        measureOnNextFrame("evolucionar");
      }
      runner.post({
        type: "startRace",
        raceId,
        cars: st.population.map((p) => ({ carId: p.id, genome: p.genome })),
        trackId: st.trackId,
        pace: pace.current,
      });
      if (pausa.current) runner.post({ type: "pause", raceId });
    };
    relanzar.current = lanzar;

    const alTerminar = async (results: CarResult[]) => {
      const st = stateRef.current;
      const valido = results.filter((r) => r.reason !== "anomaly");
      const mejor = valido.length > 0 ? valido.reduce((a, b) => (b.distance > a.distance ? b : a)) : null;
      const previo = st.history.length > 0 ? st.history[st.history.length - 1].best : null;
      let siguiente: ReturnType<typeof nextGeneration>;
      try {
        siguiente = nextGeneration(st, results);
      } catch {
        setError(true);
        liberar();
        return;
      }
      const individuo = mejor ? st.population.find((p) => p.id === mejor.carId) : undefined;
      const nuevoCampeon: Campeon | null = mejor && individuo ? { individual: individuo, result: mejor, generation: st.generation } : null;
      // La población que se pinta y la que se guarda es la que devuelve nextGeneration, sin copias.
      stateRef.current = siguiente.state;
      runtime.distanciasGeneracion = Object.fromEntries(results.map((r) => [r.carId, r.distance]));
      runtime.cochesVivos = 0;
      setHistory(siguiente.state.history);
      setCampeon(nuevoCampeon);
      const stats = siguiente.state.history[siguiente.state.history.length - 1];
      if (stats) mostrar(setAvisoGen, textoGeneracion(st.generation, stats.best, previo), AVISO_MS);
      const outcome = await latest.current.onGeneracion(siguiente.state, siguiente.lineageAdded, nuevoCampeon);
      if (cancelled) return;
      if (outcome && nuevoCampeon) {
        const texto = avisoRanking(outcome, track.name, nuevoCampeon.result.distance);
        if (texto) mostrar(setAvisoRank, texto, AVISO_RANKING_MS);
      }
      lanzar();
      liberar();
    };

    let aviso = SIN_AVISO;
    const medirRitmo = (ritmoReal: number | undefined) => {
      const nuevo = actualizarAviso(aviso, pace.current, ritmoReal, performance.now());
      if (nuevo.rotulo !== aviso.rotulo) setRotulo(nuevo.rotulo);
      aviso = nuevo;
      if (ritmoReal !== undefined) runtime.ritmoReal = ritmoReal;
    };

    const alMensaje = (m: FromWorker) => {
      if (m.raceId !== raceId || !scene) return;
      if (m.type === "poses") {
        medirRitmo(m.ritmoReal);
        const lider = m.poses.reduce((a, p) => Math.max(a, p.x), 0);
        scene.setPoses(m.simTime, m.poses, m.simTime - ultimaSim > 0.5);
        ultimaSim = m.simTime;
        const vivos = m.poses.filter((p) => !p.finished).length;
        runtime.tiempoSim = m.simTime;
        runtime.distanciaLider = lider;
        runtime.cochesVivos = vivos;
        registrarPoses(m.simTime, vivos);
        pintarContador(vivos);
        esperas = esperas.filter((e) => (m.simTime >= e.hasta ? (e.resolver(), false) : true));
      } else if (m.type === "carFinished") {
        scene.carFinished(m.result);
      } else if (m.type === "progress") {
        setProgreso({ finished: m.finished, total: m.total });
      } else if (m.type === "raceDone") {
        raceId = "";
        void alTerminar(m.results);
      } else if (m.type === "error") {
        setError(true);
        liberar();
      }
    };

    const unsubscribe = runner.subscribe(alMensaje);
    runtime.ejecutor = runner.kind;
    runtime.ritmo = pace.current;
    runtime.aplicarLimite = (max) => runner.post({ type: "limitRate", max });
    if (runtime.limiteRitmo !== null) runner.post({ type: "limitRate", max: runtime.limiteRitmo });
    runtime.avanzar = (segundos) =>
      new Promise<void>((resolver) => {
        if (!scene || !raceId) return resolver();
        esperas.push({ hasta: ultimaSim + segundos - 1e-6, resolver });
        runner.post({ type: "advance", raceId, seconds: segundos });
      }).then(() => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))));

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "hidden") runner.post({ type: "pause", raceId });
      else if (!pausa.current) runner.post({ type: "resume", raceId });
    };
    document.addEventListener("visibilitychange", alCambiarVisibilidad);

    const cambiarRitmo = (p: Pace) => {
      aviso = SIN_AVISO;
      setRotulo(null);
      runtime.ritmo = p;
      runner.post({ type: "setPace", raceId, pace: p });
    };
    const alternarPausa = (on: boolean) => {
      runtime.pausada = on;
      runner.post({ type: on ? "pause" : "resume", raceId });
    };
    ritmoRef.current = cambiarRitmo;
    pausaRef.current = alternarPausa;

    import("@/game/track-scene")
      .then(({ startTrackScene }) => {
        if (cancelled || !host.current) return;
        scene = startTrackScene(host.current, track, { alSinLienzo: () => setFailed(true) });
        scene.onPick((carId) => {
          markInput("favorito");
          const antes = stateRef.current;
          const ya = antes.favorites.includes(carId);
          stateRef.current = setFavorite(antes, carId, !ya);
          scene?.setFavorites(stateRef.current.favorites);
          runtime.favoritos = [...stateRef.current.favorites];
          mostrar(setAvisoFav, ya ? "Favorito quitado" : AVISO_FAVORITO, AVISO_MS);
          pendiente.current = "favorito";
          forzar();
        });
        lanzar();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      runner.post({ type: "stop", raceId });
      unsubscribe();
      runner.terminate();
      scene?.destroy();
      liberar();
      relanzar.current = () => {};
      ritmoRef.current = () => {};
      pausaRef.current = () => {};
      runtime.avanzar = null;
      runtime.aplicarLimite = null;
      runtime.ritmo = null;
      runtime.ritmoReal = null;
      runtime.pausada = false;
      runtime.pistaEnCarrera = null;
      runtime.distanciaLider = null;
      runtime.cochesVivos = 0;
      runtime.tiempoSim = null;
      runtime.ejecutor = null;
      runtime.generacion = null;
      runtime.poblacion = null;
      runtime.favoritos = null;
      runtime.distanciasGeneracion = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la carrera se monta una vez; lo demás va por refs
  }, [failed]);

  const [paceVista, setPaceVista] = useState<Pace>("x1");
  const [pausada, setPausada] = useState(false);
  const elegirRitmo = (p: Pace) => {
    pace.current = p;
    ritmoRef.current(p);
    setPaceVista(p);
    medir("ritmo");
  };
  const alternar = () => {
    pausa.current = !pausa.current;
    pausaRef.current(pausa.current);
    setPausada(pausa.current);
    medir("pausar");
  };
  // El aviso ya está en pantalla cuando este efecto corre; sin marca previa no hace nada.
  useEffect(() => {
    if (toast) measureOnNextFrame("guardar-nombre");
  }, [toast]);
  const guardarCampeon = async () => {
    if (!campeon) return;
    markInput("hoja-nombre");
    const texto = await latest.current.onGuardarCampeon(campeon);
    if (texto) mostrar(setToast, texto, AVISO_MS);
  };

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

  const mejorMarca = history.length > 0 ? Math.max(...history.map((h) => h.best)) : null;
  const turbo = paceVista === "turbo";

  return (
    <div className="evolucion" data-testid="evolucion">
      <div className="evolucion-pista">
        <div className="lienzo" ref={host} data-testid="lienzo" />
        <div className="cabecera">
          <button type="button" className="pastilla" onClick={props.onBack} data-testid="volver">
            ← Volver
          </button>
          <div className="nombre-pista" data-testid="nombre-pista">
            {track.name}
          </div>
        </div>
        <div className="hud-distancia contador-gen" ref={contador} data-testid="contador" aria-live="off" />
        {turbo && (
          <div className="turbo-panel" data-testid="turbo-panel">
            <p className="barra-texto" data-testid="barra-progreso-texto">
              Gen {generation} · {progreso.finished}/{progreso.total} coches
            </p>
            <progress max={progreso.total} value={progreso.finished} data-testid="barra-progreso" />
            <Grafica history={history} grande />
          </div>
        )}
        {rendimiento && <PanelRendimiento />}
        <div className="avisos-evolucion">
        {avisoGen && (
          <div className="aviso-arriba" role="status" data-testid="aviso-generacion">
            {avisoGen}
          </div>
        )}
        {avisoRank && (
          <div className="aviso-arriba segundo" role="status" data-testid="aviso-ranking">
            {avisoRank}
          </div>
        )}
        {avisoFav && (
          <div className="aviso-arriba tercero" role="status" data-testid="aviso-favorito">
            {avisoFav}
          </div>
        )}
        </div>
        {stagnant && (
          <p className="aviso-ruedas" role="status" data-testid="aviso-estancada">
            {AVISO_ESTANCADA}
          </p>
        )}
        {toast && (
          <div className="aviso-arriba segundo" role="status" data-testid="aviso-guardado">
            {toast}
          </div>
        )}
        {error && (
          <div className="tarjeta-fin error" role="alert" data-testid="error-simulacion">
            <p>{MENSAJE_ERROR_EVOLUCION}</p>
            <div className="acciones">
              <button type="button" className="pastilla" onClick={() => relanzar.current()} data-testid="reintentar">
                Reintentar
              </button>
              <button type="button" className="pastilla" onClick={props.onBack}>
                Volver
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="evolucion-panel">
        <div className="fila">
          <span data-testid="mejor-marca">{mejorMarca === null ? "Mejor: —" : `Mejor: ${formatMeters(mejorMarca)}`}</span>
          <span className="ayuda-chica">Toca un coche para marcarlo como favorito</span>
        </div>
        <ControlRitmo prefijo="evo-ritmo" activo={paceVista} onElegir={elegirRitmo} ritmoReal={rotulo} etiquetaFinal="Turbo" />
        <div className="fila">
          <button type="button" className="pastilla chica" data-testid="pausar" onClick={alternar}>
            {pausada ? "Seguir" : "Pausar"}
          </button>
          <button type="button" className="pastilla chica" disabled={!campeon} data-testid="guardar-campeon" onClick={guardarCampeon}>
            Guardar campeón
          </button>
        </div>
        {!turbo && <Grafica history={history} />}
      </div>
    </div>
  );
}
