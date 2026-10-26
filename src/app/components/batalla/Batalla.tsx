"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runtime } from "@/debug/ganchos";
import { aleatorioDeApp, generarNombre } from "@/app/nombres";
import { crearBatalla, transicion, type AccionBatalla, type EstadoBatalla } from "@/batalla/estado";
import { borrarBatalla, guardarBatalla } from "@/batalla/guardado";
import { resultadoCrudo } from "@/batalla/carrera";
import type { ColorCoche, IdentidadCoche } from "@/game/colores-coche";
import { markInput } from "@/debug/latencias";
import type { CarResult } from "@/sim/constants";
import { genomeHash, normalizeGenome, STOCK_CAR, type Genome } from "@/sim/genome";
import type { RitmoRecordado } from "@/storage/meta";
import { normalizarNombre } from "@/storage/nombres";
import { HojaNombre } from "../HojaNombre";
import { Taller } from "../Taller";
import { Carrera } from "./Carrera";
import { Configurar } from "./Configurar";
import { ElegirPista } from "./ElegirPista";
import { Relevo } from "./Relevo";
import { Resultado } from "./Resultado";

/** Coche de serie con un nombre aleatorio y el color del jugador: así empieza cada turno, sin rastro de los anteriores. */
function identidadInicial(color: ColorCoche): IdentidadCoche {
  return { nombre: generarNombre(aleatorioDeApp()), color };
}

/** Un coche que acaba de correr, con lo que hace falta para inscribirlo en el ranking o guardarlo en el garaje. */
export interface CocheCorrido {
  jugador: number;
  genome: Genome;
  nombre: string;
  color: ColorCoche;
  result: CarResult;
}

export interface BatallaProps {
  /** Batalla guardada que se retoma; null abre Configurar. */
  inicial: EstadoBatalla | null;
  /** Una recarga en pleno turno vuelve al relevo: lo avisa. */
  reiniciado: boolean;
  /** Cada transición, para que la portada sepa si hay algo que continuar. */
  onEstado: (e: EstadoBatalla | null) => void;
  /** Sale conservando lo guardado. */
  onSalir: () => void;
  helpSeen: boolean;
  onHelpSeen: () => void;
  ritmoInicial?: RitmoRecordado;
  onRitmo?: (r: RitmoRecordado) => void;
  /** Cada coche entra en el ranking de la pista al correr, por el mismo camino que «Probar». */
  onInscribir: (coches: CocheCorrido[]) => Promise<void>;
  /** Lleva coches al garaje (con su nombre y color) y devuelve el aviso. */
  onGuardar: (coches: Omit<CocheCorrido, "result">[]) => Promise<string>;
}

