"use client";

import { PALETA_COCHES } from "@/game/colores-coche";
import type { JugadorBatalla } from "@/batalla/estado";

export const AVISO_REINICIO = "Tu diseño se reinició al recargar";

/**
 * Pantalla de relevo a pantalla completa. No dibuja ningún coche: el siguiente jugador no debe ver el diseño del anterior.
 * El color va en una franja y el nombre en el texto, para que el color no sea el único canal.
 */
export function Relevo(props: { jugador: JugadorBatalla; reiniciado: boolean; onEmpezar: () => void; onSalir: () => void; onAbandonar: () => void }) {
  const { jugador } = props;
  return (
    <div className="relevo" data-testid="relevo" style={{ borderTopColor: PALETA_COCHES[jugador.color].hex }}>
      <div className="relevo-franja" data-testid="relevo-franja" data-color={jugador.color} style={{ background: PALETA_COCHES[jugador.color].hex }} aria-hidden="true" />
      <h1 data-testid="relevo-titulo">Turno de {jugador.nombre}</h1>
      <p className="relevo-pasa">Pasa el dispositivo a {jugador.nombre}</p>
      {props.reiniciado && (
        <p className="relevo-aviso" role="status" data-testid="relevo-aviso">
          {AVISO_REINICIO}
        </p>
      )}
      <div className="batalla-acciones">
        <button type="button" className="boton-primario" data-testid="soy-jugador" onClick={props.onEmpezar}>
          Soy {jugador.nombre}, empezar
        </button>
        <button type="button" className="enlace-terciario" data-testid="batalla-salir" onClick={props.onSalir}>
          Salir y continuar luego
        </button>
        <button type="button" className="enlace-terciario" data-testid="batalla-abandonar" onClick={props.onAbandonar}>
          Abandonar batalla
        </button>
      </div>
    </div>
  );
}
