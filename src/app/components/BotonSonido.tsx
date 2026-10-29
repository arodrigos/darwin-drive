"use client";

import { useSyncExternalStore } from "react";
import { alternarSonido, sonidoEncendido, suscribirSonido } from "@/audio/sonido";
import { markInput, measureOnNextFrame } from "@/debug/latencias";

export const AYUDA_SONIDO = "En iPhone y iPad, el interruptor de silencio también calla el juego";

const servidor = () => false;

/** Altavoz de las cabeceras. `fijo` lo apoya arriba a la izquierda del «?» en la Portada, que no tiene cabecera. */
export function BotonSonido(props: { fijo?: boolean }) {
  const encendido = useSyncExternalStore(suscribirSonido, sonidoEncendido, servidor);
  const etiqueta = encendido ? "Sonido encendido. Toca para apagarlo" : "Sonido apagado. Toca para encenderlo";
  return (
    <button
      type="button"
      className={`pastilla boton-sonido${props.fijo ? " boton-sonido-fijo" : ""}`}
      aria-pressed={encendido}
      aria-label={etiqueta}
      title={`${etiqueta}. ${AYUDA_SONIDO}.`}
      data-testid="boton-sonido"
      onClick={() => {
        markInput("sonido");
        alternarSonido();
        measureOnNextFrame("sonido");
      }}
    >
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
        {encendido ? (
          <>
            <path d="M16 9a4 4 0 0 1 0 6" />
            <path d="M18.5 6.5a8 8 0 0 1 0 11" />
          </>
        ) : (
          <path d="M16 9l5 6M21 9l-5 6" />
        )}
      </svg>
    </button>
  );
}
