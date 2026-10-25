"use client";

import { MuestraColor } from "./MuestraColor";
import { textoCausa } from "../ayuda/causas";
import { useEffect, useRef, useState } from "react";
import { formatMeters } from "@/app/format";
import { markInput, measureOnNextFrame } from "@/debug/latencias";
import { PHYSICS_VERSION } from "@/sim/constants";
import { claveTexto, formatTiempo } from "@/sim/clasificacion";
import { getTrack, TRACKS, type TrackId } from "@/sim/tracks";
import { entradaPendiente, RANKING_SIZE, type RankingEntry, type Rankings as RankingsData } from "@/storage/schema";
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

/** «Entero» o «Roto · N piezas»: lo que le pasó al coche hasta su marca. */
export function textoEstado(e: Pick<RankingEntry, "piezasPerdidas">): string {
  const n = e.piezasPerdidas ?? 0;
  return n === 0 ? "Entero" : `Roto · ${n} ${n === 1 ? "pieza" : "piezas"}`;
}

const ROTULO_INSIGNIA = { entera: "entera", rapida: "+ rápida", llegada: "antes en la tabla" } as const;

/** La insignia de la fila de arriba cuando la siguiente tiene la misma distancia visible, y su explicación. */
export function insigniaDe(e: RankingEntry, siguiente: RankingEntry | undefined): { rotulo: string; explicacion: string } | null {
  if (!siguiente || entradaPendiente(e) || entradaPendiente(siguiente)) return null;
  const clave = claveTexto(e, siguiente);
  if (!clave) return null;
  const explicacion =
    clave === "entera"
      ? "Misma distancia: este coche llegó entero y el siguiente roto"
      : clave === "rapida"
        ? `Misma distancia: llegó ${formatTiempo((siguiente.bestStep ?? 0) - (e.bestStep ?? 0))} antes`
        : `Misma distancia y tiempo: entró antes en la tabla (${fechaCorta(e.date)})`;
  return { rotulo: ROTULO_INSIGNIA[clave], explicacion };
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
  onEvolucion: () => void;
  /** Migración de marcas: lo pendiente de esta pista se rotula según siga en curso o se haya dado por perdido. */
  migracion?: { enCurso: boolean; conservados: string[] };
}

/** Marca sin la versión de pista y de física actuales: la migración la tiene que volver a medir. */
const noVigente = (e: RankingEntry, track: { version: number }): boolean => e.trackVersion !== track.version || e.physicsVersion !== PHYSICS_VERSION;

export function Rankings(props: RankingsProps) {
  const { rankings } = props;
  const [trackId, setTrackId] = useState<TrackId>(props.initialTrack);
  const [fila, setFila] = useState<RankingEntry | null>(null);
  const [insignia, setInsignia] = useState<string | null>(null);
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
            <button type="button" className="pastilla" onClick={props.onEvolucion} data-testid="vacio-evolucion">
              Evolución
            </button>
          </div>
        </div>
      ) : (
        <>
          {props.migracion?.enCurso && lista.some((e) => noVigente(e, track)) && (
            <p className="nota-migracion" data-testid="nota-migracion">
              Algunas marcas se están volviendo a medir con la versión nueva; el orden puede cambiar al acabar.
            </p>
          )}
        <div className="ranking-titulos" aria-hidden="true">
          <span className="titulo-distancia">Distancia</span>
          <span className="titulo-marca" data-testid="titulo-tiempo">Tiempo</span>
          <span className="titulo-marca" data-testid="titulo-estado">Estado</span>
          <span className="titulo-marca" data-testid="titulo-fecha">Fecha</span>
        </div>
        <ol className="ranking-lista" data-testid="ranking-lista">
          {lista.slice(0, RANKING_SIZE).map((e, i, todas) => {
            const marca = insigniaDe(e, todas[i + 1]);
            return (
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
                  <Silueta genome={e.genome} hue={tonoDe(e.genomeHash)} color={e.color} />
                  <span className="nombre-fila" data-testid="fila-nombre">
                    {e.color && <MuestraColor color={e.color} />}
                    {nombreDe(e)}
                  </span>
                  <span className="distancia" data-testid="fila-distancia">
                    {formatMeters(e.distance)}
                  </span>
                  <span className="datos-marca">
                    <span className="celda-marca" data-testid="fila-tiempo">
                      {e.bestStep === undefined ? "—" : formatTiempo(e.bestStep)}
                    </span>
                    <span className="celda-marca" data-testid="fila-estado">
                      {noVigente(e, track) || entradaPendiente(e) ? (
                        <span className="rotulo-migracion" data-testid="fila-migracion">
                          {props.migracion?.conservados.includes(`ranking/${trackId}/${e.carId}`)
                            ? "no se pudo volver a medir"
                            : props.migracion?.enCurso
                              ? "actualizando…"
                              : "marca de una versión anterior"}
                        </span>
                      ) : (
                        textoEstado(e)
                      )}
                    </span>
                    <span className="celda-marca fecha" data-testid="fila-fecha">
                      {fechaCorta(e.date)}
                    </span>
                  </span>
                </button>
                {marca && (
                  <>
                    <button
                      type="button"
                      className="insignia"
                      data-testid="fila-insignia"
                      aria-expanded={insignia === e.genomeHash}
                      onClick={() => setInsignia(insignia === e.genomeHash ? null : e.genomeHash)}
                    >
                      {marca.rotulo}
                    </button>
                    {insignia === e.genomeHash && (
                      <p className="insignia-explica" role="status" data-testid="insignia-explicacion">
                        {marca.explicacion}
                      </p>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
        </>
      )}
      {fila && (
        <div className="hoja-fila" role="dialog" aria-label="Detalle de la fila" data-testid="hoja-fila">
          <h3 data-testid="hoja-titulo">
            Puesto {lista.findIndex((e) => e.genomeHash === fila.genomeHash) + 1} · {track.name}
          </h3>
          <p>
            <strong data-testid="hoja-distancia">{formatMeters(fila.distance)}</strong> ·{" "}
            <span data-testid="hoja-origen">{fila.origin}</span> · {nombreDe(fila)}
            {fila.bestStep !== undefined && (
              <>
                {" "}
                · <span data-testid="hoja-tiempo">{formatTiempo(fila.bestStep)}</span> · {textoEstado(fila)}
              </>
            )}
          </p>
          {fila.causaParada && (
            <p data-testid="hoja-causa">Se paró: {textoCausa(fila.causaParada, fila.pendienteParada)}</p>
          )}
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
