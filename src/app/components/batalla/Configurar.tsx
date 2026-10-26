"use client";

import { useState } from "react";
import { COLORES_COCHE, PALETA_COCHES, type ColorCoche } from "@/game/colores-coche";
import { MAX_JUGADORES, MIN_JUGADORES } from "@/batalla/estado";
import { MuestraColor } from "../MuestraColor";

export const AVISO_NOMBRE_VACIO = "Cada jugador necesita un nombre";

interface Ficha {
  nombre: string;
  color: ColorCoche;
}

/** Colores por defecto: los cuatro primeros de la paleta, distintos entre sí. */
const INICIAL: Ficha[] = COLORES_COCHE.slice(0, MAX_JUGADORES).map((color, i) => ({ nombre: `Jugador ${i + 1}`, color }));

/** Si al subir el número de jugadores un color ya está cogido, el nuevo jugador recibe el primero libre. */
export function resolverColores(fichas: Ficha[], n: number): Ficha[] {
  const usados = new Set<ColorCoche>();
  return fichas.map((f, i) => {
    if (i >= n) return f;
    let color = f.color;
    if (usados.has(color)) color = COLORES_COCHE.find((c) => !usados.has(c)) ?? color;
    usados.add(color);
    return color === f.color ? f : { ...f, color };
  });
}

export function Configurar(props: { onEmpezar: (jugadores: Ficha[]) => void; onVolver: () => void }) {
  const [n, setN] = useState<number>(2);
  const [fichas, setFichas] = useState<Ficha[]>(INICIAL);
  const [intentado, setIntentado] = useState(false);
  const activos = fichas.slice(0, n);
  const vacio = (f: Ficha) => f.nombre.trim() === "";
  const hayVacios = activos.some(vacio);

  return (
    <div className="batalla-pantalla" data-testid="batalla-configurar">
      <div className="batalla-cabecera">
        <button type="button" className="pastilla" data-testid="volver" onClick={props.onVolver}>
          ← Volver
        </button>
        <h1>Batalla</h1>
      </div>
      <section className="zona" aria-labelledby="batalla-n">
        <h2 id="batalla-n">Jugadores</h2>
        <div className="segmentado" role="group" aria-label="Número de jugadores">
          {Array.from({ length: MAX_JUGADORES - MIN_JUGADORES + 1 }, (_, k) => MIN_JUGADORES + k).map((v) => (
            <button
              key={v}
              type="button"
              className="selector"
              aria-pressed={n === v}
              data-testid={`jugadores-${v}`}
              onClick={() => {
                setN(v);
                setFichas((fs) => resolverColores(fs, v));
              }}
            >
              {n === v ? "✓ " : ""}
              {v} jugadores
            </button>
          ))}
        </div>
      </section>
      {activos.map((f, i) => {
        const otros = new Set(activos.filter((_, k) => k !== i).map((x) => x.color));
        const error = intentado && vacio(f);
        return (
          <section key={i} className="zona jugador-config" aria-labelledby={`jugador-${i}`} data-testid={`jugador-${i}`}>
            <h2 id={`jugador-${i}`}>
              <MuestraColor color={f.color} /> Jugador {i + 1}
            </h2>
            <label className="campo-nombre">
              <span>Nombre</span>
              <input
                type="text"
                data-testid={`jugador-nombre-${i}`}
                value={f.nombre}
                maxLength={40}
                autoComplete="off"
                aria-invalid={error}
                aria-describedby={error ? `jugador-error-${i}` : undefined}
                onChange={(e) => setFichas((fs) => fs.map((x, k) => (k === i ? { ...x, nombre: e.target.value } : x)))}
              />
            </label>
            {error && (
              <p id={`jugador-error-${i}`} className="campo-error" role="alert" data-testid={`jugador-error-${i}`}>
                {AVISO_NOMBRE_VACIO}
              </p>
            )}
            <div className="fila-colores" role="group" aria-label={`Color de ${f.nombre.trim() || `Jugador ${i + 1}`}`}>
              {COLORES_COCHE.map((c) => {
                const ocupado = otros.has(c);
                return (
                  <button
                    key={c}
                    type="button"
                    className={`selector selector-color${ocupado ? " ocupado" : ""}`}
                    aria-pressed={f.color === c}
                    aria-disabled={ocupado || undefined}
                    aria-label={ocupado ? `${PALETA_COCHES[c].nombre} (ya elegido por otro jugador)` : PALETA_COCHES[c].nombre}
                    data-testid={`color-jugador-${i}-${c}`}
                    style={{ background: PALETA_COCHES[c].hex }}
                    onClick={() => {
                      if (ocupado) return;
                      setFichas((fs) => fs.map((x, k) => (k === i ? { ...x, color: c } : x)));
                    }}
                  >
                    {f.color === c ? "✓" : ""}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <div className="batalla-acciones">
        <button
          type="button"
          className="boton-primario"
          data-testid="empezar-batalla"
          onClick={() => {
            if (hayVacios) {
              setIntentado(true);
              return;
            }
            props.onEmpezar(activos);
          }}
        >
          Empezar
        </button>
      </div>
    </div>
  );
}
