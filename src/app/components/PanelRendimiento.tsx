"use client";

import { useEffect, useState } from "react";
import { latencias, onLatencia, type Latencia } from "@/debug/latencias";
import { runtime } from "@/debug/ganchos";
import { rendimiento } from "@/debug/rendimiento";
import { formatDecimal } from "@/app/format";

const MAX_FRAMES = 120;
const LIMITE_MS = 200;

interface Cifras {
  fps: number;
  p95: number;
  coches: number;
  latencias: Latencia[];
  camara: { fps: number; margen: number } | null;
}

function medir(deltas: number[]): { fps: number; p95: number } {
  if (deltas.length === 0) return { fps: 0, p95: 0 };
  const media = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const orden = [...deltas].sort((a, b) => a - b);
  return { fps: 1000 / media, p95: orden[Math.min(orden.length - 1, Math.floor(orden.length * 0.95))] };
}

/** Panel plegable de ?rendimiento=1: lo que Adrián mira en su iPad para saber si el juego va fluido. */
export function PanelRendimiento() {
  const [c, setC] = useState<Cifras>({ fps: 0, p95: 0, coches: 0, latencias: [], camara: null });

  useEffect(() => {
    const deltas: number[] = [];
    let ultimo = performance.now();
    let raf = requestAnimationFrame(function bucle(ahora) {
      deltas.push(ahora - ultimo);
      if (deltas.length > MAX_FRAMES) deltas.shift();
      ultimo = ahora;
      raf = requestAnimationFrame(bucle);
    });
    const refrescar = () =>
      setC({ ...medir(deltas), coches: rendimiento.cochesPorSegundo, latencias: latencias().slice(-10).reverse(), camara: runtime.camara ? { fps: runtime.camara.fpsDibujo, margen: runtime.camara.margenMinPx } : null });
    const timer = setInterval(refrescar, 500);
    const quitar = onLatencia(refrescar);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      quitar();
    };
  }, []);

  return (
    <details className="panel-rendimiento" data-testid="panel-rendimiento" open>
      <summary>Rendimiento</summary>
      <dl>
        <dt>fps</dt>
        <dd data-testid="rend-fps">{formatDecimal(c.fps, 0)}</dd>
        <dt>p95 frame</dt>
        <dd data-testid="rend-p95">{formatDecimal(c.p95, 1)} ms</dd>
        <dt>coches/s simulados</dt>
        <dd data-testid="rend-coches">{formatDecimal(c.coches, 1)}</dd>
      </dl>
      {c.camara && (
        <p data-testid="rend-camara">
          cámara · {formatDecimal(c.camara.fps, 0)} fps · margen {formatDecimal(c.camara.margen, 0)} px
        </p>
      )}
      <ol className="latencias" data-testid="rend-latencias">
        {c.latencias.map((l) => (
          <li key={`${l.evento}-${l.t}`} className={l.ms <= LIMITE_MS ? "ok" : "lenta"} data-evento={l.evento}>
            {l.evento} · {formatDecimal(l.ms, 0)} ms
          </li>
        ))}
      </ol>
    </details>
  );
}
