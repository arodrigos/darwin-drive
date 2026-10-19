"use client";

import { useState } from "react";
import { markInput } from "@/debug/latencias";
import { DEFAULT_PARAMS, type GaParams } from "@/evolution/ga";
import type { Genome } from "@/sim/genome";
import type { TrackId } from "@/sim/tracks";
import type { SavedCar } from "@/storage/schema";
import { TrackPicker, type RankingsView } from "./TrackPicker";

export type Siembra = "aleatoria" | "mi-coche" | "garaje";

/** Con ?pruebas=1&semilla=N la semilla es fija; en el juego normal cada evolución es distinta. */
export function nuevaSemilla(): number {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search);
    const fija = Number(q.get("semilla"));
    if (q.get("pruebas") === "1" && q.has("semilla") && Number.isInteger(fija)) return fija;
  }
  return Math.floor(Math.random() * 0x7fffffff);
}

export const AYUDAS = {
  pista: "Pista: la evolución buscará los coches que más lejos lleguen en ella.",
  poblacion: "Coches por generación. Más coches exploran más, pero cada generación tarda más.",
  elite: "Los mejores que pasan tal cual a la generación siguiente, sin cambiar.",
  probabilidad: "Probabilidad de que cambie cada gen de un hijo. Poca = retoques; mucha = saltos al azar.",
  tamano: "Cuánto se mueve un gen cuando cambia: pequeño afina, grande prueba ideas distintas.",
  siembra: "De dónde salen los coches de la primera generación.",
} as const;

const TAMANOS: { id: GaParams["mutationSize"]; nombre: string }[] = [
  { id: "small", nombre: "Pequeño" },
  { id: "medium", nombre: "Medio" },
  { id: "large", nombre: "Grande" },
];

export interface InicioProps {
  trackId: TrackId;
  onTrack: (id: TrackId) => void;
  rankings: RankingsView;
  garage: SavedCar[];
  workshopGenome: Genome;
  /** Coche del garaje con el que se abrió el panel (botón «Evolucionar» de su tarjeta). */
  desdeCoche: SavedCar | null;
  onStart: (params: GaParams, siembra: Siembra, coche: SavedCar | null) => void;
  onBack: () => void;
}

export function InicioEvolucion(props: InicioProps) {
  const [population, setPopulation] = useState(DEFAULT_PARAMS.populationSize);
  const [elite, setElite] = useState(DEFAULT_PARAMS.eliteCount);
  const [rate, setRate] = useState(Math.round(DEFAULT_PARAMS.mutationRate * 100));
  const [size, setSize] = useState<GaParams["mutationSize"]>(DEFAULT_PARAMS.mutationSize);
  const [siembra, setSiembra] = useState<Siembra>(props.desdeCoche ? "garaje" : "aleatoria");
  const sinGaraje = props.garage.length === 0;

  const empezar = () => {
    markInput("evolucionar");
    props.onStart(
      { populationSize: population, eliteCount: elite, mutationRate: rate / 100, mutationSize: size, seed: nuevaSemilla() },
      siembra,
      siembra === "garaje" ? props.desdeCoche : null,
    );
  };

  return (
    <div className="inicio-evolucion" data-testid="inicio-evolucion">
      <div className="garaje-cabecera">
        <button type="button" className="pastilla" onClick={props.onBack} data-testid="volver">
          ← Volver
        </button>
        <h2>Evolución</h2>
      </div>
      <div className="campo">
        <TrackPicker value={props.trackId} onChange={props.onTrack} rankings={props.rankings} />
        <small data-testid="ayuda-pista">{AYUDAS.pista}</small>
      </div>
      <label className="campo">
        <span>
          Población: <b data-testid="valor-poblacion">{population}</b> coches (por defecto {DEFAULT_PARAMS.populationSize})
        </span>
        <input type="range" min={8} max={32} step={1} value={population} data-testid="campo-poblacion" onChange={(e) => setPopulation(Number(e.target.value))} />
        <small>{AYUDAS.poblacion}</small>
      </label>
      <label className="campo">
        <span>
          Élite: <b data-testid="valor-elite">{elite}</b> (por defecto {DEFAULT_PARAMS.eliteCount})
        </span>
        <input type="range" min={0} max={4} step={1} value={elite} data-testid="campo-elite" onChange={(e) => setElite(Number(e.target.value))} />
        <small>{AYUDAS.elite}</small>
      </label>
      <label className="campo">
        <span>
          Probabilidad de mutación: <b data-testid="valor-probabilidad">{rate} %</b> (por defecto {Math.round(DEFAULT_PARAMS.mutationRate * 100)} %)
        </span>
        <input type="range" min={1} max={30} step={1} value={rate} data-testid="campo-probabilidad" onChange={(e) => setRate(Number(e.target.value))} />
        <small>{AYUDAS.probabilidad}</small>
      </label>
      <div className="campo">
        <span>Tamaño de mutación (por defecto Medio)</span>
        <div className="fila">
          {TAMANOS.map((t) => (
            <button key={t.id} type="button" className="pastilla chica" aria-pressed={size === t.id} data-testid={`tamano-${t.id}`} onClick={() => setSize(t.id)}>
              {t.nombre}
            </button>
          ))}
        </div>
        <small>{AYUDAS.tamano}</small>
      </div>
      <div className="campo">
        <span>Primera generación (por defecto: aleatoria)</span>
        <div className="fila">
          <button type="button" className="pastilla chica" aria-pressed={siembra === "aleatoria"} data-testid="siembra-aleatoria" onClick={() => setSiembra("aleatoria")}>
            Aleatoria
          </button>
          <button type="button" className="pastilla chica" aria-pressed={siembra === "mi-coche"} data-testid="siembra-mi-coche" onClick={() => setSiembra("mi-coche")}>
            Desde mi coche
          </button>
          <button
            type="button"
            className="pastilla chica"
            aria-pressed={siembra === "garaje"}
            disabled={sinGaraje}
            data-testid="siembra-garaje"
            onClick={() => setSiembra("garaje")}
          >
            Desde el garaje
          </button>
        </div>
        <small>{sinGaraje ? "El garaje está vacío: guarda un coche del Taller para sembrar con él." : AYUDAS.siembra}</small>
        {siembra === "garaje" && props.desdeCoche && <small data-testid="coche-sembrado">Coche: {props.desdeCoche.name}</small>}
      </div>
      <button type="button" className="pastilla principal grande" data-testid="empezar-evolucion" onClick={empezar}>
        Empezar
      </button>
    </div>
  );
}
