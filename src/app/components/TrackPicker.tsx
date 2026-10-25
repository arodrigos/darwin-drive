"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trackProfile } from "@/sim/terrain";
import { TRACKS, type Track, type TrackId } from "@/sim/tracks";
import { formatMeters } from "@/app/format";
import { markInput, measureOnNextFrame } from "@/debug/latencias";

// El selector solo necesita la marca de cada entrada; RankingEntry (bloque de guardado) lo cumple.
export type RankingsView = Record<TrackId, { distance: number; origin?: string }[]>;

export function topMark(rankings: RankingsView, id: TrackId, withOrigin = false): string {
  const first = rankings[id][0];
  if (!first) return "sin marcas todavía";
  return `n.º 1: ${formatMeters(first.distance)}${withOrigin && first.origin ? ` · ${first.origin}` : ""}`;
}

export function TrackMiniature({ track }: { track: Track }) {
  const W = 120;
  const H = 34;
  const ys = trackProfile(track, 600, 60);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = Math.max(1, max - min);
  const pts = ys.map((y, i) => `${((i / (ys.length - 1)) * W).toFixed(1)},${(H - 3 - ((y - min) / span) * (H - 6)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" data-testid={`miniatura-${track.id}`}>
      <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill="rgba(255,255,255,.18)" />
      <polyline points={pts.join(" ")} fill="none" stroke="#ffd23f" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

export function TrackPicker(props: { value: TrackId; onChange: (id: TrackId) => void; rankings: RankingsView; comoSelector?: boolean }) {
  const { value, onChange, rankings, comoSelector = false } = props;
  const [open, setOpen] = useState(false);
  const activa = useRef<HTMLButtonElement | null>(null);
  const current = TRACKS.find((t) => t.id === value) ?? TRACKS[0];

  useEffect(() => {
    if (open) measureOnNextFrame("abrir-pista");
  }, [open]);

  // Con nueve pistas la elegida puede quedar fuera de la vista del carrusel.
  useEffect(() => {
    if (open) activa.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={comoSelector ? "selector selector-pista" : "pastilla"}
        data-testid="selector-pista"
        onClick={() => {
          markInput("abrir-pista");
          setOpen(true);
        }}
      >
        Pista: {current.name} ▾
      </button>
      {open &&
        createPortal(
        <div className="hoja-fondo" onClick={() => setOpen(false)} data-testid="hoja-pistas">
          <div className="hoja hoja-pistas" role="dialog" aria-label="Elegir pista" onClick={(e) => e.stopPropagation()}>
            <h2>Elegir pista</h2>
            <div className="carrusel" data-testid="carrusel-pistas">
            {TRACKS.map((t) => (
              <button
                key={t.id}
                ref={t.id === value ? activa : undefined}
                type="button"
                className="tarjeta-pista"
                aria-current={t.id === value}
                data-testid={`pista-${t.id}`}
                onClick={() => {
                  markInput("elegir-pista");
                  onChange(t.id);
                  setOpen(false);
                  measureOnNextFrame("elegir-pista");
                }}
              >
                <span className="nombre">{t.name}</span>
                <span className="lema">{t.tagline}</span>
                <TrackMiniature track={t} />
                <span className="marca">{topMark(rankings, t.id)}</span>
              </button>
            ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
