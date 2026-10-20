"use client";

import { useEffect, useRef, useState } from "react";
import { COPIA_INVALIDA, COPIA_MAX_BYTES, crearCopia, nombreFicheroCopia, validarCopia } from "@/storage/copia";
import { leerGuardado, persistente, reemplazarTodo } from "@/storage/store";
import { runtime } from "@/debug/ganchos";

export const TEXTO_PERSISTENTE = "Guardado persistente en este dispositivo";
export const TEXTO_NO_PERSISTENTE =
  "Safari puede borrar el guardado si pasas 7 días sin jugar. Añade el juego a la pantalla de inicio o exporta una copia.";
export const TEXTO_PERSISTENCIA_DESCONOCIDA =
  "Este navegador no dice si el guardado es duradero. Exporta una copia de vez en cuando para no perder tu garaje.";
export const PASOS_PANTALLA_INICIO =
  "En Safari: toca Compartir y luego «Añadir a pantalla de inicio». En Chrome: menú ⋮ y «Instalar aplicación».";

function textoEstado(p: boolean | "unknown"): string {
  if (p === true) return TEXTO_PERSISTENTE;
  return p === false ? TEXTO_NO_PERSISTENTE : TEXTO_PERSISTENCIA_DESCONOCIDA;
}

function descargar(nombre: string, texto: string): void {
  const url = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revocar en el mismo turno cancelaría la descarga en algunos navegadores.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Mensaje = { tipo: "ok" | "error"; texto: string } | null;

/** «Estado del guardado» y la copia de seguridad en fichero. */
export function CopiaSeguridad(props: { almacenDisponible: boolean; onImportada: () => Promise<void> }) {
  const [estado, setEstado] = useState<boolean | "unknown" | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [pendiente, setPendiente] = useState<{ data: Record<string, unknown>; resumen: string } | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    void persistente().then((p) => {
      runtime.persistente = p;
      if (vivo) setEstado(p);
    });
    return () => {
      vivo = false;
    };
  }, []);

  async function exportar() {
    const data = await leerGuardado();
    const ahora = new Date();
    const nombre = nombreFicheroCopia(ahora);
    descargar(nombre, JSON.stringify(crearCopia(data, ahora)));
    setPendiente(null);
    setMensaje({ tipo: "ok", texto: `Copia exportada: ${nombre}` });
  }

  async function elegido(fichero: File | undefined) {
    if (!fichero) return;
    setPendiente(null);
    // El tope se mira antes de leer: un fichero enorme no llega a la memoria.
    if (fichero.size > COPIA_MAX_BYTES) {
      setMensaje({ tipo: "error", texto: COPIA_INVALIDA });
      return;
    }
    const resultado = validarCopia(await fichero.text(), fichero.size);
    if (!resultado.ok) {
      setMensaje({ tipo: "error", texto: resultado.motivo });
      return;
    }
    setMensaje(null);
    setPendiente({ data: resultado.data, resumen: resultado.resumen });
  }

  async function reemplazar() {
    if (!pendiente) return;
    const { data, resumen } = pendiente;
    setPendiente(null);
    await reemplazarTodo(data);
    await props.onImportada();
    setMensaje({ tipo: "ok", texto: `Copia importada: ${resumen}.` });
  }

  return (
    <section className="copia" data-testid="copia-seguridad" aria-labelledby="copia-titulo">
      <h3 id="copia-titulo">Estado del guardado</h3>
      <p data-testid="estado-guardado" data-persistente={String(estado)}>
        {!props.almacenDisponible
          ? "Este navegador no deja guardar en el dispositivo: lo que hagas se perderá al cerrar."
          : estado === null
            ? "Comprobando…"
            : textoEstado(estado)}
      </p>
      {estado !== true && props.almacenDisponible && estado !== null && (
        <p className="pasos" data-testid="pasos-pantalla-inicio">
          {PASOS_PANTALLA_INICIO}
        </p>
      )}
      <div className="acciones-copia">
        <button type="button" className="pastilla chica" onClick={() => void exportar()} data-testid="copia-exportar">
          Exportar copia
        </button>
        <button type="button" className="pastilla chica" onClick={() => entrada.current?.click()} data-testid="copia-importar">
          Importar copia
        </button>
        <input
          ref={entrada}
          type="file"
          accept="application/json,.json"
          hidden
          data-testid="copia-fichero"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            // Sin vaciarlo, elegir otra vez el mismo fichero no dispara el evento.
            e.currentTarget.value = "";
            void elegido(f);
          }}
        />
      </div>
      {pendiente && (
        <div className="confirmar-copia" role="alertdialog" aria-label="Importar copia" data-testid="copia-confirmacion">
          <p>
            Esta copia trae {pendiente.resumen}. Se reemplazará todo lo que hay guardado ahora en este dispositivo.
          </p>
          <div className="acciones-copia">
            <button type="button" className="pastilla chica principal" onClick={() => void reemplazar()} data-testid="copia-reemplazar">
              Reemplazar todo
            </button>
            <button type="button" className="pastilla chica" onClick={() => setPendiente(null)} data-testid="copia-cancelar">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {mensaje && (
        <p role={mensaje.tipo === "error" ? "alert" : "status"} className={`mensaje-copia ${mensaje.tipo}`} data-testid={mensaje.tipo === "error" ? "copia-error" : "copia-ok"}>
          {mensaje.texto}
        </p>
      )}
    </section>
  );
}
