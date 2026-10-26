"use client";

import { createNoise2D } from "simplex-noise";
import { TRACKS, type TrackId } from "@/sim/tracks";
import { TrackMiniature, topMark, type RankingsView } from "./TrackPicker";

const noise = createNoise2D(() => 0.62);

// Paisaje de fondo: dos cordilleras pintadas con SVG, sin activos externos.
function Paisaje() {
  const layer = (seed: number, base: number, amp: number, colour: string) => {
    const pts: string[] = ["0,100"];
    for (let i = 0; i <= 60; i++) pts.push(`${(i / 60) * 100},${base - ((noise(i / 9, seed) + 1) / 2) * amp}`);
    pts.push("100,100");
    return <polygon points={pts.join(" ")} fill={colour} />;
  };
  return (
    <svg className="paisaje" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-testid="paisaje">
      {layer(1, 70, 45, "#8aa0bd")}
      {layer(2, 88, 35, "#4f7a58")}
      {layer(3, 100, 20, "#35603f")}
    </svg>
  );
}

// Orden de la zona «Más»: lo que se consulta, de más a menos usado.
const MAS = [
  { testid: "acceso-garaje", texto: "Garaje", accion: "onGarage" },
  { testid: "acceso-linaje", texto: "Linaje", accion: "onLinaje" },
  { testid: "acceso-especies", texto: "Especies", accion: "onEspecies" },
  { testid: "acceso-explorar", texto: "Explorar pista", accion: "onExplore" },
  { testid: "acceso-serie", texto: "Ver el coche de serie", accion: "onStock" },
  { testid: "acceso-guia", texto: "Cómo se juega", accion: "onGuia" },
] as const;

export function Portada(props: { rankings: RankingsView; onExplore: () => void; onStock: () => void; onRanking: (id: TrackId) => void; onTaller: () => void; onGarage: () => void; onGuia: () => void; onLinaje: () => void; onEvolucion: () => void; onEspecies: () => void; continuar: { generation: number; trackName: string } | null; onContinuar: () => void; onBatalla: () => void; continuarBatalla: string | null; onContinuarBatalla: () => void }) {
  return (
    <div className="portada" data-testid="portada">
      <Paisaje />
      <h1 className="titulo">Darwin Drive</h1>
      <p className="subtitulo">Diseña un coche, elige pista y mira hasta dónde llega.</p>
      <section className="zona" aria-labelledby="zona-jugar" data-testid="zona-jugar">
        <h2 id="zona-jugar">Jugar</h2>
        <div className="zona-acciones">
          <button type="button" className="boton-primario" data-testid="acceso-taller" onClick={props.onTaller}>
            Taller
          </button>
          <button type="button" className="boton-secundario" data-testid="acceso-evolucion" onClick={props.onEvolucion}>
            Evolución
          </button>
          <button type="button" className="boton-secundario" data-testid="acceso-batalla" onClick={props.onBatalla}>
            Batalla
          </button>
          {props.continuarBatalla && (
            <button type="button" className="boton-secundario" data-testid="acceso-continuar-batalla" onClick={props.onContinuarBatalla}>
              Continuar batalla ({props.continuarBatalla})
            </button>
          )}
          {props.continuar && (
            <button type="button" className="boton-secundario" data-testid="acceso-continuar" onClick={props.onContinuar}>
              Continuar evolución (gen {props.continuar.generation} · {props.continuar.trackName})
            </button>
          )}
        </div>
      </section>
      <section className="zona" aria-labelledby="zona-records" data-testid="zona-records">
        <h2 id="zona-records">Récords por pista</h2>
        <div className="pistas">
          {TRACKS.map((t) => (
            <button key={t.id} type="button" className="tarjeta-pista" data-testid={`tarjeta-${t.id}`} onClick={() => props.onRanking(t.id)}>
              <span className="nombre">{t.name}</span>
              <TrackMiniature track={t} />
              <span className="marca">{topMark(props.rankings, t.id, true)}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="zona" aria-labelledby="zona-mas" data-testid="zona-mas">
        <h2 id="zona-mas">Más</h2>
        <ul className="lista-enlaces">
          {MAS.map((m) => (
            <li key={m.testid}>
              <button type="button" className="enlace-terciario" data-testid={m.testid} onClick={props[m.accion]}>
                {m.texto}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
