"use client";

import { useEffect, useRef, useState } from "react";
import { formatMeters } from "@/app/format";
import { runtime } from "@/debug/ganchos";
import { markInput, measureOnNextFrame } from "@/debug/latencias";
import {
  BATCH_SIZE,
  CELL_COUNT,
  GRID_COLUMNS,
  LENGTH_EDGES,
  discovered,
  emptyArchive,
  integrateBatch,
  planBatch,
  type BatchCar,
  type SpeciesArchive,
  type SpeciesCell,
} from "@/evolution/species";
import type { CarResult } from "@/sim/constants";
import { getTrack, type TrackId } from "@/sim/tracks";
import { createSimRunner } from "@/worker";
import type { FromWorker, SimRunner } from "@/worker/protocol";
import { Silueta } from "./Garaje";
import { nuevaSemilla } from "./InicioEvolucion";
import type { RankingsView } from "./TrackPicker";
import { TrackPicker } from "./TrackPicker";

export const AYUDA_ESPECIES =
  "Cada casilla es una especie de coche: por número de ruedas y por largo. Explora para descubrir la mejor de cada una en esta pista.";
export const MENSAJE_ERROR_ESPECIES = "La simulación se ha detenido por un error. Toca Reintentar para volver a lanzar este lote.";

const COLUMNAS = ["< 1,5 m", "1,5–2,5 m", "2,5–3,5 m", "> 3,5 m"];
const FILAS = ["1 rueda", "2 ruedas", "3 ruedas", "4 ruedas"];

export function textoContador(archive: SpeciesArchive | undefined, pista: string): string {
  return `Lote ${archive?.batch ?? 0} · ${archive ? discovered(archive) : 0}/${CELL_COUNT} especies descubiertas en ${pista}`;
}

/** Descripción de la especie de una casilla: «2 ruedas · 1,5–2,5 m». */
export function nombreEspecie(index: number): string {
  return `${FILAS[Math.floor(index / GRID_COLUMNS)]} · ${COLUMNAS[index % GRID_COLUMNS]}`;
}

/** De verde oscuro (la peor marca descubierta) a dorado (la mejor): se lee de un vistazo sin depender del número. */
function colorPorDistancia(distance: number, min: number, max: number): string {
  const t = max > min ? (distance - min) / (max - min) : 1;
  return `hsl(${Math.round(130 - 85 * t)} 45% ${Math.round(24 + 14 * t)}%)`;
}

function parametrosPrueba(): { worker: boolean } {
  const q = new URLSearchParams(window.location.search);
  return { worker: !(q.get("pruebas") === "1" && q.get("worker") === "0") };
}

export interface EspeciesProps {
  trackId: TrackId;
  onTrack: (id: TrackId) => void;
  rankings: RankingsView;
  archive: SpeciesArchive | undefined;
  /** Guarda el archivo de su pista tras cada lote. */
  onArchive: (archive: SpeciesArchive) => Promise<void>;
  onWatch: (cell: SpeciesCell, trackId: TrackId) => void;
  onOpenInWorkshop: (cell: SpeciesCell, trackId: TrackId) => void;
  /** Devuelve el texto del aviso. */
  onSaveToGarage: (cell: SpeciesCell, index: number, trackId: TrackId) => Promise<string>;
  onEvolve: (cell: SpeciesCell, trackId: TrackId) => void;
  onBack: () => void;
}

interface EnCurso {
  raceId: string;
  trackId: TrackId;
  total: number;
  finished: number;
}

