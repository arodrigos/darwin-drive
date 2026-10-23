"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDecimal } from "@/app/format";
import { markInput } from "@/debug/latencias";
import { MAX_WHEELS, setBodyDensity, setWheelAxis, setWheelRadius, wheelCount } from "@/game/editor";
import type { WorkshopHandle } from "@/game/workshop-scene";
import { GENE_RANGES, type Genome } from "@/sim/genome";
import type { TrackId } from "@/sim/tracks";
import { TrackPicker, type RankingsView } from "./TrackPicker";
import { puedeDibujar } from "@/game/lienzo";

const SIN_LIENZO = "Tu navegador no puede dibujar el juego. Prueba a actualizarlo o a abrirlo en Safari o Chrome.";
export const AYUDA_TALLER =
  "Arrastra los puntos blancos para dar forma a la carrocería. Toca un punto para ponerle o quitarle una rueda. Elige abajo en qué pista lo pruebas.";
export const SIN_RUEDAS = "Sin ruedas no hay motor: este coche no avanzará.";
const AVISO_MS = 2000;

export interface TallerProps {
  genome: Genome;
  onGenome: (g: Genome) => void;
  trackId: TrackId;
  onTrack: (id: TrackId) => void;
  rankings: RankingsView;
  helpSeen: boolean;
  onHelpSeen: () => void;
  onTry: () => void;
  onEvolve: () => void;
  /** Devuelve el texto del aviso que debe leerse tras guardar. */
  onSave: () => Promise<string>;
  onBack: () => void;
}

export function Taller(props: TallerProps) {
  const { genome, helpSeen } = props;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<WorkshopHandle | null>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const [failed, setFailed] = useState(() => !puedeDibujar());
  const [slot, setSlot] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(!helpSeen);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    import("@/game/workshop-scene")
      .then(({ startWorkshop }) => {
        if (cancelled || !host.current) return;
        handle.current = startWorkshop(host.current, {
          onGenome: (g, s) => {
            setSlot(s);
            latest.current.onGenome(g);
          },
          onGesture: () => {
            // La ayuda de la primera vez dura hasta el primer gesto.
            setShowHelp(false);
            latest.current.onHelpSeen();
          },
        }, { alSinLienzo: () => setFailed(true) });
        handle.current.setState(latest.current.genome, null);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (toastTimer.current) clearTimeout(toastTimer.current);
      handle.current?.destroy();
      handle.current = null;
    };
  }, [failed]);

  useEffect(() => {
    handle.current?.setState(genome, slot);
  }, [genome, slot]);

  const wheel = slot !== null && genome.wheels[slot]?.vertex >= 0 ? genome.wheels[slot] : null;
  const wheels = wheelCount(genome);
  const activos = genome.wheels.map((w, i) => ({ w, i })).filter(({ w }) => w.vertex >= 0);

  const guardar = useCallback(async () => {
    const texto = await latest.current.onSave();
    setToast(texto);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), AVISO_MS);
  }, []);

  if (failed) {
    return (
      <div className="sin-lienzo" role="alert" data-testid="sin-lienzo">
        <p>{SIN_LIENZO}</p>
        <button type="button" className="pastilla" onClick={props.onBack}>
          Volver
        </button>
      </div>
    );
  }

  return (
    <div className="taller" data-testid="taller">
      <div className="taller-lienzo">
        <div className="lienzo" ref={host} data-testid="lienzo" />
        <div className="cabecera">
          <button type="button" className="pastilla" onClick={props.onBack} data-testid="volver">
            ← Volver
          </button>
        </div>
        {showHelp && (
          <p className="ayuda-taller" data-testid="ayuda-taller" role="note">
            {AYUDA_TALLER}
          </p>
        )}
        {wheels === 0 && (
          <p className="aviso-ruedas" data-testid="aviso-sin-ruedas" role="status">
            {SIN_RUEDAS}
          </p>
        )}
        {toast && (
          <div className="aviso-arriba" data-testid="aviso-guardado" role="status">
            {toast}
          </div>
        )}
      </div>
      <div className="taller-panel">
        <div className="fila">
          <span data-testid="contador-ruedas">
            Ruedas: {wheels}/{MAX_WHEELS}
          </span>
          {activos.map(({ i }, n) => (
            <button
              key={i}
              type="button"
              className="pastilla chica"
              aria-pressed={slot === i}
              data-testid={`rueda-${i}`}
              onClick={() => setSlot(i)}
            >
              Rueda {n + 1}
            </button>
          ))}
        </div>
        {wheel && slot !== null && (
          <>
            <label className="control">
              <span data-testid="etiqueta-radio">Radio: {formatDecimal(wheel.radius, 1)} m</span>
              <input
                type="range"
                data-testid="deslizador-radio"
                min={GENE_RANGES.radius[0]}
                max={GENE_RANGES.radius[1]}
                step={0.05}
                value={wheel.radius}
                onChange={(e) => props.onGenome(setWheelRadius(genome, slot, Number(e.target.value)))}
              />
            </label>
            <label className="control">
              <span>Dirección de la suspensión: {Math.round((wheel.axisAngle * 180) / Math.PI)}°</span>
              <input
                type="range"
                data-testid="deslizador-suspension"
                min={0}
                max={359}
                step={1}
                value={Math.round((wheel.axisAngle * 180) / Math.PI) % 360}
                onChange={(e) => props.onGenome(setWheelAxis(genome, slot, (Number(e.target.value) * Math.PI) / 180))}
              />
            </label>
          </>
        )}
        <label className="control">
          <span>Peso de la carrocería: {Math.round(genome.bodyDensity)} kg/m²</span>
          <input
            type="range"
            data-testid="deslizador-peso"
            min={GENE_RANGES.bodyDensity[0]}
            max={GENE_RANGES.bodyDensity[1]}
            step={1}
            value={genome.bodyDensity}
            onChange={(e) => {
              markInput("peso");
              props.onGenome(setBodyDensity(genome, Number(e.target.value)));
            }}
          />
          <small className="nota-peso" data-testid="nota-peso">
            Más peso = más opaco: la carrocería ligera se ve translúcida y la pesada, sólida.
          </small>
        </label>
        <div className="fila acciones-taller">
          <TrackPicker value={props.trackId} onChange={props.onTrack} rankings={props.rankings} />
          <button
            type="button"
            className="pastilla principal"
            data-testid="probar"
            onClick={() => {
              markInput("probar");
              props.onTry();
            }}
          >
            Probar
          </button>
          <button type="button" className="pastilla" data-testid="guardar" onClick={guardar}>
            Guardar en el garaje
          </button>
          <button
            type="button"
            className="pastilla"
            data-testid="evolucionar"
            onClick={() => {
              markInput("evolucionar");
              props.onEvolve();
            }}
          >
            Evolucionar este coche
          </button>
        </div>
      </div>
    </div>
  );
}
