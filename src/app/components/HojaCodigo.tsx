"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { decodificarCoche, type CocheCompartible, type MotivoRechazo } from "@/app/codigo-coche";
import { markInput, measureOnNextFrame } from "@/debug/latencias";

export const AYUDA_CODIGO = "Pega un código que empiece por DD1.";
export const AVISO_CODIGO_COPIADO = "Código copiado. Pégalo en «Importar coche» en el otro dispositivo";
export const AVISO_CODIGO_COMPARTIDO = "Código compartido. Pégalo en «Importar coche» en el otro dispositivo";

export const MENSAJES_RECHAZO: Record<MotivoRechazo, string> = {
  "formato-desconocido": "Este código no es de Darwin Drive o está incompleto. Cópialo otra vez entero.",
  corrupto: "Este código no es de Darwin Drive o está incompleto. Cópialo otra vez entero.",
  "version-formato": "Este código es de una versión más nueva del juego. Actualiza la app y vuelve a probar.",
  "version-fisica": "Este código es de una versión más nueva del juego. Actualiza la app y vuelve a probar.",
  "demasiado-largo": "El código es demasiado largo para ser un coche.",
  invalido: "El coche de este código no es válido.",
};

/** Resultado de añadir el coche al garaje: `texto` es el aviso si salió bien o el motivo si no. */
export type ResultadoImportar = { ok: boolean; texto: string };

function Fondo(props: { onCerrar: () => void; children: React.ReactNode }) {
  const cerrar = useRef(props.onCerrar);
  useEffect(() => {
    cerrar.current = props.onCerrar;
  });
  useEffect(() => {
    // El foco vuelve a quien abrió la hoja.
    const previo = document.activeElement;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar.current();
    };
    window.addEventListener("keydown", tecla);
    return () => {
      window.removeEventListener("keydown", tecla);
      if (previo instanceof HTMLElement && previo.isConnected) previo.focus();
    };
  }, []);
  return (
    <div
      className="hoja-nombre-fondo"
      data-testid="hoja-codigo-fondo"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onCerrar();
      }}
    >
      {props.children}
    </div>
  );
}

/** «Importar coche»: un campo para pegar el código. La validación estricta es la de decodificarCoche. */
export function HojaImportar(props: { onImportar: (c: CocheCompartible & { hash: string }) => Promise<ResultadoImportar>; onCerrar: () => void }) {
  const [valor, setValor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    campo.current?.focus();
    measureOnNextFrame("hoja-importar");
  }, []);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (ocupado) return;
    markInput("importar");
    setOcupado(true);
    const r = await decodificarCoche(valor);
    if (!r.ok) {
      setError(MENSAJES_RECHAZO[r.motivo]);
      setOcupado(false);
      return;
    }
    const res = await props.onImportar(r.coche);
    if (!res.ok) {
      setError(res.texto);
      setOcupado(false);
    }
  };

  return (
    <Fondo onCerrar={props.onCerrar}>
      <form className="hoja-nombre" role="dialog" aria-modal="true" aria-labelledby="hoja-importar-titulo" data-testid="hoja-importar" onSubmit={enviar}>
        <h2 id="hoja-importar-titulo">Importar coche</h2>
        <textarea
          ref={campo}
          className="hoja-nombre-input hoja-codigo-campo"
          data-testid="importar-codigo"
          aria-label="Código del coche"
          aria-describedby="hoja-importar-ayuda"
          aria-invalid={error !== null}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          rows={3}
          value={valor}
          onChange={(e) => {
            setValor(e.target.value);
            setError(null);
          }}
        />
        <p id="hoja-importar-ayuda" className="hoja-nombre-ayuda" data-testid="importar-ayuda">
          {AYUDA_CODIGO}
        </p>
        {error && (
          <p className="hoja-nombre-error" role="alert" data-testid="importar-error">
            {error}
          </p>
        )}
        <div className="acciones">
          <button type="submit" className="pastilla principal" disabled={ocupado} data-testid="importar-aceptar">
            Importar
          </button>
          <button type="button" className="pastilla" data-testid="importar-cancelar" onClick={props.onCerrar}>
            Cancelar
          </button>
        </div>
      </form>
    </Fondo>
  );
}

/** Última salida cuando ni la hoja nativa ni el portapapeles sirven: el código a la vista y seleccionado. */
export function HojaCopiaManual(props: { codigo: string; onCerrar: () => void }) {
  const campo = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    campo.current?.focus();
    campo.current?.select();
  }, []);
  return (
    <Fondo onCerrar={props.onCerrar}>
      <div className="hoja-nombre" role="dialog" aria-modal="true" aria-labelledby="hoja-manual-titulo" data-testid="hoja-copia-manual">
        <h2 id="hoja-manual-titulo">Copia este código</h2>
        <p>Pégalo en «Importar coche» en el otro dispositivo.</p>
        <textarea ref={campo} readOnly className="hoja-nombre-input hoja-codigo-campo" data-testid="codigo-manual" aria-label="Código del coche" rows={3} value={props.codigo} onFocus={(e) => e.currentTarget.select()} />
        <div className="acciones">
          <button type="button" className="pastilla principal" data-testid="manual-cerrar" onClick={props.onCerrar}>
            Cerrar
          </button>
        </div>
      </div>
    </Fondo>
  );
}
