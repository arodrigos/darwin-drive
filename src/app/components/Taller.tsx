"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDecimal } from "@/app/format";
import { runtime } from "@/debug/ganchos";
import { markInput } from "@/debug/latencias";
import {
  ANGLE_STEP,
  LENGTH_STEP,
  MAX_WHEELS,
  TAMANO_STEP,
  ajustarAngulo,
  ajustarLongitud,
  dimensiones,
  ejeDeInclinacion,
  escalarCoche,
  factorPermitido,
  inclinacionDeEje,
  lecturaInclinacion,
  piezaLimitante,
  ponerRueda,
  quitarRueda,
  setBodyDensity,
  setWheelAxis,
  setWheelRadius,
  wheelAt,
  wheelCount,
} from "@/game/editor";
import type { WorkshopHandle } from "@/game/workshop-scene";
import { GENE_RANGES, genomeHash, STOCK_CAR, type Genome } from "@/sim/genome";
import { estatica } from "@/sim/physics/estatica";
import type { TrackId } from "@/sim/tracks";
import { COLORES_COCHE, PALETA_COCHES, type ColorCoche, type IdentidadCoche } from "@/game/colores-coche";
import { MuestraColor } from "./MuestraColor";
import { PanelRendimiento } from "./PanelRendimiento";
import { TrackPicker, type RankingsView } from "./TrackPicker";
import { puedeDibujar } from "@/game/lienzo";

const SIN_LIENZO = "Tu navegador no puede dibujar el juego. Prueba a actualizarlo o a abrirlo en Safari o Chrome.";
export const AYUDA_TALLER =
  "Toca un punto para elegirlo; arrástralo para darle forma. Con el punto elegido puedes ponerle una rueda. Elige abajo en qué pista lo pruebas.";
export const SIN_RUEDAS = "Sin ruedas no hay motor: este coche no avanzará.";
const AVISO_MS = 2000;

export interface TallerProps {
  genome: Genome;
  onGenome: (g: Genome) => void;
  /** Nombre y color del coche en el Taller: metadatos, fuera del genoma. */
  identidad: IdentidadCoche;
  onColor: (c: ColorCoche) => void;
  /** Abre la hoja de nombre; quien la monta guarda el texto en la identidad. */
  onRenombrar: () => void;
  /** Vuelve al coche de serie con otra identidad. */
  onNuevo: () => void;
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
  const [vertice, setVertice] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(!helpSeen);
  const [colores, setColores] = useState(false);
  const [rendimiento] = useState(() => new URLSearchParams(window.location.search).get("rendimiento") === "1");
  const [fuerzas, setFuerzas] = useState(false);
  const [confirmarNuevo, setConfirmarNuevo] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    import("@/game/workshop-scene")
      .then(({ startWorkshop }) => {
        if (cancelled || !host.current) return;
        handle.current = startWorkshop(host.current, {
          onGenome: (g) => latest.current.onGenome(g),
          onSelect: (v) => {
            setVertice(v);
            runtime.verticeSeleccionado = v;
          },
          onGesture: () => {
            // La ayuda de la primera vez dura hasta el primer gesto.
            setShowHelp(false);
            latest.current.onHelpSeen();
          },
        }, { alSinLienzo: () => setFailed(true) });
        handle.current.setState(latest.current.genome, null, latest.current.identidad.color, false);
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
    handle.current?.setState(genome, vertice, props.identidad.color, fuerzas);
  }, [genome, vertice, props.identidad.color, fuerzas]);

  useEffect(() => {
    runtime.dimensiones = dimensiones(genome);
    runtime.inclinaciones = genome.wheels.map((w) => inclinacionDeEje(w.axisAngle));
    const e = estatica(genome);
    runtime.fuerzasTaller = { visible: fuerzas, centroMasas: e.centroMasas, pares: e.ruedas.map((r) => r.parMax) };
  }, [genome, fuerzas]);

  useEffect(
    () => () => {
      runtime.verticeSeleccionado = null;
      runtime.dimensiones = null;
      runtime.inclinaciones = [];
      runtime.fuerzasTaller = null;
    },
    [],
  );

