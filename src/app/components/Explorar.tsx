"use client";

import { useEffect, useRef, useState } from "react";
import type { ExploreHandle } from "@/game/explore";
import { runtime } from "@/debug/ganchos";
import { getTrack, type TrackId } from "@/sim/tracks";
import { formatMeters } from "@/app/format";
import { TrackPicker, type RankingsView } from "./TrackPicker";

const SIN_LIENZO = "Tu navegador no puede dibujar el juego. Prueba a actualizarlo o a abrirlo en Safari o Chrome.";

// Comprueba antes de cargar Phaser: sin WebGL ni Canvas 2D no hay nada que pintar.
function canDraw(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("2d"));
  } catch {
    return false;
  }
}

export function Explorar(props: { trackId: TrackId; onTrack: (id: TrackId) => void; onBack: () => void; rankings: RankingsView }) {
  const { trackId } = props;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<ExploreHandle | null>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const trackRef = useRef(trackId);
  // Se decide al montar (la app no se renderiza en el servidor): sin lienzo posible, se explica y no se carga Phaser.
  const [failed, setFailed] = useState(() => !canDraw());
  const track = getTrack(trackId)!;

  useEffect(() => {
    let cancelled = false;
    if (failed) return;
    import("@/game/explore")
      .then(({ startExplore }) => {
        if (cancelled || !host.current) return;
        handle.current = startExplore(host.current, getTrack(trackRef.current)!, (f) => {
          runtime.camaraX = f.camX;
          runtime.tramosGenerados = f.generated;
          if (ruler.current) ruler.current.textContent = formatMeters(f.camX);
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      handle.current?.destroy();
      handle.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe arrancar una vez al montar
  }, []);

  useEffect(() => {
    trackRef.current = trackId;
    handle.current?.setTrack(getTrack(trackId)!);
  }, [trackId]);

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
    <div className="explorar" data-testid="explorar">
      <div className="lienzo" ref={host} data-testid="lienzo" />
      <div className="cabecera">
        <button type="button" className="pastilla" onClick={props.onBack} data-testid="volver">
          ← Volver
        </button>
        <TrackPicker value={trackId} onChange={props.onTrack} rankings={props.rankings} />
        <div className="nombre-pista" data-testid="nombre-pista">
          {track.name}
        </div>
      </div>
      <div className="regla-metros" ref={ruler} data-testid="regla-metros">
        0,0 m
      </div>
    </div>
  );
}
