"use client";

import { createNoise2D } from "simplex-noise";
import { TRACKS, type TrackId } from "@/sim/tracks";
import { TrackMiniature, topMark, type RankingsView } from "./TrackPicker";

const noise = createNoise2D(() => 0.62);

// Paisaje de fondo: dos cordilleras pintadas con SVG, sin activos externos.
function Paisaje() {
  const layer = (seed: number, base: number, amp: number, colour: string) => {
    const pts: string[] = ["0,100"];
    for (let i = 0; i <= 60; i++) pts.push(`${(i / 60) * 100},${base - ((noise(i / 9, seed) + 1) / 2) * amp}`);
    pts.push("100,100");
    return <polygon points={pts.join(" ")} fill={colour} />;
  };
  return (
    <svg className="paisaje" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-testid="paisaje">
      {layer(1, 70, 45, "#8aa0bd")}
      {layer(2, 88, 35, "#4f7a58")}
      {layer(3, 100, 20, "#35603f")}
    </svg>
  );
}

const ACCESOS = ["Taller", "Evolución", "Garaje", "Linaje", "Especies"];

export function Portada(props: { rankings: RankingsView; onExplore: () => void; onStock: () => void; onPickTrack: (id: TrackId) => void }) {
  return (
    <div className="portada" data-testid="portada">
      <Paisaje />
      <h1 className="titulo">Darwin Drive</h1>
      <p className="subtitulo">Diseña un coche, elige pista y mira hasta dónde llega.</p>
      <div className="pistas">
        {TRACKS.map((t) => (
          <button key={t.id} type="button" className="tarjeta-pista" data-testid={`tarjeta-${t.id}`} onClick={() => props.onPickTrack(t.id)}>
            <span className="nombre">{t.name}</span>
            <TrackMiniature track={t} />
            <span className="marca">{topMark(props.rankings, t.id)}</span>
          </button>
        ))}
      </div>
      <div className="accesos">
        <button type="button" className="acceso" data-testid="acceso-explorar" onClick={props.onExplore}>
          Explorar pista
        </button>
        <button type="button" className="acceso" data-testid="acceso-serie" onClick={props.onStock}>
          Ver el coche de serie
        </button>
        {ACCESOS.map((a) => (
          <button key={a} type="button" className="acceso" disabled>
            {a}
            <small>Pronto</small>
          </button>
        ))}
      </div>
    </div>
  );
}