  const slot = vertice !== null && wheelAt(genome, vertice) >= 0 ? wheelAt(genome, vertice) : null;
  const wheel = slot !== null ? genome.wheels[slot] : null;
  const dim = dimensiones(genome);
  const [fmin, fmax] = factorPermitido(genome);
  const puedeCrecer = 1 + TAMANO_STEP <= fmax;
  const puedeEncoger = 1 - TAMANO_STEP >= fmin;
  const cambiaTamano = (sentido: 1 | -1) => {
    markInput("tamano");
    handle.current?.medir("tamano");
    props.onGenome(escalarCoche(genome, 1 + sentido * TAMANO_STEP));
  };
  const nota = (sentido: 1 | -1): string | null => {
    if ((sentido === 1 ? puedeCrecer : puedeEncoger)) return null;
    const p = piezaLimitante(genome, sentido, TAMANO_STEP);
    if (!p) return null;
    const verbo = sentido === 1 ? "crecer" : "encoger";
    const pieza = p.tipo === "punto" ? `el punto ${p.indice + 1} ya mide ${formatDecimal(p.medida, 1)} m` : `el radio de la rueda ${p.indice + 1} ya mide ${formatDecimal(p.medida, 1)} m`;
    return `No puede ${verbo} más: ${pieza}`;
  };
  const notaTamano = nota(1) ?? nota(-1);
  const ajustar = (nuevo: Genome, evento: string) => {
    markInput(evento);
    handle.current?.medir(evento);
    props.onGenome(nuevo);
  };
  const grados = (rad: number) => `${formatDecimal((rad * 180) / Math.PI, 0)}°`;
  const inclinacion = wheel ? inclinacionDeEje(wheel.axisAngle) : 0;
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
        {rendimiento && <PanelRendimiento />}
        <div className="cabecera">
          <button type="button" className="pastilla" onClick={props.onBack} data-testid="volver">
            ← Volver
          </button>
          <button
            type="button"
            className="pastilla chica"
            aria-expanded={colores}
            aria-label={`Color: ${PALETA_COCHES[props.identidad.color].nombre}`}
            data-testid="taller-color"
            onClick={() => setColores((v) => !v)}
          >
            <MuestraColor color={props.identidad.color} />
          </button>
          <button type="button" className="pastilla chica nombre-taller" data-testid="taller-nombre" onClick={props.onRenombrar}>
            {props.identidad.nombre}
          </button>
          <button
            type="button"
            className="pastilla chica"
            data-testid="coche-nuevo"
            onClick={() => {
              if (genomeHash(genome) === genomeHash(STOCK_CAR)) props.onNuevo();
              else setConfirmarNuevo(true);
            }}
          >
            Coche nuevo
          </button>
          {colores && (
            <div className="fila-colores" role="group" aria-label="Color del coche" data-testid="fila-colores">
              {COLORES_COCHE.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="selector selector-color"
                  aria-pressed={props.identidad.color === c}
                  aria-label={PALETA_COCHES[c].nombre}
                  data-testid={`color-${c}`}
                  data-color={c}
                  style={{ background: PALETA_COCHES[c].hex }}
                  onClick={() => {
                    markInput("color-coche");
                    props.onColor(c);
                    // Se cierra al elegir: abierta tapa el coche en el móvil y el color nuevo no se vería.
                    setColores(false);
                  }}
                >
                  {props.identidad.color === c ? "✓" : ""}
                </button>
              ))}
            </div>
          )}
        </div>
        {confirmarNuevo && (
          <div className="confirmar-nuevo" role="alertdialog" aria-label="Coche nuevo" data-testid="confirmar-nuevo">
            <p>Se perderá el diseño actual si no lo guardas</p>
            <div className="acciones">
              <button
                type="button"
                className="boton-primario"
                data-testid="confirmar-nuevo-si"
                onClick={() => {
                  setConfirmarNuevo(false);
                  setVertice(null);
                  runtime.verticeSeleccionado = null;
                  props.onNuevo();
                }}
              >
                Sí, coche nuevo
              </button>
              <button type="button" className="boton-secundario" data-testid="confirmar-nuevo-no" onClick={() => setConfirmarNuevo(false)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
        {showHelp && (
          <p className="ayuda-taller" data-testid="ayuda-taller" role="note">
            {AYUDA_TALLER}
          </p>
        )}
        <div className="fuerzas-lienzo">
          <button
            type="button"
            className="selector ver-fuerzas"
            aria-pressed={fuerzas}
            data-testid="ver-fuerzas"
            onClick={() => {
              markInput("ver-fuerzas");
              setFuerzas((v) => !v);
            }}
          >
            {fuerzas ? "✓ " : ""}Ver fuerzas
          </button>
          {fuerzas && (
            <p className="leyenda-fuerzas" data-testid="leyenda-fuerzas" role="note">
              ◐ centro de masas · peso · par · más largo = más fuerza
            </p>
          )}
        </div>
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
        <section className="grupo-panel" aria-label="Tu coche" data-testid="grupo-coche">
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
                onClick={() => {
                  setVertice(genome.wheels[i].vertex);
                  runtime.verticeSeleccionado = genome.wheels[i].vertex;
                }}
              >
                Rueda {n + 1}
              </button>
            ))}
          </div>
          {vertice !== null && (
            <div className="punto-panel" role="group" aria-labelledby="punto-titulo" data-testid="panel-punto">
              <h3 id="punto-titulo" data-testid="punto-titulo">
                Punto {vertice + 1}
              </h3>
              <div className="paso-control">
                <span>Ángulo: {grados(genome.body[vertice].angle)}</span>
                <button
                  type="button"
                  className="boton-secundario paso"
                  aria-label="Ángulo menos"
                  data-testid="angulo-menos"
                  disabled={ajustarAngulo(genome, vertice, -ANGLE_STEP).body[vertice].angle === genome.body[vertice].angle}
                  onClick={() => ajustar(ajustarAngulo(genome, vertice, -ANGLE_STEP), "ajustar-punto")}
                >
                  −
                </button>
                <button
                  type="button"
                  className="boton-secundario paso"
                  aria-label="Ángulo más"
                  data-testid="angulo-mas"
                  disabled={ajustarAngulo(genome, vertice, ANGLE_STEP).body[vertice].angle === genome.body[vertice].angle}
                  onClick={() => ajustar(ajustarAngulo(genome, vertice, ANGLE_STEP), "ajustar-punto")}
                >
                  +
                </button>
              </div>
              <div className="paso-control">
                <span data-testid="etiqueta-longitud">Longitud: {formatDecimal(genome.body[vertice].length, 1)} m</span>
                <button
                  type="button"
                  className="boton-secundario paso"
                  aria-label="Longitud menos"
                  data-testid="longitud-menos"
                  disabled={ajustarLongitud(genome, vertice, -LENGTH_STEP).body[vertice].length === genome.body[vertice].length}
                  onClick={() => ajustar(ajustarLongitud(genome, vertice, -LENGTH_STEP), "ajustar-punto")}
                >
                  −
                </button>
                <button
                  type="button"
                  className="boton-secundario paso"
                  aria-label="Longitud más"
                  data-testid="longitud-mas"
                  disabled={ajustarLongitud(genome, vertice, LENGTH_STEP).body[vertice].length === genome.body[vertice].length}
                  onClick={() => ajustar(ajustarLongitud(genome, vertice, LENGTH_STEP), "ajustar-punto")}
                >
                  +
                </button>
              </div>
              {slot === null ? (
                <button
                  type="button"
                  className="boton-secundario"
                  disabled={wheels >= MAX_WHEELS}
                  data-testid="poner-rueda"
                  onClick={() => ajustar(ponerRueda(genome, vertice), "poner-rueda")}
                >
                  {wheels >= MAX_WHEELS ? "Máximo 4 ruedas" : "Poner rueda aquí"}
                </button>
              ) : (
                <button
                  type="button"
                  className="boton-secundario"
                  data-testid="quitar-rueda"
                  onClick={() => ajustar(quitarRueda(genome, vertice), "poner-rueda")}
                >
                  Quitar rueda
                </button>
              )}
            </div>
          )}
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
                <span className="lectura-suspension" data-testid="lectura-suspension">
                  Inclinación de la suspensión: {lecturaInclinacion(inclinacion)}
                </span>
                <input
                  type="range"
                  data-testid="deslizador-suspension"
                  aria-label="Inclinación de la suspensión"
                  min={-90}
                  max={90}
                  step={1}
                  value={Math.round(inclinacion)}
                  onChange={(e) => {
                    ajustar(setWheelAxis(genome, slot, ejeDeInclinacion(Number(e.target.value))), "inclinar-suspension");
                  }}
                />
                <small className="nota-peso" data-testid="nota-suspension">
                  La rueda sube y baja por la guía dibujada. Vertical amortigua baches; inclinada hacia atrás cede al chocar de frente.
                </small>
              </label>
            </>
          )}
          <div className="paso-control" role="group" aria-label="Tamaño del coche">
            <span data-testid="lectura-tamano">
              Tamaño: Largo {formatDecimal(dim.largo, 1)} m · Alto {formatDecimal(dim.alto, 1)} m
            </span>
            <button
              type="button"
              className="boton-secundario paso"
              aria-label="Tamaño menos"
              disabled={!puedeEncoger}
              data-testid="tamano-menos"
              onClick={() => cambiaTamano(-1)}
            >
              Tamaño −
            </button>
            <button
              type="button"
              className="boton-secundario paso"
              aria-label="Tamaño más"
              disabled={!puedeCrecer}
              data-testid="tamano-mas"
              onClick={() => cambiaTamano(1)}
            >
              Tamaño +
            </button>
          </div>
          {notaTamano && (
            <small className="nota-peso" role="status" data-testid="nota-tamano">
              {notaTamano}
            </small>
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
        </section>
        <section className="grupo-panel" aria-label="Probar" data-testid="grupo-prueba">
          <span className="etiqueta-grupo">Pista para probar</span>
          <TrackPicker value={props.trackId} onChange={props.onTrack} rankings={props.rankings} comoSelector />
          <button
            type="button"
            className="boton-primario"
            data-testid="probar"
            onClick={() => {
              markInput("probar");
              props.onTry();
            }}
          >
            Probar
          </button>
        </section>
        <section className="grupo-panel fila acciones-taller" aria-label="Guardar" data-testid="grupo-guardado">
          <button type="button" className="boton-secundario" data-testid="guardar" onClick={guardar}>
            Guardar en el garaje
          </button>
          <button
            type="button"
            className="boton-secundario"
            data-testid="evolucionar"
            onClick={() => {
              markInput("evolucionar");
              props.onEvolve();
            }}
          >
            Evolucionar este coche
          </button>
        </section>
      </div>
    </div>
  );
}