export function Especies(props: EspeciesProps) {
  const { trackId, archive } = props;
  const track = getTrack(trackId)!;
  const [enCurso, setEnCurso] = useState<EnCurso | null>(null);
  const [error, setError] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [novedades, setNovedades] = useState<number[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const latest = useRef(props);
  const runner = useRef<SimRunner | null>(null);
  const limpiar = useRef<() => void>(() => {});
  const lote = useRef(0);
  const midiendo = enCurso !== null;

  useEffect(() => {
    latest.current = props;
  });
  // La latencia se mide cuando el estado «explorando» ya está pintado.
  useEffect(() => {
    if (midiendo) measureOnNextFrame("explorar-especies");
  }, [midiendo]);
  useEffect(
    () => () => {
      limpiar.current();
      runner.current?.terminate();
      runner.current = null;
      runtime.avanzar = null;
    },
    [],
  );

  const terminar = () => {
    limpiar.current();
    limpiar.current = () => {};
    runner.current?.terminate();
    runner.current = null;
    runtime.avanzar = null;
  };

  const explorar = () => {
    if (runner.current) return;
    markInput("explorar-especies");
    setError(false);
    setAbierta(null);
    const base = latest.current.archive ?? emptyArchive(latest.current.trackId, nuevaSemilla());
    const plan = planBatch(base);
    const cars: BatchCar[] = plan.cars;
    const raceId = `especies-${base.trackId}-${base.batch + 1}-${++lote.current}`;
    const r = createSimRunner({ worker: parametrosPrueba().worker });
    runner.current = r;
    let simActual = 0;
    let esperas: { hasta: number; resolver: () => void }[] = [];
    const liberar = () => {
      const pendientes = esperas;
      esperas = [];
      pendientes.forEach((e) => e.resolver());
    };
    const alMensaje = (m: FromWorker) => {
      if (m.raceId !== raceId) return;
      if (m.type === "poses") {
        simActual = m.simTime;
        esperas = esperas.filter((e) => (m.simTime >= e.hasta ? (e.resolver(), false) : true));
      } else if (m.type === "progress") {
        setEnCurso((c) => (c ? { ...c, finished: m.finished } : c));
      } else if (m.type === "raceDone") {
        const results: CarResult[] = m.results;
        void (async () => {
          let siguiente: SpeciesArchive;
          try {
            siguiente = integrateBatch(plan.archive, cars, results);
          } catch {
            terminar();
            setEnCurso(null);
            setError(true);
            liberar();
            return;
          }
          const cambiadas = siguiente.cells.flatMap((c, i) => (c !== null && c !== base.cells[i] ? [i] : []));
          await latest.current.onArchive(siguiente);
          terminar();
          setEnCurso(null);
          setNovedades(cambiadas);
          setAviso(
            cambiadas.length === 0
              ? "Ninguna especie ha mejorado en este lote"
              : `${cambiadas.length} ${cambiadas.length === 1 ? "especie nueva o mejorada" : "especies nuevas o mejoradas"}`,
          );
          liberar();
        })();
      } else if (m.type === "error") {
        terminar();
        setEnCurso(null);
        setError(true);
        liberar();
      }
    };
    limpiar.current = r.subscribe(alMensaje);
    runtime.ejecutor = r.kind;
    runtime.avanzar = (segundos) =>
      new Promise<void>((resolver) => {
        if (!runner.current) return resolver();
        esperas.push({ hasta: simActual + segundos - 1e-6, resolver });
        r.post({ type: "advance", raceId, seconds: segundos });
      }).then(() => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))));
    setEnCurso({ raceId, trackId: base.trackId, total: cars.length || BATCH_SIZE, finished: 0 });
    r.post({ type: "startRace", raceId, cars, trackId: base.trackId, pace: "turbo" });
  };

  // Un aviso visible dura un momento y se va solo.
  useEffect(() => {
    if (aviso === null) return;
    const t = setTimeout(() => setAviso(null), 2500);
    return () => clearTimeout(t);
  }, [aviso]);

  useEffect(() => {
    const alCambiar = () => {
      if (!runner.current || !enCurso) return;
      runner.current.post({ type: document.visibilityState === "hidden" ? "pause" : "resume", raceId: enCurso.raceId });
    };
    document.addEventListener("visibilitychange", alCambiar);
    return () => document.removeEventListener("visibilitychange", alCambiar);
  }, [enCurso]);

  const llenas = (archive?.cells ?? []).flatMap((c) => (c ? [c.distance] : []));
  const min = Math.min(...llenas);
  const max = Math.max(...llenas);
  const celda = abierta !== null ? (archive?.cells[abierta] ?? null) : null;

  return (
    <div className="especies" data-testid="especies">
      <div className="garaje-cabecera">
        <button type="button" className="pastilla" onClick={props.onBack} data-testid="volver">
          ← Volver
        </button>
        <h2>Especies</h2>
        <TrackPicker value={trackId} onChange={props.onTrack} rankings={props.rankings} />
      </div>
      <p className="ayuda-especies" data-testid="ayuda-especies">
        {AYUDA_ESPECIES}
      </p>
      <p className="contador-especies" role="status" data-testid="contador-especies">
        {textoContador(archive, track.name)}
      </p>
      <div className="rejilla-especies" role="group" aria-label={`Especies de ${track.name}`} data-testid="rejilla-especies">
        {Array.from({ length: CELL_COUNT }, (_, i) => {
          const c = archive?.cells[i] ?? null;
          return (
            <button
              key={i}
              type="button"
              className={`celda-especie${c ? " llena" : ""}${novedades.includes(i) ? " nueva" : ""}`}
              style={c ? { background: colorPorDistancia(c.distance, min, max) } : undefined}
              aria-label={c ? `${nombreEspecie(i)}: ${formatMeters(c.distance)}` : `${nombreEspecie(i)}: sin descubrir`}
              data-abierta={abierta === i ? "1" : "0"}
              disabled={!c}
              data-testid={`celda-${i}`}
              data-llena={c ? "1" : "0"}
              onClick={() => setAbierta(i)}
            >
              {c ? (
                <>
                  <Silueta genome={c.genome} />
                  <span className="metros" data-testid="celda-metros">
                    {formatMeters(c.distance)}
                  </span>
                </>
              ) : (
                <span className="vacia" aria-hidden="true">
                  ?
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="leyenda-especies">
        Filas: ruedas activas. Columnas: largo de la carrocería ({LENGTH_EDGES.map((e) => formatMeters(e)).join(" · ")}).
      </p>
      <div className="acciones-especies">
        <button type="button" className="pastilla principal grande" disabled={midiendo} onClick={explorar} data-testid="explorar-especies">
          {midiendo ? "Explorando…" : "Explorar"}
        </button>
        {enCurso && (
          <span className="progreso-medicion" role="status" data-testid="progreso-especies">
            Lote {(archive?.batch ?? 0) + 1}: {enCurso.finished}/{enCurso.total} coches
          </span>
        )}
      </div>
      {error && (
        <p className="error-especies" role="alert" data-testid="error-especies">
          {MENSAJE_ERROR_ESPECIES}{" "}
          <button type="button" className="pastilla chica" onClick={explorar} data-testid="reintentar-especies">
            Reintentar
          </button>
        </p>
      )}
      {aviso && (
        <div className="aviso-arriba" role="status" data-testid="aviso-especies">
          {aviso}
        </div>
      )}
      {celda && abierta !== null && (
        <div className="hoja-fila" data-testid="hoja-especie">
          <h3>{nombreEspecie(abierta)}</h3>
          <p>
            {formatMeters(celda.distance)} en {track.name}
          </p>
          <div className="acciones">
            <button type="button" className="pastilla chica" onClick={() => props.onWatch(celda, trackId)} data-testid="especie-ver">
              Ver correr
            </button>
            <button type="button" className="pastilla chica" onClick={() => props.onOpenInWorkshop(celda, trackId)} data-testid="especie-taller">
              Abrir en el taller
            </button>
            <button
              type="button"
              className="pastilla chica"
              onClick={async () => setAviso(await props.onSaveToGarage(celda, abierta, trackId))}
              data-testid="especie-guardar"
            >
              Guardar en el garaje
            </button>
            <button type="button" className="pastilla chica" onClick={() => props.onEvolve(celda, trackId)} data-testid="especie-evolucionar">
              Evolucionar desde aquí
            </button>
            <button type="button" className="pastilla chica" onClick={() => setAbierta(null)} data-testid="especie-cerrar">
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
