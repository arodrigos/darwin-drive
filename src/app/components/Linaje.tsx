"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatMeters } from "@/app/format";
import type { EvolutionState } from "@/evolution/ga";
import type { LineageNode } from "@/evolution/lineage";
import { layoutLineage, NODE_HEIGHT, NODE_WIDTH, type LineageLayout } from "@/app/lineage-layout";
import { markInput, measureOnNextFrame } from "@/debug/latencias";
import { getTrack, TRACKS } from "@/sim/tracks";
import type { Rankings, SavedCar } from "@/storage/schema";

export const LINAJE_VACIO = "Aún no hay árbol: evoluciona una población o guarda un coche para ver de dónde viene.";

const BASE_Y = 8;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_PASO = 1.25;
// Un gesto que se mueve menos que esto sigue siendo un toque, no un desplazamiento.
const UMBRAL_ARRASTRE = 6;

export interface OpcionLinaje {
  key: string;
  label: string;
  rootId: string;
}

/** Los coches de los que se puede pintar el linaje: n.º 1 de cada pista, campeón de la evolución y coches del garaje. */
export function opcionesLinaje(nodes: LineageNode[], rankings: Rankings, garage: SavedCar[], evolucion: EvolutionState | null): OpcionLinaje[] {
  const ids = new Set(nodes.map((n) => n.id));
  const out: OpcionLinaje[] = [];
  for (const t of TRACKS) {
    const id = rankings[t.id][0]?.lineageId;
    if (id && ids.has(id)) out.push({ key: `top:${t.id}`, label: `n.º 1 de ${t.name}`, rootId: id });
  }
  const campeon = evolucion?.history[evolucion.history.length - 1]?.bestId;
  if (campeon && ids.has(campeon)) out.push({ key: "campeon", label: "campeón actual", rootId: campeon });
  for (const c of garage) {
    if (c.lineageId && ids.has(c.lineageId)) out.push({ key: `garaje:${c.id}`, label: `coche del garaje: ${c.name}`, rootId: c.lineageId });
  }
  return out;
}

/** «Cordillera», «Dunas»…: el nombre de la pista sin artículo, para que quepa en un nodo. */
export function nombreCorto(trackId: LineageNode["trackId"]): string {
  const t = trackId ? getTrack(trackId) : null;
  return t ? t.name.replace(/^(La|Las|El|Los) /, "") : "sin medir";
}

export function etiquetaMano(node: LineageNode): string | null {
  if (node.op === "design") return "✋ diseño";
  if (node.op === "retouch") return "✋ retoque";
  return null;
}

function Coche({ node }: { node: LineageNode }) {
  const S = 8;
  const pts = node.genome.body.map((v) => [Math.cos(v.angle) * v.length * S, -Math.sin(v.angle) * v.length * S] as const);
  return (
    <g transform={`translate(${NODE_WIDTH / 2} 21)`} aria-hidden="true">
      <polygon points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} fill={`hsl(${node.hue} 70% 55%)`} stroke="#1b1b1b" strokeWidth="1.5" />
      {node.genome.wheels
        .filter((w) => w.vertex >= 0)
        .map((w, i) => (
          <circle key={i} cx={pts[w.vertex][0]} cy={pts[w.vertex][1]} r={Math.max(2, w.radius * S)} fill="#222" stroke="#fff" strokeWidth="1" />
        ))}
    </g>
  );
}

