"use client";

import { textoCausa } from "../ayuda/causas";
import { formatMeters } from "@/app/format";
import { useEffect } from "react";
import { measureOnNextFrame } from "@/debug/latencias";
import { opacidadBase } from "@/game/opacidad";
import { PALETA_COCHES, type ColorCoche } from "@/game/colores-coche";
import type { Genome } from "@/sim/genome";
import { getTrack, TRACKS, type TrackId } from "@/sim/tracks";
import type { SavedCar } from "@/storage/schema";
import { MuestraColor } from "./MuestraColor";
import { CopiaSeguridad } from "./CopiaSeguridad";
import { TrackPicker, type RankingsView } from "./TrackPicker";

export const GARAJE_VACIO = "Tu garaje está vacío. Diseña un coche en el Taller o evoluciona uno y guárdalo aquí.";

export function Silueta({ genome, hue, color: colorCoche }: { genome: Genome; hue?: number; color?: ColorCoche }) {
  const color = colorCoche ? PALETA_COCHES[colorCoche].hex : hue === undefined ? "#e9a23b" : `hsl(${hue} 70% 55%)`;
  const S = 22;
  const pt = (angle: number, length: number) => [Math.cos(angle) * length * S, -Math.sin(angle) * length * S] as const;
  const pts = genome.body.map((v) => pt(v.angle, v.length));
  return (
    <svg viewBox="-60 -60 120 120" className="silueta" aria-hidden="true" data-testid="silueta">
      <polygon points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} fill={color} fillOpacity={opacidadBase(genome.bodyDensity)} stroke="#1b1b1b" strokeWidth="2" />
      {genome.wheels
        .filter((w) => w.vertex >= 0)
        .map((w, i) => {
          const [x, y] = pts[w.vertex];
          return <circle key={i} cx={x} cy={y} r={w.radius * S} fill="#222" stroke="#fff" strokeWidth="1.5" />;
        })}
    </svg>
  );
}

/** Por qué se paró la mejor marca de cada pista, si se sabe (las marcas anteriores a la causa no la traen). */
function paradas(car: SavedCar): { id: string; nombre: string; texto: string }[] {
  return TRACKS.flatMap((t) => {
    const d = car.markDetails?.[t.id];
    return d?.causaParada ? [{ id: t.id, nombre: t.name, texto: textoCausa(d.causaParada, d.pendienteParada) }] : [];
  });
}

function marcas(car: SavedCar): string {
  const hechas = TRACKS.filter((t) => car.marks[t.id] !== undefined);
  if (hechas.length === 0) return "sin probar";
  return hechas.map((t) => `${t.name} ${formatMeters(car.marks[t.id]!)}`).join(" · ");
}

export function Garaje(props: {
  cars: SavedCar[];
  trackId: TrackId;
  onTrack: (id: TrackId) => void;
  rankings: RankingsView;
  onTry: (car: SavedCar) => void;
  /** Medición en curso (una sola a la vez) y el resumen de la última de cada coche. */
  midiendo: { carId: string; n: number; total: number } | null;
  resumenes: Record<string, string>;
  onMeasure: (car: SavedCar) => void;
  onOpen: (car: SavedCar) => void;
  onEvolve: (car: SavedCar) => void;
  /** «Evolucionado en La Cordillera · gen 7»: de dónde salió el coche. */
  ficha: (car: SavedCar) => string;
  onRenombrar: (car: SavedCar) => void;
  onDelete: (car: SavedCar) => void;
  onTaller: () => void;
  onBack: () => void;
  almacenDisponible: boolean;
  /** Tras reemplazar el guardado con una copia: la app vuelve a leerlo todo. */
  onImportada: () => Promise<void>;
}) {
  const midiendoAhora = props.midiendo !== null;
  // El progreso ya está en pantalla cuando este efecto corre.
  useEffect(() => {
    if (midiendoAhora) measureOnNextFrame("medir-pistas");
  }, [midiendoAhora]);
  return (
    <div className="garaje" data-testid="garaje">
      <div className="garaje-cabecera">
        <button type="button" className="pastilla" onClick={props.onBack} data-testid="volver">
          ← Volver
        </button>
        <h2>Garaje</h2>
        <TrackPicker value={props.trackId} onChange={props.onTrack} rankings={props.rankings} />
      </div>
      {props.cars.length === 0 ? (
        <div className="garaje-vacio" data-testid="garaje-vacio">
          <p>{GARAJE_VACIO}</p>
          <button type="button" className="pastilla principal" onClick={props.onTaller} data-testid="ir-taller">
            Ir al Taller
          </button>
        </div>
      ) : (
        <ul className="garaje-lista">
          {props.cars.map((car) => (
            <li key={car.id} className="tarjeta-coche" data-testid="tarjeta-coche">
              <Silueta genome={car.genome} color={car.color} />
              <div className="datos">
                <strong data-testid="garaje-nombre">
                  {car.color && <MuestraColor color={car.color} />}
                  {car.name}
                </strong>
                <span className="etiqueta" data-testid="origen">
                  {car.origin}
                </span>
                <span className="ficha-origen" data-testid="ficha-origen">
                  {props.ficha(car)}
                </span>
                <span data-testid="marcas">{marcas(car)}</span>
                {paradas(car).map((p) => (
                  <span key={p.id} className="causa-parada" data-testid={`garaje-causa-${p.id}`}>
                    {p.nombre}: Se paró: {p.texto}
                  </span>
                ))}
                {props.midiendo?.carId === car.id && (
                  <span className="progreso-medicion" role="status" data-testid="progreso-medicion">
                    Midiendo {props.midiendo.n}/{props.midiendo.total}…
                  </span>
                )}
                {props.resumenes[car.id] && props.midiendo?.carId !== car.id && (
                  <span className="resumen-medicion" role="status" data-testid="resumen-medicion">
                    {props.resumenes[car.id]}
                  </span>
                )}
                <span className="acciones-coche">
                  <button type="button" className="pastilla chica" onClick={() => props.onTry(car)} data-testid="garaje-probar">
                    Probar en {getTrack(props.trackId)?.name}
                  </button>
                  <button type="button" className="pastilla chica" disabled={midiendoAhora} onClick={() => props.onMeasure(car)} data-testid="garaje-medir">
                    Medir en todas las pistas
                  </button>
                  <button type="button" className="pastilla chica" onClick={() => props.onOpen(car)} data-testid="garaje-abrir">
                    Abrir en el taller
                  </button>
                  <button type="button" className="pastilla chica" onClick={() => props.onEvolve(car)} data-testid="garaje-evolucionar">
                    Evolucionar
                  </button>
                  <button type="button" className="pastilla chica" onClick={() => props.onRenombrar(car)} data-testid="garaje-renombrar">
                    Renombrar
                  </button>
                  <button type="button" className="pastilla chica" onClick={() => props.onDelete(car)} data-testid="garaje-borrar">
                    Borrar
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <CopiaSeguridad almacenDisponible={props.almacenDisponible} onImportada={props.onImportada} />
    </div>
  );
}