export function Batalla(props: BatallaProps) {
  const [estado, setEstado] = useState<EstadoBatalla | null>(props.inicial);
  const [reiniciado, setReiniciado] = useState(props.reiniciado);
  const [genome, setGenome] = useState<Genome>(STOCK_CAR);
  const [identidad, setIdentidad] = useState<IdentidadCoche>(() => identidadInicial("naranja"));
  const [renombrando, setRenombrando] = useState(false);
  const [abandonando, setAbandonando] = useState(false);
  const { onEstado } = props;
  // Cada carrera (la primera, una revancha) monta una escena nueva.
  const [carreraKey, setCarreraKey] = useState(0);
  const publicado = useRef<EstadoBatalla | null | undefined>(undefined);

  // El estado se guarda en cada cambio: una recarga o un bloqueo de pantalla vuelve al último relevo.
  useEffect(() => {
    runtime.batalla = estado;
    if (publicado.current === estado) return;
    publicado.current = estado;
    onEstado(estado);
    if (estado) void guardarBatalla(estado);
  }, [estado, onEstado]);

  useEffect(
    () => () => {
      runtime.genomaEnTaller = null;
    },
    [],
  );

  const aplicar = useCallback((e: EstadoBatalla, a: AccionBatalla): EstadoBatalla => transicion(e, a), []);

  const abandonar = useCallback(async () => {
    setAbandonando(false);
    // Borra también los nombres de los jugadores: no deben quedar en el dispositivo.
    await borrarBatalla();
    runtime.batalla = null;
    onEstado(null);
    props.onSalir();
  }, [onEstado, props]);

  if (estado === null) {
    return (
      <Configurar
        onVolver={props.onSalir}
        onEmpezar={(fichas) => {
          const nueva = crearBatalla(fichas, crypto.randomUUID(), new Date().toISOString());
          setReiniciado(false);
          setEstado(aplicar(nueva, { tipo: "empezar" }));
        }}
      />
    );
  }

  const dialogoAbandono = abandonando && (
    <div className="capa-fondo" data-testid="confirmar-abandono-fondo">
      <div className="ayuda-panel" role="alertdialog" aria-modal="true" aria-label="Abandonar batalla" data-testid="confirmar-batalla">
        <p data-testid="confirmar-batalla-texto">Se perderá la batalla entera, también los coches de los demás.</p>
        <div className="acciones">
          <button type="button" className="boton-primario" data-testid="confirmar-batalla-si" onClick={() => void abandonar()}>
            Sí, abandonar
          </button>
          <button type="button" className="boton-secundario" data-testid="confirmar-batalla-no" onClick={() => setAbandonando(false)}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );

  const jugador = estado.jugadores[estado.activo];

  if (estado.fase === "relevo") {
    return (
      <>
        <Relevo
          jugador={jugador}
          reiniciado={reiniciado}
          onEmpezar={() => {
            // Cada turno parte del coche de serie: lo que diseñó el jugador anterior no se ve ni en el Taller.
            const g = normalizeGenome(STOCK_CAR);
            runtime.genomaEnTaller = g;
            setGenome(g);
            setIdentidad(identidadInicial(jugador.color));
            setReiniciado(false);
            setEstado(aplicar(estado, { tipo: "comenzar-turno" }));
          }}
          onSalir={props.onSalir}
          onAbandonar={() => setAbandonando(true)}
        />
        {dialogoAbandono}
      </>
    );
  }

  if (estado.fase === "turno") {
    const ocupados = estado.jugadores.filter((_, i) => i !== estado.activo).map((j) => j.color);
    return (
      <>
        <Taller
          modo="batalla"
          genome={genome}
          onGenome={(g) => {
            const n = normalizeGenome(g);
            runtime.genomaEnTaller = n;
            setGenome(n);
          }}
          identidad={identidad}
          onColor={(color) => setIdentidad((i) => ({ ...i, color }))}
          onRenombrar={() => setRenombrando(true)}
          helpSeen={props.helpSeen}
          onHelpSeen={props.onHelpSeen}
          onBack={props.onSalir}
          batalla={{
            cabecera: `Batalla · ${jugador.nombre} (${estado.activo + 1} de ${estado.jugadores.length})`,
            coloresOcupados: ocupados,
            onTerminar: () => {
              // El color que eligió en el Taller pasa a ser el del jugador, que es el que pinta su coche en la carrera.
              const conColor = { ...estado, jugadores: estado.jugadores.map((j, i) => (i === estado.activo ? { ...j, color: identidad.color } : j)) };
              runtime.genomaEnTaller = null;
              setEstado(aplicar(conColor, { tipo: "terminar-coche", genome, nombre: identidad.nombre }));
            },
            onAbandonar: () => void abandonar(),
          }}
        />
        {renombrando && (
          <HojaNombre
            modo="renombrar"
            valorInicial={identidad.nombre}
            ficha={`Coche de ${jugador.nombre} en la batalla`}
            exigirTexto
            onGuardar={async (valor) => {
              setIdentidad((i) => ({ ...i, nombre: normalizarNombre(valor, i.nombre) }));
              setRenombrando(false);
            }}
            onCerrar={() => setRenombrando(false)}
          />
        )}
      </>
    );
  }

  if (estado.fase === "elegir-pista") {
    return (
      <>
        <ElegirPista
          jugadores={estado.jugadores}
          pista={estado.pista}
          onPista={(id) => setEstado(aplicar(estado, { tipo: "elegir-pista", pista: id }))}
          onCorrer={() => {
            markInput("a-correr");
            setCarreraKey((k) => k + 1);
            setEstado(aplicar(estado, { tipo: "correr" }));
          }}
          onSalir={props.onSalir}
          onAbandonar={() => setAbandonando(true)}
        />
        {dialogoAbandono}
      </>
    );
  }

  if (estado.fase === "carrera" && estado.pista) {
    const alTerminar = (results: CarResult[]) => {
      if (estado.fase !== "carrera") return;
      const corridos: CocheCorrido[] = results.map((r) => {
        const idx = resultadoCrudo(r).jugador;
        const j = estado.jugadores[idx];
        return { jugador: idx, genome: j.coche!.genome, nombre: j.coche!.nombre, color: j.color, result: { ...r, carId: genomeHash(j.coche!.genome) } };
      });
      // La inscripción no frena el podio: si la migración de marcas está en curso, espera en su cola.
      void props.onInscribir(corridos);
      setEstado(aplicar(estado, { tipo: "terminar-carrera", resultados: results.map(resultadoCrudo) }));
    };
    return (
      <Carrera
        key={carreraKey}
        trackId={estado.pista}
        jugadores={estado.jugadores}
        onTerminada={alTerminar}
        onSalir={props.onSalir}
        ritmoInicial={props.ritmoInicial}
        onRitmo={props.onRitmo}
      />
    );
  }

  return (
    <>
      <Resultado
        estado={estado}
        onGuardar={(jugadores) =>
          props.onGuardar(
            jugadores.map((i) => {
              const j = estado.jugadores[i];
              return { jugador: i, genome: j.coche!.genome, nombre: j.coche!.nombre, color: j.color };
            }),
          )
        }
        onRevancha={() => {
          setCarreraKey((k) => k + 1);
          setEstado(aplicar(estado, { tipo: "revancha" }));
        }}
        onOtraPista={() => setEstado(aplicar(estado, { tipo: "otra-pista" }))}
        onSalir={() => void abandonar()}
      />
      {dialogoAbandono}
    </>
  );
}