function trazo(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

export interface LinajeProps {
  nodes: LineageNode[];
  rankings: Rankings;
  garage: SavedCar[];
  evolucion: EvolutionState | null;
  /** Opción elegida y nodo abierto: viven en App para sobrevivir a «Ver correr». */
  seleccion: string | null;
  onSeleccion: (key: string) => void;
  nodoId: string | null;
  onNodo: (id: string | null) => void;
  onBack: () => void;
  onWatch: (node: LineageNode) => void;
  onOpenInWorkshop: (node: LineageNode) => void;
  /** Devuelve el texto del aviso que debe leerse tras guardar. */
  onSaveToGarage: (node: LineageNode) => Promise<string>;
  onEvolucion: () => void;
}

export function Linaje(props: LinajeProps) {
  const { nodes } = props;
  const opciones = useMemo(
    () => opcionesLinaje(nodes, props.rankings, props.garage, props.evolucion),
    [nodes, props.rankings, props.garage, props.evolucion],
  );
  const opcion = opciones.find((o) => o.key === props.seleccion) ?? opciones[0] ?? null;
  // Desplazamiento respecto a la posición base (centrado, arriba) y zoom; `para` dice de qué árbol son.
  const [vista, setVista] = useState<{ para: LineageLayout | null; zoom: number; x: number; y: number }>({ para: null, zoom: 1, x: 0, y: 0 });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrastre = useRef<{ id: number; x: number; y: number; px: number; py: number; movido: boolean } | null>(null);
  const huboArrastre = useRef(false);
  const lienzo = useRef<HTMLDivElement>(null);

  const layout = useMemo<LineageLayout | null>(() => {
    if (!opcion) return null;
    performance.mark("dd:linaje:disposicion:inicio");
    const l = layoutLineage(opcion.rootId, nodes);
    performance.mark("dd:linaje:disposicion:fin");
    performance.measure("dd:linaje:disposicion", "dd:linaje:disposicion:inicio", "dd:linaje:disposicion:fin");
    return l;
  }, [opcion, nodes]);

  // Al cambiar de árbol se vuelve arriba (la generación más antigua) y con el zoom por defecto.
  if (vista.para !== layout) setVista({ para: layout, zoom: 1, x: 0, y: 0 });
  const { zoom, x: posX, y: posY } = vista;

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const nodo = layout?.nodes.find((p) => p.node.id === props.nodoId)?.node ?? null;
  useEffect(() => {
    if (nodo) measureOnNextFrame("abrir-nodo");
  }, [nodo]);

  const cambiarZoom = (factor: number) => {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    const caja = lienzo.current;
    if (!caja || !layout) return setVista((v) => ({ ...v, zoom: z }));
    // El zoom se ancla al centro de lo que se ve, no a la esquina del árbol.
    const cx = caja.clientWidth / 2;
    const cy = caja.clientHeight / 2;
    const baseX = (caja.clientWidth - layout.width) / 2;
    const ox = baseX + posX;
    const oy = BASE_Y + posY;
    setVista({ para: layout, zoom: z, x: cx - ((cx - ox) / zoom) * z - baseX, y: cy - ((cy - oy) / zoom) * z - BASE_Y });
  };

  const guardar = async (n: LineageNode) => {
    setToast(await props.onSaveToGarage(n));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  };

  const porId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  return (
    <div className="linaje" data-testid="linaje">
      <div className="rankings-cabecera">
        <button type="button" className="pastilla" onClick={props.onBack} data-testid="volver">
          ← Volver
        </button>
        <h2>Linaje</h2>
      </div>
      {!opcion || !layout ? (
        <div className="ranking-vacio" data-testid="linaje-vacio">
          <p>{LINAJE_VACIO}</p>
          <button type="button" className="pastilla principal" onClick={props.onEvolucion} data-testid="vacio-evolucion">
            Evolución
          </button>
        </div>
      ) : (
        <>
          <div className="linaje-barra">
            <label>
              Linaje de:{" "}
              <select
                value={opcion.key}
                data-testid="linaje-selector"
                onChange={(e) => {
                  props.onSeleccion(e.target.value);
                  props.onNodo(null);
                }}
              >
                {opciones.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="linaje-zoom">
              <button type="button" className="pastilla chica" aria-label="Alejar" data-testid="zoom-menos" onClick={() => cambiarZoom(1 / ZOOM_PASO)}>
                −
              </button>
              <button type="button" className="pastilla chica" aria-label="Acercar" data-testid="zoom-mas" onClick={() => cambiarZoom(ZOOM_PASO)}>
                +
              </button>
            </div>
          </div>
          <div
            ref={lienzo}
            className="linaje-lienzo"
            data-testid="linaje-lienzo"
            data-capas={layout.layers}
            data-nodos={layout.nodes.length}
            onPointerDown={(e) => {
              arrastre.current = { id: e.pointerId, x: posX, y: posY, px: e.clientX, py: e.clientY, movido: false };
            }}
            onPointerMove={(e) => {
              const a = arrastre.current;
              if (!a || a.id !== e.pointerId) return;
              const dx = e.clientX - a.px;
              const dy = e.clientY - a.py;
              if (!a.movido && Math.hypot(dx, dy) < UMBRAL_ARRASTRE) return;
              a.movido = true;
              setVista((v) => ({ ...v, x: a.x + dx, y: a.y + dy }));
            }}
            onPointerUp={() => {
              // El click del nodo llega después del pointerup: se deja marcado un instante para ignorarlo.
              huboArrastre.current = arrastre.current?.movido ?? false;
              arrastre.current = null;
              setTimeout(() => {
                huboArrastre.current = false;
              }, 0);
            }}
            onPointerCancel={() => {
              arrastre.current = null;
            }}
          >
            <svg width={layout.width} height={layout.height} className="linaje-svg" data-testid="linaje-svg" style={{ left: "50%", top: BASE_Y, marginLeft: -layout.width / 2, transform: `translate(${posX}px, ${posY}px) scale(${zoom})` }}>
              <defs>
                <marker id="flecha-linaje" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" fill="#9fb4c8" />
                </marker>
              </defs>
              {layout.edges.map((e) => (
                <path key={`${e.from}>${e.to}`} d={trazo(e.points)} className="arista" data-testid="arista" data-desde={e.from} data-hasta={e.to} fill="none" stroke="#9fb4c8" strokeWidth="1.5" markerEnd="url(#flecha-linaje)" />
              ))}
              {layout.nodes.map((p) => {
                const n = p.node;
                const mano = etiquetaMano(n);
                const x = p.x - NODE_WIDTH / 2;
                const y = p.y - NODE_HEIGHT / 2;
                return (
                  <g key={n.id} transform={`translate(${x} ${y})`}>
                    {n.prunedParents && (
                      <g data-testid="podados">
                        <line x1={NODE_WIDTH / 2} y1={0} x2={NODE_WIDTH / 2} y2={-14} stroke="#9fb4c8" strokeWidth="1.5" strokeDasharray="3 3" />
                        <text x={NODE_WIDTH / 2} y={-16} textAnchor="middle" fontSize="12" fill="#9fb4c8">
                          antepasados podados
                        </text>
                      </g>
                    )}
                    <g
                      className="nodo-linaje"
                      role="button"
                      tabIndex={0}
                      aria-label={`Generación ${n.generation}${n.distance !== null ? `, ${formatMeters(n.distance)}` : ""}`}
                      aria-pressed={n.id === props.nodoId}
                      data-testid="nodo-linaje"
                      data-id={n.id}
                      data-op={n.op}
                      data-generacion={n.generation}
                      data-capa={p.layer}
                      data-padres={n.parents.length}
                      onClick={() => {
                        // Un toque que cierra un desplazamiento no abre nada.
                        if (huboArrastre.current) return;
                        markInput("abrir-nodo");
                        props.onNodo(n.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          markInput("abrir-nodo");
                          props.onNodo(n.id);
                        }
                      }}
                    >
                      <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx="8" fill="#1d2d3d" stroke={n.id === props.nodoId ? "#ffd23f" : "#4b6178"} strokeWidth={n.id === props.nodoId ? 3 : 1.5} />
                      <Coche node={n} />
                      <text x={NODE_WIDTH / 2} y="52" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff" data-testid="nodo-distancia">
                        {n.distance !== null ? formatMeters(n.distance) : "—"}
                      </text>
                      <text x={NODE_WIDTH / 2} y="64" textAnchor="middle" fontSize="12" fill="#cfdceb" data-testid="nodo-pista">
                        {nombreCorto(n.trackId)} g{n.generation}
                      </text>
                      {mano && (
                        <text x={NODE_WIDTH / 2} y="75" textAnchor="middle" fontSize="12" fontWeight="700" fill="#ffd23f" data-testid="nodo-mano">
                          {mano}
                        </text>
                      )}
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
      {nodo && (
        <div className="hoja-fila" role="dialog" aria-label="Detalle del nodo" data-testid="hoja-nodo">
          <h3 data-testid="hoja-titulo">Generación {nodo.generation}</h3>
          <p>
            <strong data-testid="hoja-distancia">{nodo.distance !== null ? formatMeters(nodo.distance) : "sin medir"}</strong> ·{" "}
            <span data-testid="hoja-pista">{nodo.trackId ? (getTrack(nodo.trackId)?.name ?? nodo.trackId) : "sin pista"}</span>
            {etiquetaMano(nodo) && <> · {etiquetaMano(nodo)}</>}
          </p>
          <p data-testid="hoja-padres">
            {nodo.parents.length === 0
              ? nodo.prunedParents
                ? "Sus antepasados se podaron."
                : "Sin padres."
              : (
                <>
                  {nodo.parents.length === 1 ? "Padre: " : "Padres: "}
                  {nodo.parents.map((id, i) => {
                    const p = porId.get(id);
                    return (
                      <span key={id} data-testid="hoja-padre">
                        {i > 0 && " y "}
                        {p ? `gen ${p.generation}${p.distance !== null ? ` (${formatMeters(p.distance)})` : ""}` : "podado"}
                      </span>
                    );
                  })}
                </>
              )}
          </p>
          <div className="acciones">
            {/* Sin pista medida no hay dónde repetir la carrera: la distancia anotada es de una pista concreta. */}
            <button type="button" className="pastilla principal" disabled={nodo.trackId === null} onClick={() => props.onWatch(nodo)} data-testid="ver-correr">
              Ver correr
            </button>
            <button type="button" className="pastilla" onClick={() => props.onOpenInWorkshop(nodo)} data-testid="abrir-taller">
              Abrir en el taller
            </button>
            <button type="button" className="pastilla" onClick={() => void guardar(nodo)} data-testid="guardar-garaje">
              Guardar en el garaje
            </button>
            <button type="button" className="pastilla" onClick={() => props.onNodo(null)} data-testid="cerrar-hoja">
              Cerrar
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div className="aviso-arriba" role="status" data-testid="aviso-guardado">
          {toast}
        </div>
      )}
    </div>
  );
}
