"use client";

import { useState } from "react";
import { formatMeters } from "@/app/format";
import { TEXTO_CRITERIO } from "@/batalla/carrera";
import type { EstadoBatalla } from "@/batalla/estado";
import { PALETA_COCHES } from "@/game/colores-coche";
import { formatTiempo } from "@/sim/clasificacion";
import { getTrack } from "@/sim/tracks";

export interface ResultadoProps {
  estado: EstadoBatalla;
  /** Guarda en el garaje los coches de estos jugadores y devuelve el aviso que se enseña. */
  onGuardar: (jugadores: number[]) => Promise<string>;
  onRevancha: () => void;
  onOtraPista: () => void;
  /** Borra la batalla y vuelve a la portada. */
  onSalir: () => void;
}

/** Podio: posición, nombre, color (con su nombre al lado, nunca solo el tono), distancia, tiempo y criterio decisivo. */
export function Resultado(props: ResultadoProps) {
  const { estado } = props;
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const pista = estado.pista ? getTrack(estado.pista) : null;
  const filas = estado.resultados ?? [];
  const guardar = async (jugadores: number[]) => {
    if (guardando) return;
    setGuardando(true);
    try {
      setAviso(await props.onGuardar(jugadores));
    } finally {
      setGuardando(false);
    }
  };
  return (
    <div className="batalla-pantalla" data-testid="batalla-resultado">
      <div className="batalla-cabecera">
        <h1>Resultado{pista ? ` · ${pista.name}` : ""}</h1>
      </div>
      <ol className="podio" data-testid="podio">
        {filas.map((r, k) => {
          const j = estado.jugadores[r.jugador];
          return (
            <li key={r.jugador} className="podio-fila" data-testid={`podio-fila-${k}`} data-jugador={r.jugador}>
              <span className="podio-posicion" data-testid="podio-posicion">
                {r.posicion}º
              </span>
              <span className="muestra-color" aria-hidden="true" data-color={j.color} style={{ background: PALETA_COCHES[j.color].hex }} />
              <span className="podio-nombre" data-testid="podio-nombre">
                {j.nombre}
                <small> · {j.coche?.nombre}</small>
              </span>
              <span className="podio-distancia" data-testid="podio-distancia">
                {formatMeters(r.distance)}
              </span>
              <span className="podio-tiempo" data-testid="podio-tiempo">
                {formatTiempo(r.bestStep)}
              </span>
              <span className="podio-criterio" data-testid="podio-criterio">
                {TEXTO_CRITERIO[r.criterio]}
              </span>
              <button type="button" className="enlace-terciario" data-testid={`guardar-coche-${r.jugador}`} disabled={guardando} onClick={() => void guardar([r.jugador])}>
                Guardar en el garaje
              </button>
            </li>
          );
        })}
      </ol>
      {aviso && (
        <p className="aviso-guardado" role="status" data-testid="aviso-guardado">
          {aviso}
        </p>
      )}
      <div className="batalla-acciones">
        <button type="button" className="boton-primario" data-testid="guardar-todos" disabled={guardando} onClick={() => void guardar(filas.map((r) => r.jugador))}>
          Guardar todos
        </button>
        <button type="button" className="boton-secundario" data-testid="revancha" onClick={props.onRevancha}>
          Revancha
        </button>
        <button type="button" className="boton-secundario" data-testid="otra-pista" onClick={props.onOtraPista}>
          Otra pista
        </button>
        <button type="button" className="enlace-terciario" data-testid="resultado-salir" onClick={props.onSalir}>
          Salir
        </button>
      </div>
    </div>
  );
}
