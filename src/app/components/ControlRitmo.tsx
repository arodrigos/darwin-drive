"use client";

import type { Pace } from "@/worker/protocol";
import { ETIQUETA_RITMO } from "../ritmo";

const ORDEN: Pace[] = ["x1", "x2", "x4", "x8", "turbo"];

export interface ControlRitmoProps {
  /** Prefijo de los data-testid: Pista usa «ritmo» y Evolución «evo-ritmo». */
  prefijo: "ritmo" | "evo-ritmo";
  activo: Pace;
  onElegir: (p: Pace) => void;
  /** N de «real ×N» cuando el dispositivo no llega; null si va bien. */
  ritmoReal: number | null;
  /** Texto del último botón (en Pista, «Hasta el final»). */
  etiquetaFinal: string;
  /** Capa «Fuerzas» (apagada por defecto); sin esta prop la fila no tiene el interruptor. */
  fuerzas?: { activa: boolean; onAlternar: () => void };
}

/**
 * La misma fila en Pista y Evolución. La franja de arriba mide siempre 20 px, haya rótulo o no,
 * así que enseñar «real ×N» nunca mueve ni cambia de tamaño ningún botón.
 */
export function ControlRitmo({ prefijo, activo, onElegir, ritmoReal, etiquetaFinal, fuerzas }: ControlRitmoProps) {
  const sufijo = (p: Pace) => (p === "turbo" ? (prefijo === "ritmo" ? "final" : "turbo") : p);
  return (
    <div className="control-ritmo" data-testid={`${prefijo}-control`}>
      <div className="franja-ritmo" aria-hidden={ritmoReal === null}>
        {ritmoReal !== null && (
          <span className="ritmo-real" role="status" data-testid="ritmo-real" style={{ gridColumn: ORDEN.indexOf(activo) + 1 }}>
            real ×{ritmoReal}
          </span>
        )}
      </div>
      <div className="botones-ritmo">
        {ORDEN.map((p) => (
          <button
            key={p}
            type="button"
            className="pastilla chica"
            aria-pressed={activo === p}
            data-testid={`${prefijo}-${sufijo(p)}`}
            onClick={() => {
              if (p !== activo) onElegir(p);
            }}
          >
            {p === "turbo" ? etiquetaFinal : ETIQUETA_RITMO[p]}
          </button>
        ))}
      </div>
      {fuerzas && (
        <div className="fila-fuerzas">
          <button type="button" className="selector" aria-pressed={fuerzas.activa} data-testid={`${prefijo}-fuerzas`} onClick={fuerzas.onAlternar}>
            {fuerzas.activa ? "✓ " : ""}Fuerzas
          </button>
          {fuerzas.activa && (
            <p className="leyenda-fuerzas" data-testid={`${prefijo}-leyenda-fuerzas`} role="note">
              → fuerza de la rueda · ◠ par
            </p>
          )}
        </div>
      )}
    </div>
  );
}
