"use client";

import { useEffect, useRef, useState } from "react";
import { formatMeters } from "@/app/format";
import { markInput, measureOnNextFrame } from "@/debug/latencias";
import { getTrack, TRACKS, type TrackId } from "@/sim/tracks";
import { RANKING_SIZE, type RankingEntry, type Rankings as RankingsData } from "@/storage/schema";
import { Silueta } from "./Garaje";

export function textoVacio(pista: string): string {
  return `Nadie ha corrido aún en ${pista}. Prueba un coche del Taller o evoluciona uno en esta pista.`;
}

/** Nombre del garaje si lo tiene; si no, «Coche» y 4 caracteres de su hash. */
export function nombreDe(e: Pick<RankingEntry, "name" | "genomeHash">): string {
  return e.name ?? `Coche ${e.genomeHash.slice(0, 4)}`;
}

/** Tono estable por coche, para que su silueta sea reconocible entre pestañas. */
export function tonoDe(hash: string): number {
  return parseInt(hash.slice(0, 6), 16) % 360;
}

export function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

export interface RankingsProps {
  rankings: RankingsData;
  initialTrack: TrackId;
  onBack: () => void;
  onWatch: (entry: RankingEntry) => void;
  onOpenInWorkshop: (entry: RankingEntry) => void;
  /** Devuelve el texto del aviso que debe leerse tras guardar. */
  onSaveToGarage: (entry: RankingEntry) => Promise<string>;
  onTaller: () => void;
}

export function Rankings(props: RankingsProps) {
  const { rankings } = props;
  const [trackId, setTrackId] = useState<TrackId>(props.initialTrack);
  const [fila, setFila] = useState<RankingEntry | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const track = getTrack(trackId)!;
  const lista = rankings[trackId];

  // Al abrir la pantalla y al cambiar de pestaña: el efecto ya está aplicado, mide hasta el siguiente frame.
  useEffect(() => {
    measureOnNextFrame("abrir-ranking");
  }, [trackId]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const guardar = async (entry: RankingEntry) => {
    const texto = await props.onSaveToGarage(entry);
    setToast(texto);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  };

  return (
    <div className="rankings" data-testid="rankings">
      <div className="rankings-cabecera">
        <button type="button" className="pastilla" onClick={props.onBack} data-testid="volver">
          ← Volver
        </button>
        <h2>Rankings</h2>
      </div>
      <div className="pestanas" role="tablist" aria-label="Pista">
        {TRACKS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === trackId}
            className="pestana"
            data-testid={`pestana-${t.id}`}
            onClick={() => {
              markInput("abrir-ranking");
              setTrackId(t.id);
              setFila(null);
            }}
          >
            {t.name.replace(/^(La|Las|El|Los) /, "")}
          </button>
        ))}
      </div>
      <p className="lema-ranking">
        {track.name} — {track.tagline}
      </p>
      {lista.length === 0 ? (
        <div className="ranking-vacio" data-testid="ranking-vacio">
          <p>{textoVacio(track.name)}</p>
          <div className="acciones">
            <button type="button" className="pastilla principal" onClick={props.onTaller} data-testid="vacio-taller">
              Taller
            </button>
            <button type="button" className="pastilla" disabled data-testid="vacio-evolucion">
              Evolución · Pronto
            </button>
          </div>
        </div>
      ) : (
        <ol className="ranking-lista" data-testid="ranking-lista">
          {lista.slice(0, RANKING_SIZE).map((e, i) => (
            <li key={e.genomeHash}>
              <button
                type="button"
                className="fila-ranking"
                data-testid="fila-ranking"
                data-carid={e.carId}
                aria-pressed={fila?.genomeHash === e.genomeHash}
                onClick={() => setFila(e)}
              >
                <span className="puesto" data-testid="fila-puesto">
                  {i + 1}
                </span>
                <Silueta genome={e.genome} hue={tonoDe(e.genomeHash)} />
                <span className="nombre-fila">{nombreDe(e)}</span>
                <span className="distancia" data-testid="fila-distancia">
                  {formatMeters(e.distance)}
                </span>
                <span className="etiqueta" data-testid="fila-origen">
                  {e.origin}
                </span>
                <span className="fecha">{fechaCorta(e.date)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {fila && (
        <div className="hoja-fila" role="dialog" aria-label="Detalle de la fila" data-testid="hoja-fila">
          <h3 data-testid="hoja-titulo">
            Puesto {lista.findIndex((e) => e.genomeHash === fila.genomeHash) + 1} · {track.name}
          </h3>
          <p>
            <strong data-testid="hoja-distancia">{formatMeters(fila.distance)}</strong> ·{" "}
            <span data-testid="hoja-origen">{fila.origin}</span> · {nombreDe(fila)}
          </p>
          <div className="acciones">
            <button type="button" className="pastilla principal" onClick={() => props.onWatch(fila)} data-testid="ver-correr">
              Ver correr
            </button>
            <button type="button" className="pastilla" onClick={() => props.onOpenInWorkshop(fila)} data-testid="abrir-taller">
              Abrir en el taller
            </button>
            <button type="button" className="pastilla" onClick={() => void guardar(fila)} data-testid="guardar-garaje">
              Guardar en el garaje
            </button>
            <button type="button" className="pastilla" onClick={() => setFila(null)} data-testid="cerrar-hoja">
              Cerrar
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div className="aviso-arriba" role="status" data-testid="aviso-guardado">
          {toast}
        </div>
      )}
    </div>
  );
}
