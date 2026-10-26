"use client";

import { PALETA_COCHES } from "@/game/colores-coche";
import type { JugadorBatalla } from "@/batalla/estado";
import { TRACKS, type TrackId } from "@/sim/tracks";
import { TrackMiniature } from "../TrackPicker";

/** Aquí todavía no se enseña ningún coche: los diseños solo se leen en la carrera. */
export function ElegirPista(props: { jugadores: JugadorBatalla[]; pista: TrackId | null; onPista: (id: TrackId) => void; onCorrer: () => void; onSalir: () => void; onAbandonar: () => void }) {
  return (
    <div className="batalla-pantalla" data-testid="batalla-elegir-pista">
      <div className="batalla-cabecera">
        <h1>Elegir pista</h1>
      </div>
      <p className="batalla-listos" data-testid="batalla-listos">
        {props.jugadores.map((j) => (
          <span key={j.nombre} className="chip-jugador">
            <span className="muestra-color" aria-hidden="true" style={{ background: PALETA_COCHES[j.color].hex }} /> {j.nombre}
          </span>
        ))}
      </p>
      <section className="zona" aria-labelledby="batalla-pistas">
        <h2 id="batalla-pistas">Pista de la carrera</h2>
        <div className="pistas pistas-batalla">
          {TRACKS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tarjeta-pista selector"
              aria-pressed={props.pista === t.id}
              data-testid={`batalla-pista-${t.id}`}
              onClick={() => props.onPista(t.id)}
            >
              <span className="nombre">
                {props.pista === t.id ? "✓ " : ""}
                {t.name}
              </span>
              <TrackMiniature track={t} />
            </button>
          ))}
        </div>
      </section>
      <div className="batalla-acciones">
        <button type="button" className="boton-primario" data-testid="a-correr" disabled={props.pista === null} onClick={props.onCorrer}>
          ¡A correr!
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
